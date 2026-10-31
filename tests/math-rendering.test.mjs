import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Exercise the actual component and its plugins, using the repository's TSX loader pattern.
const cache = new Map();
function loadComponent(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const component = new Module(file);
  cache.set(file, component);
  component.filename = file;
  const require = createRequire(file);
  component.require = (specifier) => specifier.startsWith("./")
    ? loadComponent(path.resolve(path.dirname(file), `${specifier}.tsx`))
    : require(specifier);
  component._compile(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file);
  return component.exports;
}
const MarkdownContent = loadComponent(fileURLToPath(new URL("../src/components/MarkdownContent.tsx", import.meta.url))).default;
const TableOfContents = loadComponent(fileURLToPath(new URL("../src/components/TableOfContents.tsx", import.meta.url))).default;
function render(content) {
  return renderToStaticMarkup(React.createElement(MarkdownContent, {
    page: { slug: "math", path: "math.md", title: "Math", category: "test", content, links: [], frontmatter: {} },
    owner: "local", repo: "test", onNavigate() {}, slugByName: new Map([["next", "next"]]),
  }));
}

test("inline formulas retain readable text and accessible MathML", () => {
  const html = render(String.raw`能量为 $E=mc^2$，其中 $m$ 为质量。`);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2);
  assert.match(html, /<math[^>]*xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/);
  assert.match(html, /encoding="application\/x-tex">E=mc\^2/);
  assert.match(html, /能量为/);
  assert.match(html, /为质量/);
});

test("display integrals, matrices and aligned derivations render without literal MathML tags", () => {
  const html = render(String.raw`$$
\int_0^1 x^2\,\mathrm{d}x=\frac{1}{3}
$$

$$
\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}
$$

$$
\begin{aligned} f(x)&=x^2 \\ f'(x)&=2x \end{aligned}
$$`);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /katex-error|&lt;math&gt;|&lt;mrow&gt;/);
  assert.match(html, /<mtable/);
});

test("code, escaped prices, wiki links and HTML placeholders keep their existing meaning", () => {
  const html = render('`$literal$`\n\n```latex\n\\frac{1}{2}\n```\n\n价格为 \\$5 和 \\$10。\n\n[[next]]\n\n<profile>示例</profile>');
  assert.doesNotMatch(html, /class="katex"/);
  assert.match(html, /\$literal\$/);
  assert.match(html, /\\frac/);
  assert.match(html, /\$5 和 \$10/);
  assert.match(html, /<button[^>]*>next<\/button>/);
  assert.match(html, /&lt;profile&gt;示例/);
});

test("an invalid formula is shown as an error while subsequent content still renders", () => {
  const html = render(String.raw`错误：$\frac{1}{$。

正确：$x^2$。`);
  assert.match(html, /class="katex-error"/);
  assert.match(html, /正确：/);
  assert.match(html, /class="katex"/);
});

