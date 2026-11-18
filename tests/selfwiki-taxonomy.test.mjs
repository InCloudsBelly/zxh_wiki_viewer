import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import path from "node:path";
import { buildWikiData } from "../src/lib/github.ts";

function wikiData(paths) {
  return buildWikiData(
    "local",
    "SelfWiki",
    paths.map((path) => ({ path, content: "# Test page\n" })),
    { hierarchyMode: "selfwiki" }
  );
}

function pageRoutes(node, parents = []) {
  const branch = [...parents, node];
  return [
    ...(node.pageSlug === undefined ? [] : [{ slug: node.pageSlug, branch }]),
    ...node.children.flatMap((child) => pageRoutes(child, branch)),
  ];
}

test("KGPR, Lumen, Nanite and RDG are peer L2 rendering topics", () => {
  const data = wikiData([
    "overview/comprehensive-technical-design.md",
    "rendering/lumen.md",
    "rendering/nanite.md",
    "rendering/rdg-design.md",
  ]);
  const rendering = data.hierarchy.children.find(
    (node) => node.path === "taxonomy/rendering"
  );
  assert.ok(rendering);
  assert.equal(rendering.level, 1);
  assert.deepEqual(
    Object.fromEntries(rendering.children.map((node) => [node.title, node.level])),
    { Lumen: 2, Nanite: 2, RDG: 2, "KGPR 技术专题": 2 }
  );
  assert.deepEqual(
    rendering.children.map((node) => node.pageSlug).sort(),
    data.pages.map((page) => page.slug).sort()
  );
});

test("chapters, code maps and source evidence follow their rendering topic", () => {
  const expectedTopics = [
    ["rendering/lumen-01-architecture-and-math.md", "Lumen"],
    ["rendering/lumen-18-sources-and-verification.md", "Lumen"],
    ["rendering/lumen-source-code-map.md", "Lumen"],
    ["sources/lumen-2026-10-14.md", "Lumen"],
    ["rendering/nanite-01-overview-and-dataflow.md", "Nanite"],
    ["rendering/nanite-13-source-walkthrough-and-glossary.md", "Nanite"],
    ["sources/nanite-ue574-20261015.md", "Nanite"],
    ["rendering/rdg-01-data-model-and-setup.md", "RDG"],
    ["rendering/rdg-12-debugging-and-performance.md", "RDG"],
    ["sources/rdg-ue574-2026-10-14.md", "RDG"],
  ];
  const data = wikiData([
    "overview/comprehensive-technical-design.md",
    "rendering/lumen.md",
    "rendering/nanite.md",
    "rendering/rdg-design.md",
    ...expectedTopics.map(([path]) => path),
  ]);
  const routes = pageRoutes(data.hierarchy);

  for (const [path, expectedTopic] of expectedTopics) {
    const page = data.pages.find((candidate) => candidate.path === path);
    const route = routes.find((candidate) => candidate.slug === page.slug);
    assert.equal(
      route?.branch.find((node) => node.level === 2)?.title,
      expectedTopic,
      path
    );
  }
});

test("KGPR integrations and scene export retain ownership without duplicate pages", () => {
  const data = wikiData([
    "overview/comprehensive-technical-design.md",
    "rendering/lumen.md",
    "rendering/nanite.md",
    "rendering/rdg-design.md",
    "rendering/nanite-and-parallel-prepare.md",
    "rendering/stencil-and-composite.md",
    "sources/kgpr-source-set.md",
    "sources/lumen-2026-10-14.md",
    "sources/nanite-ue574-20261015.md",
    "sources/rdg-ue574-2026-10-14.md",
    "unreal-engine/scene-export/00-overview.md",
  ]);
  const routes = pageRoutes(data.hierarchy);
  assert.deepEqual(
    routes.map((route) => route.slug).sort(),
    data.pages.map((page) => page.slug).sort()
  );

  for (const path of [
    "rendering/nanite-and-parallel-prepare.md",
    "rendering/stencil-and-composite.md",
    "sources/kgpr-source-set.md",
  ]) {
    const page = data.pages.find((candidate) => candidate.path === path);
    const route = routes.find((candidate) => candidate.slug === page.slug);
    assert.equal(
      route.branch.find((node) => node.level === 2)?.title,
      "KGPR 技术专题",
      path
    );
  }
  const sceneExport = data.pages.find(
    (page) => page.path === "unreal-engine/scene-export/00-overview.md"
  );
  assert.equal(
    routes.find((route) => route.slug === sceneExport.slug).branch[1].title,
    "场景导出"
  );
});

