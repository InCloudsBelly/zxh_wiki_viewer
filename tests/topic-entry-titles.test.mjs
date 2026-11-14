import assert from "node:assert/strict";
import test from "node:test";
import { buildWikiData } from "../src/lib/github.ts";

function page(path, title) {
  return { path, content: `---\ntitle: ${JSON.stringify(title)}\ntype: article\n---\n# ${title}\n` };
}

function nodeAt(root, path) {
  if (root.path === path) return root;
  for (const child of root.children) {
    const found = nodeAt(child, path);
    if (found) return found;
  }
}

for (const hierarchyMode of ["filesystem", "selfwiki"]) {
  const build = (pages) => buildWikiData("local", "SelfWiki", pages, { hierarchyMode });

  for (const topic of [
    { path: "prt", entry: "index.md", title: "PRT 实现 Wiki", name: "PRT" },
    { path: "sk-instance", entry: "overview.md", title: "SK Instance 代码 Wiki", name: "SKInstance" },
  ]) {
    test(`${hierarchyMode}: ${topic.name} uses its canonical topic name`, () => {
      const entryPath = `${topic.path}/${topic.entry}`;
      const data = build([
        page(entryPath, topic.title),
        page(`${topic.path}/details.md`, "实现细节"),
      ]);
      const directory = nodeAt(data.hierarchy, topic.path);
      const entry = data.pages.find((item) => item.path === entryPath);
      assert.ok(directory);
      assert.ok(entry);
      assert.equal(directory.kind, "directory");
      assert.equal(directory.title, topic.name);
      assert.equal(directory.pageSlug, entry.slug);
      assert.equal(data.graph.nodes.find((item) => item.id === entry.slug)?.displayTitle, topic.name);
      assert.equal(entry.title, topic.title);
      assert.ok(entry.content.includes(`# ${topic.title}`));
    });
  }

  test(`${hierarchyMode}: directory names retain their own subject while chapters omit it`, () => {
    const data = build([
      page("skin-models/overview.md", "Skin Models：资源布局"),
      page("skin-models/layout.md", "Skin Models：纹理布局"),
    ]);
    assert.equal(nodeAt(data.hierarchy, "skin-models")?.title, "Skin Models：资源布局");
    assert.equal(nodeAt(data.hierarchy, "skin-models/layout.md")?.title, "纹理布局");
  });

  test(`${hierarchyMode}: directory names can still omit an ancestor prefix`, () => {
    const data = build([
      page("rendering/skin-models/overview.md", "Rendering：Skin Models"),
      page("rendering/skin-models/layout.md", "Skin Models：纹理布局"),
    ]);
    assert.equal(nodeAt(data.hierarchy, "rendering/skin-models")?.title, "Skin Models");
  });

  test(`${hierarchyMode}: a flat topic entry retains its existing page route`, () => {
    const data = build([
      page("sk-instance.md", "SK Instance 代码 Wiki"),
      page("sk-instance/lifecycle.md", "生命周期"),
    ]);
    const directory = nodeAt(data.hierarchy, "sk-instance");
    const entry = data.pages.find((item) => item.path === "sk-instance.md");
    assert.ok(entry);
    assert.equal(directory?.title, "SKInstance");
    assert.equal(directory?.pageSlug, entry.slug);
    assert.equal(data.graph.nodes.find((item) => item.id === entry.slug)?.displayTitle, "SKInstance");
  });
}
