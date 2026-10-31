"use client";

import WikiViewer from "@/components/WikiViewer";
import type { WikiData, WikiPage } from "@/lib/github";

const spacer = Array.from({ length: 8 }, (_, i) =>
  `参数说明 ${i + 1}：变量 x 表示输入，i 表示下标。目录应定位到正文标题，同时保留当前文章。`
).join("\n\n");
const formulaContent = [
  "## $x^2$",
  String.raw`$$
\int_0^1 x^2\,\mathrm{d}x=\frac{1}{3},\qquad f(x)=\sqrt{x^2+1}
$$`,
  "数学里的 Wiki 字面量 $[[next]]$ 与代码 `[[next]]` 应保持原意。",
  spacer,
  "## $x_i$",
  spacer,
  "## $α$",
  spacer,
  "## x",
  spacer,
  "## x",
  spacer,
  "## x-1",
  spacer,
  "## [[next|**下一篇** $x^2$]]",
  "[[next|进入下一篇]]",
].join("\n\n");

const pages: WikiPage[] = [
  { path: "intro.md", slug: "intro", title: "入口文章", content: "## 开始\n\n[[formulas|进入公式文章]]", frontmatter: {}, category: "验收", links: ["formulas"] },
  { path: "formulas.md", slug: "formulas", title: "公式与目录验收", content: formulaContent, frontmatter: {}, category: "验收", links: ["next"] },
  { path: "next.md", slug: "next", title: "下一篇文章", content: "## 导航成功\n\n[[formulas|返回公式文章]]", frontmatter: {}, category: "验收", links: ["formulas"] },
];

const data: WikiData = {
  owner: "local", repo: "math-check", pages, readme: "", categories: { "验收": pages },
  hierarchy: { id: "root", title: "公式验收", path: "", kind: "root", category: "验收", children: pages.map(page => ({ id: page.slug, title: page.title, path: page.path, kind: "page", category: page.category, pageSlug: page.slug, children: [] })) },
  graph: {
    nodes: pages.map(page => ({ id: page.slug, title: page.title, displayTitle: page.title, category: page.category, linkCount: page.links.length })),
    links: pages.flatMap(page => page.links.map(target => ({ source: page.slug, target }))),
  },
};

export default function MathNavigationCheck() {
  return <WikiViewer data={data} loading={false} error="" label="公式验收" owner="local" repo="math-check" />;
}
