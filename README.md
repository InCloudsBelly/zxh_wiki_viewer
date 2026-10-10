# LanShu WikiView

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?style=for-the-badge&logo=tailwindcss" alt="Tailwind" />
  <a href="https://lanshu-wiki-web.lank.workers.dev/">
    <img src="https://img.shields.io/badge/Live-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Workers" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

<p align="center">
  <strong>Transform any GitHub wiki repository into a beautiful, visual reading experience.</strong>
</p>

<p align="center">
  Input a GitHub repo URL &rarr; Instantly render a premium wiki reader with knowledge graphs, search, and enhanced navigation.
</p>

---

## Features

- **Universal GitHub Support** — Works with any public GitHub repository containing Markdown files
- **Knowledge Graph** — Interactive D3 force-directed graph visualizing page relationships
- **Full-Text Search** — `Cmd+K` instant search across all page titles, tags, and content
- **Mermaid Diagrams** — Auto-renders `mermaid` code blocks into interactive charts
- **ASCII Diagram Detection** — Detects ASCII art flowcharts/architecture diagrams and enhances them with special styling
- **Frontmatter Badges** — Displays type, dates, and tags from YAML frontmatter as colored badges
- **Wiki Link Navigation** — `[[double-bracket]]` links are clickable and navigate within the viewer
- **Table of Contents** — Auto-generated right-side TOC with scroll-tracking highlights
- **Reading Progress** — Top gradient progress bar tracks scroll position
- **Responsive Design** — Mobile-first with collapsible sidebar drawer
- **Relative Path Resolution** — Images and internal links resolve correctly for any repo structure
- **Explicit Directory Hierarchy** — Renders nested directories and uses `index.md`, `README.md`, `overview.md`, or a same-name entry page as the directory's visible anchor
- **SelfWiki Semantic Taxonomy** — The local viewer can project the existing Markdown into `SelfWiki → 大主题 → 技术专题 → 流程阶段 → 子主题/页面` without moving files

## Quick Start

```bash
# Clone
git clone https://github.com/cclank/lanshu-wiki-web.git
cd lanshu-wiki-web

# Install
pnpm install

# Dev
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and enter any GitHub repo URL.

## SelfOpenWiki 本地模式

本地模式只从服务端配置的 Wiki 根目录读取 Markdown，不接受浏览器传入的任意路径。个人工作流配置放在未纳入 Git 的 `.env.local`：

```dotenv
SELFOPENWIKI_WIKI_ROOT=D:/wiki_zxh
```

启动后打开 [http://127.0.0.1:3000/wiki/local](http://127.0.0.1:3000/wiki/local)，或从首页点击“打开个人 Wiki”。本地模式的左侧导航和“目录图”使用语义分级：根节点是 `SelfWiki`，L1 包含“场景导出”“渲染技术”“SelfWiki 使用与维护”，场景导出下包含“C7 导出流程”和“资产替换专题”，C7 下按 `Duplicate → AssetReplace → BreakInstance → MergeInstance → LightBuild → PVS → HLOD → MISM → Finalize` 展开。资产替换专题下分别展开 `AssetReplace` 和 `MeshGRASS` 的方案页面与子页面。

这层语义目录只改变可视化投影，不移动或改写 `D:/wiki_zxh` 中的 Markdown；页面仍通过原始路径和 slug 打开，未匹配的新内容会进入“其他内容（待归类）”。页面 frontmatter 的 `type`/`category` 继续作为页面分类信息。目录入口优先使用 `index.md`、`README.md`、`overview.md`，其次使用与目录同名的 Markdown 文件，例如 `scene-export.md` 对应 `scene-export/`。显示名遵循 SelfWiki Quickstart 中的分级规范：目录、目录图、脑图和关系图只显示当前层级短名，完整 frontmatter 标题仅保留给阅读、搜索和路径追溯。

本地 API 只读该配置根目录，跳过隐藏目录，并限制 Markdown 页面数量和总大小；个人 Wiki 不需要上传到 GitHub。

## Deploy to Cloudflare Workers

Production URL: https://lanshu-wiki-web.lank.workers.dev/

This project uses OpenNext for Cloudflare Workers. Optionally add `GITHUB_TOKEN` as a Worker secret to increase GitHub API rate limits.

```bash
pnpm deploy
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| Diagrams | Mermaid 11 + D3.js 7 |
| Icons | Lucide React |
| Deployment | Cloudflare Workers |

## Project Structure

```
src/
  app/
    page.tsx                    # Landing page with URL input
    api/wiki/route.ts           # GitHub API proxy
    api/wiki/local/route.ts     # Server-configured local Wiki reader
    wiki/[owner]/[repo]/page.tsx # Wiki viewer
    wiki/local/page.tsx         # SelfOpenWiki local viewer
  components/
    Sidebar.tsx                 # Explicit directory-tree navigation
    HierarchyMap.tsx            # Directory hierarchy visualization
    MarkdownContent.tsx         # Markdown renderer + diagram detection
    MermaidBlock.tsx             # Mermaid diagram renderer
    TableOfContents.tsx         # Scroll-tracking TOC
    KnowledgeGraph.tsx          # D3 force graph
    SearchDialog.tsx            # Full-text search modal
  lib/
    github.ts                   # GitHub API + wiki data builder
```

## Supported Repo Formats

Works out-of-the-box with:

- Wiki-style knowledge bases (Obsidian, GitBook, etc.)
- Awesome lists (awesome-python, awesome-go, etc.)
- Documentation repos (system-design-primer, etc.)
- Any repo with `.md` files in any directory structure

## License

MIT
