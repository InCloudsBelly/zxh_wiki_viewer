import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import { remarkWikiLinks } from "./remark-wiki-links.mjs";

// Keep literal prompt placeholders while preserving actual HTML and SVG.
const HTML_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base",
  "bdi", "bdo", "blockquote", "body", "br", "button", "canvas", "caption",
  "cite", "code", "col", "colgroup", "data", "datalist", "dd", "del", "details",
  "dfn", "dialog", "div", "dl", "dt", "em", "embed", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hgroup", "hr", "html", "i", "iframe", "img", "input", "ins", "kbd",
  "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta",
  "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output",
  "p", "param", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s",
  "samp", "script", "section", "select", "slot", "small", "source", "span",
  "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template",
  "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "u", "ul",
  "var", "video", "wbr",
]);

function rehypeArticleMarkup() {
  return (tree, file) => {
    const source = String(file.value || "");
    const walk = (node, insideSvg, insideLink = false) => {
      if (!Array.isArray(node.children)) return;
      const next = [];
      for (const child of node.children) {
        if (child.type === "element" && child.tagName) {
          const childInSvg = insideSvg || child.tagName === "svg";
          const props = child.properties || {};
          const start = child.position?.start?.offset;
          const end = child.position?.end?.offset;
          // Source HTML must not impersonate the lexer-created intermediate span.
          if (child.tagName === "span" && typeof props.dataSelfwikiRaw === "string" &&
              typeof props.dataSelfwikiLabel === "string" && typeof props.dataSelfwikiSlug === "string" &&
              typeof start === "number" && typeof end === "number" &&
              source.slice(start, start + 2) === "[[" && source.slice(end - 2, end) === "]]") {
            if (insideLink) {
              next.push({ type: "text", value: props.dataSelfwikiRaw });
              continue;
            }
            if (!props.dataSelfwikiSlug) {
              next.push({ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: props.dataSelfwikiLabel }] });
              continue;
            }
            child.tagName = "a";
            child.properties = { href: `#wiki:${props.dataSelfwikiSlug}` };
          }
          // A rich Wiki alias may itself contain an HTML or Markdown link.
          if (insideLink && child.tagName === "a") {
            walk(child, childInSvg, true);
            next.push(...child.children);
            continue;
          }
          if (!childInSvg && !HTML_TAGS.has(child.tagName)) {
            walk(child, childInSvg, insideLink);
            next.push({ type: "text", value: `<${child.tagName}>` });
            if (child.children) next.push(...child.children);
            continue;
          }
          walk(child, childInSvg, insideLink || child.tagName === "a");
        }
        next.push(child);
      }
      node.children = next;
    };
    walk(tree, false);
  };
}

/**
 * Shared parsing and heading identity; display-only plugins run after this prefix.
 * @param {Map<string, string>} [slugByName]
 * @returns {Pick<import('react-markdown').Options, 'remarkPlugins' | 'rehypePlugins'>}
 */
export function markdownOptions(slugByName = new Map()) {
  return {
    remarkPlugins: [remarkGfm, remarkMath, [remarkWikiLinks, { slugByName }]],
    rehypePlugins: [rehypeRaw, rehypeArticleMarkup, rehypeSlug],
  };
}

/**
 * Read the same IDs as the article, without expanding formulas or highlighting code.
 * @param {string} content
 * @param {Map<string, string>} [slugByName]
 * @returns {Array<{id: string, text: string, level: number}>}
 */
export function extractHeadings(content, slugByName) {
  const options = markdownOptions(slugByName);
  const processor = unified()
    .use(remarkParse)
    .use(options.remarkPlugins || [])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(options.rehypePlugins || []);
  const tree = processor.runSync(processor.parse(content), content);
  const headings = [];
  const text = (node) => node.type === "text" ? node.value : (node.children || []).map(text).join("");
  const walk = (node) => {
    // Assign IDs on the complete tree first: hidden and h5/h6 headings occupy suffixes.
    if (node.type === "element" && node.tagName === "details") return;
    if (node.type === "element" && /^h[1-4]$/.test(node.tagName) && typeof node.properties?.id === "string") {
      headings.push({ id: node.properties.id, text: text(node), level: Number(node.tagName[1]) });
    }
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return headings;
}