test("formula commands cannot create untrusted links", () => {
  const html = render(String.raw`$\href{javascript:alert(1)}{unsafe}$`);
  assert.doesNotMatch(html, /href="javascript:/i);
});

test("an explicit math fence renders as a display formula", () => {
  const html = render("```math\n\\sum_{i=1}^{n} x_i\n```");
  assert.match(html, /class="katex-display"/);
  assert.doesNotMatch(html, /复制代码|language-math/);
});

test("Wiki-looking text inside every math form retains its original TeX", () => {
  for (const [source, tex] of [
    ["$[[next]]$", "[[next]]"],
    ["$[[missing]]$", "[[missing]]"],
    ["$$\n[[next]]\n$$", "[[next]]"],
    ["```math\n[[next]]\n```", "[[next]]"],
    [String.raw`$x=\text{[[next]]}$`, String.raw`x=\text{[[next]]}`],
    ["$[[A,B],C]$", "[[A,B],C]"],
  ]) {
    const html = render(source);
    assert.doesNotMatch(html, /katex-error|<button/, source);
    const annotations = [...html.matchAll(/<annotation[^>]*>([\s\S]*?)<\/annotation>/g)].map((match) => match[1].trim());
    assert.ok(annotations.includes(tex), source);
  }
});

test("math heading IDs agree with the reader contents, including repeated headings", () => {
  const content = "# 概览\n\n## 更新公式 $x^2$\n\n## Energy $E=mc^2$\n\n## 更新公式 $x^2$";
  const html = render(content);
  const toc = renderToStaticMarkup(React.createElement(TableOfContents, { content }));
  const ids = [...html.matchAll(/<h\d id="([^"]*)"/g)].map((match) => match[1]);
  const targets = [...toc.matchAll(/href="#([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["概览", "更新公式-x2", "energy-emc2", "更新公式-x2-1"]);
  assert.deepEqual(targets, ids);
});

test("contents reuse rendered IDs for subscripts, Unicode and duplicate suffix collisions", () => {
  const content = '## 参数 $x_i$\n\n## 参数 $α$\n\n## x\n\n## x\n\n## x-1\n\n<details>\n<summary>Hidden</summary>\n\n## x\n\n</details>\n\n## x';
  const html = render(content);
  const toc = renderToStaticMarkup(React.createElement(TableOfContents, { content }));
  const ids = [...html.matchAll(/<h\d id="([^"]*)"/g)].map((match) => match[1]);
  const targets = [...toc.matchAll(/href="#([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["参数-x_i", "参数-α", "x", "x-1", "x-1-1", "x-2", "x-3"]);
  assert.deepEqual(targets, ["参数-x_i", "参数-α", "x", "x-1", "x-1-1", "x-3"]);
});

test("contents omit raw HTML block text that the article does not render as a heading", () => {
  const content = '# 概览\n\n## 正文\n\n<details>\n<summary>说明</summary>\n</details>\n## 仍是 HTML 块中的文本';
  const html = render(content);
  const toc = renderToStaticMarkup(React.createElement(TableOfContents, { content }));
  const ids = [...html.matchAll(/<h\d id="([^"]*)"/g)].map((match) => match[1]);
  const targets = [...toc.matchAll(/href="#([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["概览", "正文"]);
  assert.deepEqual(targets, ids);
});

test("contents share Wiki aliases, Markdown links, HTML headings and hidden heading suffixes", () => {
  const content = '# 概览\n\n## [[next|**章节** $x_i$]]\n\n<h2>原始 <em>HTML</em></h2>\n\n## [链接标题](https://example.test)\n\n##### x\n\n## x';
  const html = render(content);
  const toc = renderToStaticMarkup(React.createElement(TableOfContents, { content, slugByName: new Map([["next", "next"]]) }));
  const ids = [...html.matchAll(/<h[1-4] id="([^"]*)"/g)].map((match) => match[1]);
  const targets = [...toc.matchAll(/href="#([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ids);
  assert.ok(targets.includes("章节-x_i"));
  assert.ok(targets.includes("原始-html"));
  assert.ok(targets.includes("x-1"));
});

test("Wiki backtracking and nested labels cannot leak custom nodes or nested anchors", () => {
  for (const content of ["[[next|x] then [[next|y]]", "[[next| [[next|y]] ]]", "[[next|[label](https://example.test)]]"]) {
    const html = render(content);
    assert.equal((html.match(/<button\b/g) ?? []).length, 1, content);
    assert.doesNotMatch(html, /href="https:\/\/example.test"/, content);
  }
  const html = render('<a href="https://example.test">[[next|literal]]</a> then [[next]]');
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.match(html, /\[\[next\|literal\]\]/);
});

test("closed HTML anchor blocks do not suppress later Wiki links", () => {
  const html = render('<a href="https://example.test">\nraw HTML label\n</a>\n\n[[next]]');
  assert.match(html, /href="https:\/\/example.test"/);
  assert.match(html, /<button[^>]*>next<\/button>/);
});

test("HTML anchors inside a Wiki alias keep the alias text without a nested link", () => {
  const html = render('[[next|<a href="https://example.test">nested</a>]]');
  assert.match(html, /<button[^>]*>nested<\/button>/);
  assert.doesNotMatch(html, /href="https:\/\/example.test"/);
});

test("authored HTML data attributes cannot impersonate parser placeholders", () => {
  const html = render('<span data-selfwiki-raw="example">visible</span>\n\n<span data-selfwiki-raw="[[next]]" data-selfwiki-label="forged" data-selfwiki-slug="next">original</span>\n\n[[next]]');
  assert.match(html, />visible<\/span>/);
  assert.match(html, />original<\/span>/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<button[^>]*>forged<\/button>/);
});

test("only authored Wiki syntax becomes a link, preserving rich aliases", () => {
  const html = render(String.raw`\[[next]] and [[next]] and &#91;&#91;next&#93;&#93;

[[next|Open **next**]] and [[next|$x^2$]]
`);
  assert.equal((html.match(/<button\b/g) ?? []).length, 3);
  assert.match(html, /\[\[next\]\] and <button/);
  assert.match(html, /and \[\[next\]\]/);
  assert.match(html, /<button[^>]*>Open <strong>next<\/strong><\/button>/);
  assert.match(html, /encoding="application\/x-tex">x\^2/);
});

test("Wiki syntax takes precedence over an unrelated Markdown reference definition", () => {
  const html = render("[[next]]\n\n[next]: https://example.test");
  assert.match(html, /<button[^>]*>next<\/button>/);
  assert.doesNotMatch(html, /href="https:\/\/example.test"/);
});

test("Wiki aliases reuse inline math/code parsing, and incomplete markup stays readable", () => {
  const html = render('[[next|$[[x]]$]] and [[next|`]]` **bold**]] and [[missing|label]]\n\n[[unclosed then [[next]]');
  assert.match(html, /encoding="application\/x-tex">\[\[x\]\]/);
  assert.match(html, /<code>\]\]<\/code> <strong>bold<\/strong>/);
  assert.match(html, /<code>label<\/code>/);
  assert.match(html, /\[\[unclosed then <button[^>]*>next<\/button>/);
  assert.doesNotMatch(html, /katex-error/);
});

test("Wiki labels preserve additional pipes and never create empty navigation buttons", () => {
  const html = render('[[next|a|b]] [[missing|a|b]] [[next|]] [[next|   ]] [[missing|]]');
  assert.match(html, /<button[^>]*>a\|b<\/button>/);
  assert.match(html, /<code>a\|b<\/code>/);
  assert.equal((html.match(/<button[^>]*>next<\/button>/g) ?? []).length, 2);
  assert.match(html, /<code>missing<\/code>/);
  assert.doesNotMatch(html, /<button[^>]*>\s*<\/button>/);
});

test("code examples and existing links do not acquire nested Wiki links", () => {
  const html = render('`[[next]]`\n\n```text\n[[next]]\n```\n\n[literal [[next]]](https://example.test)');
  assert.doesNotMatch(html, /<button[^>]*>next<\/button>/);
  assert.match(html, /<code>\[\[next\]\]<\/code>/);
  assert.match(html, /href="https:\/\/example.test"/);
  assert.match(html, /literal \[\[next\]\]/);
});