test("missing entry pages do not hide chapters or create empty peer topics", () => {
  const data = wikiData([
    "rendering/nanite-01-overview-and-dataflow.md",
    "notes/unrelated.md",
  ]);
  const rendering = data.hierarchy.children.find(
    (node) => node.path === "taxonomy/rendering"
  );
  assert.deepEqual(rendering.children.map((node) => node.title), ["Nanite"]);
  assert.equal(rendering.children[0].pageSlug, undefined);
  assert.deepEqual(
    pageRoutes(data.hierarchy).map((route) => route.slug).sort(),
    ["notes__unrelated", "rendering__nanite-01-overview-and-dataflow"]
  );
  assert.deepEqual(wikiData([]).hierarchy.children, []);
});

test("graph levels follow topic ownership while page slugs and links stay stable", () => {
  const files = [
    { path: "rendering/lumen.md", content: "[Chapter](lumen-01-architecture-and-math.md)" },
    { path: "rendering/lumen-01-architecture-and-math.md", content: "# Chapter" },
    { path: "rendering/nanite.md", content: "# Nanite" },
    { path: "rendering/rdg-design.md", content: "# RDG" },
    { path: "overview/comprehensive-technical-design.md", content: "# KGPR" },
  ];
  const data = buildWikiData("local", "SelfWiki", files, { hierarchyMode: "selfwiki" });
  assert.deepEqual(
    Object.fromEntries(data.graph.nodes.map((node) => [node.id, node.level])),
    {
      "overview__comprehensive-technical-design": 2,
      "rendering__lumen-01-architecture-and-math": 3,
      rendering__lumen: 2,
      rendering__nanite: 2,
      "rendering__rdg-design": 2,
    }
  );
  assert.deepEqual(data.graph.links, [
    { source: "rendering__lumen", target: "rendering__lumen-01-architecture-and-math" },
  ]);
  const filesystem = buildWikiData("local", "SelfWiki", files);
  assert.deepEqual(data.pages, filesystem.pages);
  assert.deepEqual(data.graph.links, filesystem.graph.links);
});

test("consolidated articles and their evidence stay in peer rendering topics", () => {
  const expected = [
    ["kgpr/architecture.md", "KGPR 技术专题"],
    ["kgpr/views-visibility-and-submission.md", "KGPR 技术专题"],
    ["lumen/architecture-and-frame.md", "Lumen"],
    ["lumen/radiance-cache.md", "Lumen"],
    ["nanite/architecture-and-dataflow.md", "Nanite"],
    ["nanite/streaming-lifecycle.md", "Nanite"],
    ["rdg/graph-execution.md", "RDG"],
    ["rdg/resource-lifecycle.md", "RDG"],
    ["sources/lumen-2026-10-14.md", "Lumen"],
    ["sources/kgpr-source-set.md", "KGPR 技术专题"],
  ];
  const data = wikiData(expected.map(([path]) => path));
  const rendering = data.hierarchy.children.find(
    (node) => node.path === "taxonomy/rendering"
  );
  const routes = pageRoutes(data.hierarchy);
  for (const [path, topic] of expected) {
    const page = data.pages.find((candidate) => candidate.path === path);
    const route = routes.find((candidate) => candidate.slug === page.slug);
    assert.equal(route.branch.find((node) => node.level === 2)?.title, topic, path);
  }
  assert.deepEqual(
    rendering.children.map((node) => node.level),
    [2, 2, 2, 2]
  );
  assert.deepEqual(
    routes.map((route) => route.slug).sort(),
    data.pages.map((page) => page.slug).sort()
  );
  assert.ok(rendering.children.every((node) => node.pageSlug));
});

test("reader contents omit folded maintenance headings and literal code examples", () => {
  const file = fileURLToPath(new URL("../src/components/TableOfContents.tsx", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const component = new Module(file);
  component.filename = file;
  component.require = createRequire(file);
  component._compile(compiled, file);
  const markdown = [
    "# 专题", "", "## 核心机制", "",
    "<details>", "<summary>维护信息</summary>", "", "## 核心机制", "",
    "<details>", "", "### 精确指纹", "", "</details>", "", "</details>", "",
    "~~~~text", "## 代码示例里的标题", "~~~~", "", "## 使用边界",
  ].join("\n");
  const html = renderToStaticMarkup(React.createElement(component.exports.default, { content: markdown }));
  assert.ok(html.includes('href="#核心机制"'));
  assert.ok(html.includes('href="#使用边界"'));
  assert.ok(!html.includes("精确指纹"));
  assert.ok(!html.includes('href="#核心机制-1"'));
  assert.ok(!html.includes("代码示例里的标题"));
});

test("the consolidated knowledge areas are reachable without unclassified duplicates", () => {
  const data = wikiData([
    "README.md", "quickstart.md", "scene-export/framework-and-builders.md",
    "scene-export/hlod-visibility.md", "mobile-asset-replacement/asset-replace.md",
    "mobile-asset-replacement/meshgrass.md", "gpu-scene/data-protocol.md",
    "instance-culling/design.md", "sources/instance-culling-2026-10-13.md",
    "rendering-tools/draw-command-tags.md",
  ]);
  assert.ok(!data.hierarchy.children.some((node) => node.path === "taxonomy/unclassified"));
  const routes = pageRoutes(data.hierarchy);
  assert.deepEqual(routes.map((route) => route.slug).sort(), data.pages.map((page) => page.slug).sort());
  assert.equal(data.hierarchy.pageSlug, "README");
});

test("literal details tags and HTML comments cannot hide the reader contents", () => {
  const file = fileURLToPath(new URL("../src/components/TableOfContents.tsx", import.meta.url));
  const component = new Module(file);
  component.filename = file;
  component.require = createRequire(file);
  component._compile(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, file);
  for (const note of [
    "使用 `<details>` 折叠维护信息。",
    "使用 `<details>\n标签` 展示代码字面量。",
    "使用 ``<details> ` literal`` 折叠维护信息。",
    "使用 ``<details>\n包含 ` 的标签`` 展示代码字面量。",
    "\\<details> 是转义后的文字。",
    "`未闭合的代码标记。\n\n<details>\n## 维护信息\n</details>",
    "<!-- <details> -->",
    "<!--\n<details>\n-->",
    "`<!--` 是注释的开始标记。",
  ]) {
    const html = renderToStaticMarkup(React.createElement(component.exports.default, {
      content: `# 专题\n\n${note}\n\n## 核心机制\n\n## 使用边界`,
    }));
    assert.ok(html.includes('href="#核心机制"'), note);
    assert.ok(html.includes('href="#使用边界"'), note);
    assert.ok(!html.includes("维护信息"), note);
  }
});

test("the unique Wiki overview keeps its searchable title and README path", () => {
  const data = buildWikiData("local", "SelfWiki", [
    { path: "README.md", content: "---\ntitle: 个人 Wiki 阅读导航\n---\n# 个人 Wiki 阅读导航\n" },
  ], { hierarchyMode: "selfwiki" });
  assert.equal(data.hierarchy.title, "个人 Wiki 阅读导航");
  assert.equal(data.hierarchy.path, "README.md");
  assert.equal(data.hierarchy.category, "SelfWiki");
  assert.deepEqual(pageRoutes(data.hierarchy).map((route) => route.slug), ["README"]);
});

test("chapter links to another Wiki article stay inside the reader", () => {
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
  const file = fileURLToPath(new URL("../src/components/MarkdownContent.tsx", import.meta.url));
  const Component = loadComponent(file).default;
  const html = renderToStaticMarkup(React.createElement(Component, {
    page: { path: "kgpr/architecture.md", slug: "kgpr__architecture", content: "[可见性章节](views.md#visibility)", links: [], frontmatter: {} },
    owner: "local", repo: "SelfWiki", onNavigate() {},
    slugByName: new Map([["kgpr/views.md", "kgpr__views"]]),
  }));
  assert.ok(!html.includes('target="_blank"'));
  assert.ok(html.includes("<button"));
  assert.ok(html.includes("可见性章节"));
});

test("topic reading order accepts only nonnegative safe integers and has stable fallback", () => {
  const files = [
    { path: "lumen/architecture-and-frame.md", content: "---\ntitle: Lumen architecture\n---\n[First](z-first.md)" },
    { path: "lumen/a-last.md", content: "---\ntitle: Last\norder: 12\n---\n" },
    { path: "lumen/z-first.md", content: "---\ntitle: First\norder: 1\n---\n" },
    { path: "lumen/m-middle.md", content: "---\ntitle: Middle\norder: 2\n---\n" },
    { path: "lumen/b-tie.md", content: "---\ntitle: Tie\norder: 2\n---\n" },
    { path: "lumen/nested/chapter.md", content: "---\ntitle: Nested\norder: 3\n---\n" },
    { path: "lumen/max.md", content: "---\ntitle: Maximum\norder: 9007199254740991\n---\n" },
    { path: "lumen/loose.md", content: "---\ntitle: Loose\n---\n" },
    ...['"0"', "false", "-1", "0.5", ".nan", ".inf", "9007199254740992", "null", "[1]", "{rank: 1}", "2026-10-19", '""'].map((order, index) => ({
      path: `lumen/invalid-${index}.md`,
      content: `---\ntitle: Invalid ${index}\norder: ${order}\n---\n`,
    })),
  ];
  const data = buildWikiData("local", "SelfWiki", files, { hierarchyMode: "selfwiki" });
  const topic = data.hierarchy.children[0].children[0];
  assert.equal(topic.pageSlug, "lumen__architecture-and-frame");
  assert.deepEqual(topic.children.slice(0, 6).map((node) => [node.path, node.title]), [
    ["lumen/z-first.md", "01 · First"],
    ["lumen/b-tie.md", "02 · Tie"],
    ["lumen/m-middle.md", "02 · Middle"],
    ["lumen/nested/chapter.md", "03 · Nested"],
    ["lumen/a-last.md", "12 · Last"],
    ["lumen/max.md", "9007199254740991 · Maximum"],
  ]);
  assert.deepEqual(topic.children.slice(6).map((node) => node.path), [
    ...Array.from({ length: 12 }, (_, index) => `lumen/invalid-${index}.md`),
    "lumen/loose.md",
  ]);
  assert.ok(topic.children.slice(6).every((node) => !node.title.includes(" · ")));
  assert.deepEqual(
    pageRoutes(data.hierarchy).map((route) => route.slug).sort(),
    data.pages.map((page) => page.slug).sort()
  );
  assert.deepEqual(
    buildWikiData("local", "SelfWiki", [...files].reverse(), { hierarchyMode: "selfwiki" }),
    data
  );
  assert.equal(data.pages.find((page) => page.path === "lumen/z-first.md").title, "First");
  assert.equal(data.graph.nodes.find((node) => node.id === "lumen__z-first").displayTitle, "First");
  assert.deepEqual(data.graph.links, [
    { source: "lumen__architecture-and-frame", target: "lumen__z-first" },
  ]);
});

test("an explicit zero-order overview is the first unique leaf of its peer L2 topic", () => {
  const entries = [
    ["lumen/architecture-and-frame.md", "Lumen overview"],
    ["nanite/architecture-and-dataflow.md", "Nanite overview"],
    ["rdg/graph-execution.md", "RDG overview"],
    ["kgpr/architecture.md", "KGPR overview"],
  ];
  const data = buildWikiData("local", "SelfWiki", [
    { path: "README.md", content: "---\ntitle: Wiki overview\norder: 0\n---\n" },
    ...entries.map(([path, title]) => ({ path, content: `---\ntitle: ${title}\norder: 0\n---\n` })),
    { path: "lumen/a-extra-zero.md", content: "---\ntitle: Another zero\norder: 0\n---\n" },
    { path: "lumen/z-first.md", content: "---\ntitle: First\norder: 1\n---\n" },
  ], { hierarchyMode: "selfwiki" });
  const rendering = data.hierarchy.children.find((node) => node.path === "taxonomy/rendering");
  assert.deepEqual(rendering.children.map((node) => [node.title, node.level]), [
    ["Lumen", 2], ["Nanite", 2], ["RDG", 2], ["KGPR 技术专题", 2],
  ]);
  for (const [index, [path, title]] of entries.entries()) {
    const topic = rendering.children[index];
    assert.equal(topic.pageSlug, undefined, path);
    assert.equal(topic.children[0].path, path);
    assert.equal(topic.children[0].title, `00 · ${title}`);
    assert.equal(topic.children[0].kind, "page");
    assert.equal(topic.children[0].level, 3);
    assert.deepEqual(topic.children[0].children, []);
    assert.equal(data.pages.find((page) => page.path === path).title, title);
  }
  assert.equal(data.hierarchy.pageSlug, "README");
  assert.equal(data.hierarchy.level, 0);
  assert.equal(data.hierarchy.title, "Wiki overview");
  assert.deepEqual(
    pageRoutes(data.hierarchy).map((route) => route.slug).sort(),
    data.pages.map((page) => page.slug).sort()
  );
});

test("ordered body leaves precede evidence groups across directories and taxonomy subgroups", () => {
  const data = buildWikiData("local", "SelfWiki", [
    { path: "kgpr/architecture.md", content: "---\ntitle: KGPR overview\norder: 0\n---\n" },
    { path: "data/z-data.md", content: "---\ntitle: Data\norder: 1\n---\n" },
    { path: "integration/a-integration.md", content: "---\ntitle: Integration\norder: 2\n---\n" },
    { path: "kgpr/a-body.md", content: "---\ntitle: Body\norder: 3\n---\n" },
    { path: "data/unranked.md", content: "# Unranked data" },
    { path: "kgpr/new/unranked.md", content: "# New unranked page" },
    { path: "sources/kgpr-source-set.md", content: "---\ntitle: KGPR evidence\norder: 0\n---\n" },
    { path: "lumen/architecture-and-frame.md", content: "---\ntitle: Lumen overview\norder: 0\n---\n" },
    { path: "lumen/z-body.md", content: "---\ntitle: Lumen body\norder: 1\n---\n" },
    { path: "lumen/unranked.md", content: "# Unranked Lumen" },
    { path: "sources/lumen-z-first.md", content: "---\ntitle: First evidence\norder: 0\n---\n" },
    { path: "sources/lumen-a-last.md", content: "---\ntitle: Last evidence\norder: 2\n---\n" },
    { path: "sources/lumen-unranked.md", content: "# Unranked evidence" },
  ], { hierarchyMode: "selfwiki" });
  const topics = data.hierarchy.children.find((node) => node.path === "taxonomy/rendering").children;
  const kgpr = topics.find((node) => node.title === "KGPR 技术专题");
  assert.deepEqual(kgpr.children.map((node) => node.path), [
    "kgpr/architecture.md", "data/z-data.md", "integration/a-integration.md", "kgpr/a-body.md",
    "taxonomy/kgpr-data", "taxonomy/kgpr-evidence", "kgpr/new",
  ]);
  assert.deepEqual(kgpr.children[4].children.map((node) => node.path), ["data/unranked.md"]);
  assert.deepEqual(kgpr.children[5].children.map((node) => node.path), ["sources/kgpr-source-set.md"]);
  const lumen = topics.find((node) => node.title === "Lumen");
  assert.deepEqual(lumen.children.map((node) => node.path), [
    "lumen/architecture-and-frame.md", "lumen/z-body.md", "taxonomy/lumen-evidence", "lumen/unranked.md",
  ]);
  assert.deepEqual(lumen.children[2].children.map((node) => node.path), [
    "sources/lumen-z-first.md", "sources/lumen-a-last.md", "sources/lumen-unranked.md",
  ]);
  assert.deepEqual(
    pageRoutes(data.hierarchy).map((route) => route.slug).sort(),
    data.pages.map((page) => page.slug).sort()
  );
});

test("legacy representatives and the default GitHub hierarchy ignore unrelated order metadata", () => {
  const files = [
    { path: "README.md", content: "---\ntitle: Wiki\n---\n" },
    { path: "lumen/architecture-and-frame.md", content: "---\ntitle: Architecture\n---\n[Chapter](z-chapter.md)" },
    { path: "lumen/z-chapter.md", content: "---\ntitle: Chapter\n---\n" },
    { path: "lumen/a/index.md", content: "---\ntitle: Index\n---\n" },
    { path: "lumen/a/detail.md", content: "---\ntitle: Detail\n---\n" },
    { path: "sources/lumen-evidence.md", content: "---\ntitle: Evidence\n---\n" },
  ];
  const selfwiki = buildWikiData("local", "SelfWiki", files, { hierarchyMode: "selfwiki" });
  assert.equal(selfwiki.hierarchy.children[0].children[0].pageSlug, "lumen__architecture-and-frame");
  for (const order of ['"0"', "false", "null", "-1", "0.5", ".nan", ".inf", "9007199254740992"]) {
    const invalid = files.map((file) => ({
      ...file,
      content: file.content.replace("---\n", `---\norder: ${order}\n`),
    }));
    const data = buildWikiData("local", "SelfWiki", invalid, { hierarchyMode: "selfwiki" });
    assert.deepEqual(data.hierarchy, selfwiki.hierarchy, order);
    assert.deepEqual(data.graph, selfwiki.graph, order);
  }
  const nonzeroRepresentative = files.map((file) => file.path === "lumen/architecture-and-frame.md"
    ? { ...file, content: file.content.replace("---\n", "---\norder: 5\n") }
    : file);
  assert.deepEqual(
    buildWikiData("local", "SelfWiki", nonzeroRepresentative, { hierarchyMode: "selfwiki" }).hierarchy,
    selfwiki.hierarchy
  );
  const filesystem = buildWikiData("owner", "GitHubRepo", files);
  const ordered = files.map((file, index) => ({
    ...file,
    content: file.content.replace("---\n", `---\norder: ${index}\n`),
  }));
  for (const options of [{}, { hierarchyMode: "filesystem" }]) {
    const data = buildWikiData("owner", "GitHubRepo", ordered, options);
    assert.deepEqual(data.hierarchy, filesystem.hierarchy);
    assert.deepEqual(data.graph, filesystem.graph);
  }
});
