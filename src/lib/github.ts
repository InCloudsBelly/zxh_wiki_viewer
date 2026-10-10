import matter from "gray-matter";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export interface WikiPage {
  path: string;
  slug: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  category: string;
  links: string[]; // outgoing wiki links
}

export type WikiTreeNodeKind = "root" | "directory" | "page";

/**
 * The explicit filesystem hierarchy used by the local SelfOpenWiki view.
 * Directory nodes can point at an index/overview page without duplicating that
 * page in the tree. This lets `scene-export.md` own the `scene-export/` folder
 * while keeping every Markdown page reachable exactly once.
 */
export interface WikiTreeNode {
  id: string;
  title: string;
  path: string;
  kind: WikiTreeNodeKind;
  category: string;
  level?: number;
  pageSlug?: string;
  children: WikiTreeNode[];
}

export interface WikiData {
  owner: string;
  repo: string;
  pages: WikiPage[];
  readme: string;
  categories: Record<string, WikiPage[]>;
  hierarchy: WikiTreeNode;
  graph: { nodes: GraphNode[]; links: GraphLink[] };
}

export interface GraphNode {
  id: string;
  title: string;
  displayTitle: string;
  category: string;
  level?: number;
  linkCount: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // Handle various formats:
  // https://github.com/owner/repo
  // github.com/owner/repo
  // owner/repo
  const cleaned = url.trim().replace(/\/+$/, "");
  // Strip a trailing ".git" (clone URLs) and ignore any path/query/hash that
  // follows owner/repo (e.g. ".../tree/main/docs", "?tab=readme").
  const stripRepo = (repo: string) => repo.replace(/\.git$/i, "");

  const fullMatch = cleaned.match(
    /(?:https?:\/\/)?github\.com\/([^/?#]+)\/([^/?#]+)/
  );
  if (fullMatch) return { owner: fullMatch[1], repo: stripRepo(fullMatch[2]) };

  const shortMatch = cleaned.match(/^([^/?#]+)\/([^/?#]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: stripRepo(shortMatch[2]) };

  return null;
}

export { parseGitHubUrl };

function getGitHubToken(): string | undefined {
  try {
    const token = (getCloudflareContext().env as Record<string, unknown>)
      .GITHUB_TOKEN;
    if (typeof token === "string" && token) return token;
  } catch {
    // getCloudflareContext 在非 Worker 环境不可用,回退到 process.env
  }
  return process.env.GITHUB_TOKEN;
}

const TAR_NUL = String.fromCharCode(0);
const EMPTY = new Uint8Array(0);
const TEXT_DECODER = new TextDecoder();

// Safety caps. The viewer loads every page into a single payload + graph, so a
// truly massive repo can't be rendered anyway. These bound memory/response size
// and let oversized repos fail with a clear message instead of OOM-ing.
const MAX_MD_FILES = 5000;
const MAX_MD_BYTES = 25 * 1024 * 1024; // 25 MB of Markdown

class RepoTooLargeError extends Error {
  constructor() {
    super("仓库的 Markdown 内容过大,暂不支持在线渲染(请尝试体量更小的仓库)。");
    this.name = "RepoTooLargeError";
  }
}

function readTarField(buf: Uint8Array, start: number, len: number): string {
  let end = start;
  const max = start + len;
  while (end < max && buf[end] !== 0) end++;
  return TEXT_DECODER.decode(buf.subarray(start, end));
}

// Streaming tar reader. Walks the 512-byte block structure as bytes arrive,
// keeping ONLY `.md` file bodies and discarding everything else (images, code,
// etc.) without buffering it — so peak memory stays bounded to the largest
// single Markdown file regardless of how big the overall archive is. Handles
// GitHub's git-archive output: PAX (`x`) / GNU (`L`) long-name headers, the
// global header (`g`), and the leading `repo-HEAD/` directory wrapping entries.
async function extractMarkdownFromTarStream(
  stream: ReadableStream<Uint8Array>
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  const decoder = TEXT_DECODER;
  const reader = stream.getReader();

  const header = new Uint8Array(512);
  let headerLen = 0;
  let phase: "header" | "body" = "header";
  let bodyRemaining = 0; // bytes left in the current entry (incl. padding)
  let bodySize = 0; // real content size (excl. padding)
  let bodyKeep = false; // is this an entry we collect (md / x / L)?
  let bodyType = "";
  let bodyName = "";
  let collected: Uint8Array | null = null;
  let collectedLen = 0;
  let overrideName: string | null = null; // long name from a preceding x/L
  let totalBytes = 0;
  let ended = false;

  const finalizeEntry = () => {
    const data = collected ? collected.subarray(0, collectedLen) : EMPTY;
    if (bodyType === "x") {
      // PAX extended header: pull the real path from "<len> path=<value>\n".
      const match = decoder.decode(data).match(/\d+ path=(.*)\n/);
      if (match) overrideName = match[1];
    } else if (bodyType === "L") {
      // GNU long name: full path lives in this entry's data block.
      overrideName = decoder.decode(data).replace(new RegExp(TAR_NUL + "+$"), "");
    } else if (bodyType === "0" || bodyType === TAR_NUL) {
      const fullName = overrideName ?? bodyName;
      overrideName = null;
      if (fullName.endsWith(".md")) {
        // Strip the wrapper dir: "repo-HEAD/concepts/x.md" -> "concepts/x.md".
        const slash = fullName.indexOf("/");
        const path = slash >= 0 ? fullName.slice(slash + 1) : fullName;
        if (path) {
          files.push({ path, content: decoder.decode(data) });
          totalBytes += bodySize;
          if (files.length > MAX_MD_FILES || totalBytes > MAX_MD_BYTES) {
            throw new RepoTooLargeError();
          }
        }
      }
    } else {
      // Directory or other type — clears any pending long name.
      overrideName = null;
    }
    collected = null;
    collectedLen = 0;
  };

  try {
    while (!ended) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value;
      let pos = 0;
      while (pos < chunk.length) {
        if (phase === "header") {
          const take = Math.min(512 - headerLen, chunk.length - pos);
          header.set(chunk.subarray(pos, pos + take), headerLen);
          headerLen += take;
          pos += take;
          if (headerLen < 512) break; // need more bytes for a full header
          headerLen = 0;

          // A zero-filled block marks the end of the archive.
          let allZero = true;
          for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
              allZero = false;
              break;
            }
          }
          if (allZero) {
            ended = true;
            break;
          }

          bodyName = readTarField(header, 0, 100);
          bodySize = parseInt(readTarField(header, 124, 12).trim(), 8) || 0;
          bodyType = String.fromCharCode(header[156]);
          bodyRemaining = Math.ceil(bodySize / 512) * 512;
          const candidate = overrideName ?? bodyName;
          bodyKeep =
            bodyType === "x" ||
            bodyType === "L" ||
            ((bodyType === "0" || bodyType === TAR_NUL) &&
              candidate.endsWith(".md"));
          if (bodyKeep) {
            collected = new Uint8Array(bodySize);
            collectedLen = 0;
          }
          if (bodyRemaining === 0) {
            finalizeEntry();
          } else {
            phase = "body";
          }
        } else {
          const take = Math.min(bodyRemaining, chunk.length - pos);
          if (bodyKeep && collected) {
            // Copy content bytes only, never the trailing 512-byte padding.
            const keepNow = Math.min(take, bodySize - collectedLen);
            if (keepNow > 0) {
              collected.set(chunk.subarray(pos, pos + keepNow), collectedLen);
              collectedLen += keepNow;
            }
          }
          pos += take;
          bodyRemaining -= take;
          if (bodyRemaining === 0) {
            finalizeEntry();
            phase = "header";
          }
        }
      }
    }
  } finally {
    // Stop the download early on cap-hit / completion.
    try {
      await reader.cancel();
    } catch {
      // ignore — stream already closed
    }
  }

  return files;
}

export async function fetchRepoMarkdown(
  owner: string,
  repo: string
): Promise<{ path: string; content: string }[]> {
  const token = getGitHubToken();
  // Download the entire repo as ONE gzipped tarball instead of one request per
  // file. The previous "fetch per file" approach cost N+1 subrequests, which
  // blew past Cloudflare Workers' per-request subrequest limit (50 on the free
  // plan) for any sizeable wiki — silently dropping every file past the limit.
  // One streamed tarball = one subrequest, and never truncates.
  const res = await fetch(
    `https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`,
    {
      headers: {
        "User-Agent": "lanshu-wiki-web",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 300 }, // cache for 5 mins
    }
  );

  if (res.status === 404) {
    throw new Error(
      `未找到仓库 ${owner}/${repo}(请确认它存在且为公开仓库)。`
    );
  }
  if (!res.ok || !res.body) {
    throw new Error(`GitHub archive error: ${res.status} ${res.statusText}`);
  }

  const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
  return extractMarkdownFromTarStream(decompressed);
}

function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  try {
    const parsed = matter(content);
    return {
      frontmatter: parsed.data as Record<string, unknown>,
      body: parsed.content,
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWikiPath(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original path when a malformed escape is present.
  }

  const segments: string[] = [];
  for (const segment of decoded.replace(/\\/g, "/").split("/")) {
    const trimmed = segment.trim();
    if (!trimmed || trimmed === ".") continue;
    if (trimmed === "..") {
      segments.pop();
      continue;
    }
    segments.push(trimmed);
  }
  return segments.join("/");
}

function dirname(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash < 0 ? "" : value.slice(0, slash);
}

function basename(value: string): string {
  const slash = value.lastIndexOf("/");
  return slash < 0 ? value : value.slice(slash + 1);
}

function withoutExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

function cleanMarkdownTarget(rawLink: string): string {
  const trimmed = rawLink.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    if (closing >= 0) return trimmed.slice(1, closing);
  }
  return trimmed.split(/\s+/)[0] ?? "";
}

function normalizeWikiLinkTarget(
  rawLink: string,
  sourcePath?: string,
  resolveRelative = false
): string {
  let target = cleanMarkdownTarget(rawLink)
    .split("|")[0]
    .split("#")[0]
    .trim();

  if (
    !target ||
    target.startsWith("#") ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)
  ) {
    return "";
  }

  // Obsidian-style `[[Page]]` links commonly use a basename. Keep those
  // basename-friendly, while resolving path-like links relative to the page.
  if (sourcePath && (resolveRelative || target.includes("/"))) {
    target = target.startsWith("/")
      ? target.slice(1)
      : `${dirname(sourcePath)}/${target}`;
  }

  return withoutExtension(normalizeWikiPath(target)).toLowerCase();
}

function extractWikiLinks(content: string, sourcePath: string): string[] {
  const links: string[] = [];
  const wikiRegex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wikiRegex.exec(content)) !== null) {
    const target = normalizeWikiLinkTarget(match[1], sourcePath);
    if (target) links.push(target);
  }

  // The personal Wiki uses ordinary Markdown relative links. LanShu's
  // original parser only understood `[[...]]`, which made the relationship
  // graph silently lose most of this Wiki's edges.
  const markdownRegex = /(!?)\[[^\]]*\]\(([^)]+)\)/g;
  while ((match = markdownRegex.exec(content)) !== null) {
    if (match[1] === "!") continue;
    const target = normalizeWikiLinkTarget(match[2], sourcePath, true);
    if (target) links.push(target);
  }

  return [...new Set(links)];
}

function inferCategory(
  path: string,
  frontmatter: Record<string, unknown>
): string {
  const explicit =
    stringValue(frontmatter.category) ?? stringValue(frontmatter.type);
  if (explicit) return explicit;

  const parts = path.split("/");
  if (parts.length > 1) {
    return parts[parts.length - 2];
  }
  return "root";
}

function slugFromPath(path: string): string {
  return withoutExtension(normalizeWikiPath(path)).replace(/\//g, "__");
}

const DISPLAY_PATH_SEGMENT_LABELS: Record<string, string> = {
  "merge-instance": "MergeInstance",
  common: "通用机制",
};

function displayPathSegment(segment: string): string {
  const normalizedSegment = segment.toLowerCase();
  const explicitLabel = DISPLAY_PATH_SEGMENT_LABELS[normalizedSegment];
  if (explicitLabel) return explicitLabel;

  return segment
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISPLAY_TITLE_ROLE_PREFIX =
  /^(?:阶段入口|子步骤|Builder|失败与验证|运行时与产物)\s*[:：]\s*/u;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Display names are intentionally local to the current hierarchy level.
 * Markdown frontmatter keeps the full breadcrumb for provenance/search, while
 * taxonomy and relationship views use this compact label to avoid repeating
 * every ancestor in each leaf node.
 */
function getDisplayTitle(title: string, pagePath?: string): string {
  const original = title.trim();
  if (!original) return title;

  let local = original
    .split(/\s*\/\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .pop() ?? original;

  local = local
    .replace(/^\d+(?:[-_.\s]+)+/u, "")
    .replace(DISPLAY_TITLE_ROLE_PREFIX, "")
    .trim();

  if (pagePath) {
    const parentSegment = basename(dirname(normalizeWikiPath(pagePath)));
    const parentLabel = displayPathSegment(parentSegment);
    if (parentLabel) {
      const parentPattern = parentLabel
        .split(/\s+/u)
        .filter(Boolean)
        .map(escapeRegExp)
        .join("\\s*");
      // A one-word directory such as `hlod` should only be removed when it is
      // an explicit prefix (`HLOD：...`), not from names such as `HLOD Setup`.
      const delimiter = parentLabel.includes(" ")
        ? "(?:\\s*[:：]\\s*|\\s+)"
        : "(?:\\s*[:：]\\s*)";
      local = local
        .replace(new RegExp(`^${parentPattern}${delimiter}`, "iu"), "")
        .trim();
    }
  }

  return local || original;
}

function buildHierarchy(repo: string, pages: WikiPage[]): WikiTreeNode {
  const root: WikiTreeNode = {
    id: "dir:",
    title: repo,
    path: "",
    kind: "root",
    category: "root",
    level: 0,
    children: [],
  };
  const directories = new Map<string, WikiTreeNode>([["", root]]);

  function ensureDirectory(directoryPath: string): WikiTreeNode {
    const normalized = normalizeWikiPath(directoryPath);
    const existing = directories.get(normalized);
    if (existing) return existing;

    const parentPath = dirname(normalized);
    const parent = ensureDirectory(parentPath);
    const node: WikiTreeNode = {
      id: `dir:${normalized}`,
      title: displayPathSegment(basename(normalized)),
      path: normalized,
      kind: "directory",
      category: parent.category,
      level: (parent.level ?? 0) + 1,
      children: [],
    };
    directories.set(normalized, node);
    parent.children.push(node);
    return node;
  }

  const pageByPath = new Map<string, WikiPage>();
  for (const page of pages) {
    const normalizedPath = normalizeWikiPath(page.path).toLowerCase();
    pageByPath.set(normalizedPath, page);

    const directory = dirname(normalizeWikiPath(page.path));
    const parts = directory ? directory.split("/") : [];
    for (let i = 1; i <= parts.length; i++) {
      ensureDirectory(parts.slice(0, i).join("/"));
    }
  }

  const representativePaths = new Map<string, string>();
  for (const directoryPath of directories.keys()) {
    const candidates = directoryPath
      ? [
          `${directoryPath}/index.md`,
          `${directoryPath}/README.md`,
          `${directoryPath}/overview.md`,
          `${directoryPath}.md`,
        ]
      : ["index.md", "README.md"];
    const representative = candidates.find((candidate) =>
      pageByPath.has(candidate.toLowerCase())
    );
    if (representative) representativePaths.set(directoryPath, representative);
  }

  for (const [directoryPath, representativePath] of representativePaths) {
    const directory = directories.get(directoryPath);
    const page = pageByPath.get(representativePath.toLowerCase());
    if (!directory || !page) continue;
    directory.title = getDisplayTitle(page.title, page.path);
    directory.category = page.category;
    directory.pageSlug = page.slug;
  }

  const representedPages = new Set(
    [...representativePaths.values()].map((value) => normalizeWikiPath(value).toLowerCase())
  );
  for (const page of pages) {
    if (representedPages.has(normalizeWikiPath(page.path).toLowerCase())) continue;
    const directory = ensureDirectory(dirname(normalizeWikiPath(page.path)));
    directory.children.push({
      id: page.slug,
      title: getDisplayTitle(page.title, page.path),
      path: normalizeWikiPath(page.path),
      kind: "page",
      category: page.category,
      level: (directory.level ?? 0) + 1,
      pageSlug: page.slug,
      children: [],
    });
  }

  function sortChildren(node: WikiTreeNode): void {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "page" ? 1 : -1;
      return a.title.localeCompare(b.title, "zh-CN");
    });
    for (const child of node.children) sortChildren(child);
  }
  sortChildren(root);
  return root;
}

type TaxonomySelector = {
  exact?: string[];
  prefixes?: string[];
};

type SelfWikiTaxonomyDefinition = {
  key: string;
  title: string;
  level: number;
  category: string;
  selector?: TaxonomySelector;
  representative?: string;
  physicalRoot?: string;
  children?: SelfWikiTaxonomyDefinition[];
};

function normalizedTaxonomyPath(value: string): string {
  return normalizeWikiPath(value).toLowerCase();
}

function exactPath(...paths: string[]): TaxonomySelector {
  return { exact: paths };
}

function pathPrefix(...prefixes: string[]): TaxonomySelector {
  return { prefixes };
}

function exactOrDirectory(prefix: string): TaxonomySelector {
  return {
    exact: [`${prefix}.md`],
    prefixes: [prefix],
  };
}

function unionSelectors(
  ...selectors: TaxonomySelector[]
): TaxonomySelector {
  return {
    exact: selectors.flatMap((selector) => selector.exact ?? []),
    prefixes: selectors.flatMap((selector) => selector.prefixes ?? []),
  };
}

function matchesTaxonomySelector(
  path: string,
  selector: TaxonomySelector | undefined
): boolean {
  if (!selector) return true;
  const normalized = normalizedTaxonomyPath(path);
  return (
    (selector.exact ?? []).some(
      (candidate) => normalized === normalizedTaxonomyPath(candidate)
    ) ||
    (selector.prefixes ?? []).some((candidate) => {
      const prefix = normalizedTaxonomyPath(candidate).replace(/\/$/, "");
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    })
  );
}

function buildTaxonomyPageNode(
  page: WikiPage,
  level: number,
  idPrefix: string
): WikiTreeNode {
  return {
    id: `${idPrefix}:page:${page.slug}`,
    title: getDisplayTitle(page.title, page.path),
    path: normalizeWikiPath(page.path),
    kind: "page",
    category: page.category,
    level,
    pageSlug: page.slug,
    children: [],
  };
}

function buildPhysicalTaxonomyChildren(
  pages: WikiPage[],
  level: number,
  namespace: string,
  physicalRoot?: string
): WikiTreeNode[] {
  const base = physicalRoot
    ? normalizedTaxonomyPath(physicalRoot)
    : "";
  const relativePath = (pagePath: string): string => {
    const normalized = normalizeWikiPath(pagePath);
    const normalizedLower = normalized.toLowerCase();
    if (base && normalizedLower.startsWith(`${base}/`)) {
      return normalized.slice(base.length + 1);
    }
    return normalized;
  };

  const root: WikiTreeNode = {
    id: `${namespace}:physical-root`,
    title: "",
    path: physicalRoot ?? "",
    kind: "directory",
    category: "子主题",
    level: Math.max(level - 1, 0),
    children: [],
  };
  const directories = new Map<string, WikiTreeNode>([["", root]]);
  const pageByRelativePath = new Map<string, WikiPage>();

  function ensureDirectory(relativeDirectory: string): WikiTreeNode {
    const normalized = normalizeWikiPath(relativeDirectory);
    const existing = directories.get(normalized);
    if (existing) return existing;

    const parentPath = dirname(normalized);
    const parent = ensureDirectory(parentPath);
    const node: WikiTreeNode = {
      id: `${namespace}:dir:${normalized}`,
      title: displayPathSegment(basename(normalized)),
      path: base
        ? `${base}/${normalized}`
        : normalized,
      kind: "directory",
      category: "子主题",
      level: (parent.level ?? level) + 1,
      children: [],
    };
    directories.set(normalized, node);
    parent.children.push(node);
    return node;
  }

  for (const page of pages) {
    const relative = relativePath(page.path);
    pageByRelativePath.set(relative.toLowerCase(), page);
    const directory = dirname(relative);
    const parts = directory ? directory.split("/") : [];
    for (let index = 1; index <= parts.length; index += 1) {
      ensureDirectory(parts.slice(0, index).join("/"));
    }
  }

  const representativePaths = new Map<string, string>();
  for (const directoryPath of directories.keys()) {
    if (!directoryPath) continue;
    const candidates = [
      `${directoryPath}/index.md`,
      `${directoryPath}/README.md`,
      `${directoryPath}/overview.md`,
      `${directoryPath}.md`,
    ];
    const representative = candidates.find((candidate) =>
      pageByRelativePath.has(candidate.toLowerCase())
    );
    if (representative) representativePaths.set(directoryPath, representative);
  }

  for (const [directoryPath, representativePath] of representativePaths) {
    const directory = directories.get(directoryPath);
    const page = pageByRelativePath.get(representativePath.toLowerCase());
    if (!directory || !page) continue;
    directory.title = getDisplayTitle(page.title, page.path);
    directory.category = page.category;
    directory.pageSlug = page.slug;
  }

  const representedPages = new Set(
    [...representativePaths.values()].map((value) => value.toLowerCase())
  );
  for (const page of pages) {
    const relative = relativePath(page.path);
    if (representedPages.has(relative.toLowerCase())) continue;
    const directory = ensureDirectory(dirname(relative));
    directory.children.push(
      buildTaxonomyPageNode(
        page,
        (directory.level ?? level) + 1,
        namespace
      )
    );
  }

  function sortChildren(node: WikiTreeNode): void {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "page" ? 1 : -1;
      return a.path.localeCompare(b.path, "zh-CN", { numeric: true });
    });
    for (const child of node.children) sortChildren(child);
  }
  sortChildren(root);
  return root.children;
}

function sceneExportTaxonomy(): SelfWikiTaxonomyDefinition {
  const sceneRoot = "unreal-engine/scene-export";
  const mobileRoot = "projects/mobile-asset-replacement";
  const shadowVisibility = `${sceneRoot}/shadow-visibility`;
  const common = `${sceneRoot}/common`;
  const mismRoot = `${sceneRoot}/mism`;

  const overviewPages = [
    `${sceneRoot}/00-overview.md`,
    `${sceneRoot}/01-preparation-and-config.md`,
    `${sceneRoot}/02-collection-and-references.md`,
    `${sceneRoot}/03-worldpartition-instance-hlod.md`,
    `${sceneRoot}/04-platform-and-actor-processing.md`,
    `${sceneRoot}/05-lighting-and-runtime-data.md`,
    `${sceneRoot}/07-common-tools-and-troubleshooting.md`,
  ];

  const lightBuild = (key: string, title: string, root: string) => ({
    key,
    title,
    level: 4,
    category: "子主题",
    selector: exactOrDirectory(root),
    representative: `${root}.md`,
    physicalRoot: root,
  });

  const mismTopic = (
    key: string,
    title: string,
    root: string,
    selector: TaxonomySelector = exactOrDirectory(root),
    physicalRoot = root
  ): SelfWikiTaxonomyDefinition => ({
    key,
    title,
    level: 4,
    category: "子主题",
    selector,
    representative: `${root}.md`,
    physicalRoot,
  });

  const heightOcclusionShadowSelector = exactPath(
    `${mismRoot}/height-occlusion-shadow.md`,
    `${mismRoot}/actor-volume-media-proxy-integration.md`,
    `${mismRoot}/failure-boundaries-and-verification.md`,
    `${mismRoot}/height-map-generation-and-occlusion-data.md`,
    `${mismRoot}/world-partition-occlusion-height-map-builder.md`,
    `${mismRoot}/pipeline-entry-and-parameters.md`,
    `${mismRoot}/save-source-control-and-cleanup.md`
  );

  const stageDefinitions: SelfWikiTaxonomyDefinition[] = [
    {
      key: "duplicate",
      title: "Duplicate",
      level: 3,
      category: "流程阶段",
      selector: exactOrDirectory(`${sceneRoot}/duplicate`),
      representative: `${sceneRoot}/duplicate.md`,
      physicalRoot: `${sceneRoot}/duplicate`,
    },
    {
      key: "asset-replace-stage",
      title: "AssetReplace",
      level: 3,
      category: "流程阶段",
      selector: exactOrDirectory(`${sceneRoot}/asset-replace`),
      representative: `${sceneRoot}/asset-replace.md`,
      physicalRoot: `${sceneRoot}/asset-replace`,
    },
    {
      key: "break-instance",
      title: "BreakInstance",
      level: 3,
      category: "流程阶段",
      selector: exactOrDirectory(`${sceneRoot}/break-instance`),
      representative: `${sceneRoot}/break-instance.md`,
      physicalRoot: `${sceneRoot}/break-instance`,
    },
    {
      key: "merge-instance",
      title: "MergeInstance",
      level: 3,
      category: "流程阶段",
      selector: unionSelectors(
        exactOrDirectory(`${sceneRoot}/merge-instance`),
        exactOrDirectory(`${sceneRoot}/shader-compile`)
      ),
      representative: `${sceneRoot}/merge-instance.md`,
      physicalRoot: sceneRoot,
    },
    {
      key: "light-build",
      title: "LightBuild",
      level: 3,
      category: "流程阶段",
      selector: unionSelectors(
        exactPath(`${sceneRoot}/05-lighting-and-runtime-data.md`),
        exactOrDirectory(`${sceneRoot}/process-actor`),
        exactOrDirectory(`${sceneRoot}/reflection-capture`),
        exactOrDirectory(`${sceneRoot}/reflection-capture-id`),
        exactOrDirectory(`${sceneRoot}/skylight-cubemap`)
      ),
      children: [
        lightBuild("process-actor", "Process Actor Before", `${sceneRoot}/process-actor`),
        lightBuild("reflection-capture", "Build Reflection Capture", `${sceneRoot}/reflection-capture`),
        lightBuild("reflection-capture-id", "Build Reflection Capture ID", `${sceneRoot}/reflection-capture-id`),
        lightBuild("skylight-cubemap", "Build SkyLight Cubemap", `${sceneRoot}/skylight-cubemap`),
        {
          key: "light-build-overview",
          title: "LightBuild 流程说明",
          level: 4,
          category: "子主题",
          selector: exactPath(`${sceneRoot}/05-lighting-and-runtime-data.md`),
          physicalRoot: sceneRoot,
        },
      ],
    },
    {
      key: "pvs",
      title: "PVS",
      level: 3,
      category: "流程阶段",
      selector: exactOrDirectory(shadowVisibility),
      children: [
        {
          key: "shadow-visibility",
          title: "Shadow Visibility",
          level: 4,
          category: "子主题",
          selector: exactOrDirectory(shadowVisibility),
          representative: `${shadowVisibility}.md`,
          physicalRoot: shadowVisibility,
        },
      ],
    },
    {
      key: "hlod",
      title: "HLOD",
      level: 3,
      category: "流程阶段",
      selector: unionSelectors(
        exactOrDirectory(`${sceneRoot}/hlod`),
        exactOrDirectory(`${sceneRoot}/hlod-exclude`),
        exactOrDirectory(`${sceneRoot}/hlod-visibility`)
      ),
      representative: `${sceneRoot}/hlod.md`,
      children: [
        {
          key: "hlod-exclude",
          title: "HLOD Exclude",
          level: 4,
          category: "子主题",
          selector: exactOrDirectory(`${sceneRoot}/hlod-exclude`),
          representative: `${sceneRoot}/hlod-exclude.md`,
          physicalRoot: `${sceneRoot}/hlod-exclude`,
        },
        {
          key: "hlod-visibility",
          title: "HLOD Visibility",
          level: 4,
          category: "子主题",
          selector: exactOrDirectory(`${sceneRoot}/hlod-visibility`),
          representative: `${sceneRoot}/hlod-visibility.md`,
          physicalRoot: `${sceneRoot}/hlod-visibility`,
        },
        {
          key: "hlod-build",
          title: "HLOD 构建与 FinalizeHLOD",
          level: 4,
          category: "子主题",
          selector: exactOrDirectory(`${sceneRoot}/hlod`),
          physicalRoot: `${sceneRoot}/hlod`,
        },
      ],
    },
    {
      key: "mism",
      title: "MISM",
      level: 3,
      category: "流程阶段",
      selector: exactOrDirectory(mismRoot),
      representative: `${mismRoot}.md`,
      children: [
        mismTopic(
          "height-occlusion-shadow",
          "Height Occlusion Shadow",
          `${mismRoot}/height-occlusion-shadow`,
          heightOcclusionShadowSelector,
          mismRoot
        ),
        mismTopic("offline-height-map", "Offline Height Map", `${mismRoot}/offline-height-map-builder`),
        mismTopic("mobile-ism", "Build Mobile ISM", `${mismRoot}/mobile-ism`),
        mismTopic("planar-reflection-bake", "Planar Reflection Bake", `${mismRoot}/planar-reflection-bake`),
        mismTopic("shadow-map-compress", "Shadow Map Compress", `${mismRoot}/shadow-map-compress`),
        mismTopic("texture-streaming", "Build Texture Streaming", `${mismRoot}/texture-streaming`),
      ],
    },
    {
      key: "finalize",
      title: "Finalize",
      level: 3,
      category: "流程阶段",
      selector: exactPath(`${sceneRoot}/06-finalize-and-validation.md`),
      representative: `${sceneRoot}/06-finalize-and-validation.md`,
    },
    {
      key: "flow-overview",
      title: "流程总览与通用机制",
      level: 3,
      category: "子主题",
      selector: unionSelectors(
        exactPath(...overviewPages),
        exactPath(`${sceneRoot}/common.md`, `${sceneRoot}/world-partition-builder-lifecycle.md`),
        pathPrefix(common)
      ),
      children: [
        {
          key: "common-mechanism",
          title: "WorldPartitionBuilder 通用机制",
          level: 4,
          category: "子主题",
          selector: unionSelectors(
            exactPath(`${sceneRoot}/common.md`, `${sceneRoot}/world-partition-builder-lifecycle.md`),
            pathPrefix(common)
          ),
          representative: `${sceneRoot}/common.md`,
          physicalRoot: sceneRoot,
        },
        {
          key: "flow-reference-pages",
          title: "C7 流程说明",
          level: 4,
          category: "子主题",
          selector: exactPath(...overviewPages),
          physicalRoot: sceneRoot,
        },
      ],
    },
  ];

  return {
    key: "scene-export",
    title: "场景导出",
    level: 1,
    category: "大主题",
    selector: unionSelectors(
      exactOrDirectory(sceneRoot),
      pathPrefix(mobileRoot),
      exactPath("sources/mobile-asset-replacement-source-set.md")
    ),
    children: [
      {
        key: "c7-export-flow",
        title: "C7 导出流程",
        level: 2,
        category: "技术专题",
        selector: exactOrDirectory(sceneRoot),
        representative: `${sceneRoot}.md`,
        children: stageDefinitions,
      },
      {
        key: "asset-replacement-topic",
        title: "资产替换专题",
        level: 2,
        category: "技术专题",
        selector: unionSelectors(
          pathPrefix(mobileRoot),
          exactPath("sources/mobile-asset-replacement-source-set.md")
        ),
        representative: `${mobileRoot}/overview.md`,
        children: [
          {
            key: "asset-replace-solution",
            title: "AssetReplace 方案",
            level: 3,
            category: "子主题",
            selector: exactOrDirectory(`${mobileRoot}/asset-replace`),
            representative: `${mobileRoot}/asset-replace.md`,
            physicalRoot: `${mobileRoot}/asset-replace`,
          },
          {
            key: "meshgrass-solution",
            title: "MeshGRASS 方案",
            level: 3,
            category: "子主题",
            selector: exactOrDirectory(`${mobileRoot}/meshgrass`),
            representative: `${mobileRoot}/meshgrass.md`,
            physicalRoot: `${mobileRoot}/meshgrass`,
          },
          {
            key: "asset-replacement-evidence",
            title: "资产替换来源与证据边界",
            level: 3,
            category: "子主题",
            selector: exactPath("sources/mobile-asset-replacement-source-set.md"),
            physicalRoot: "sources",
          },
        ],
      },
    ],
  };
}

function renderingTaxonomy(): SelfWikiTaxonomyDefinition {
  const kgprPaths = [
    "architecture",
    "data",
    "history",
    "integration",
    "maintenance",
    "optimization",
    "overview",
    "reference",
    "rendering",
  ];
  return {
    key: "rendering",
    title: "渲染技术",
    level: 1,
    category: "大主题",
    selector: unionSelectors(
      ...kgprPaths.map((path) => pathPrefix(path)),
      exactPath("sources/kgpr-source-set.md")
    ),
    children: [
      {
        key: "kgpr-topic",
        title: "KGPR 技术专题",
        level: 2,
        category: "技术专题",
        selector: unionSelectors(
          ...kgprPaths.map((path) => pathPrefix(path)),
          exactPath("sources/kgpr-source-set.md")
        ),
        representative: "overview/comprehensive-technical-design.md",
        children: [
          {
            key: "kgpr-design",
            title: "总体设计与架构",
            level: 3,
            category: "子主题",
            selector: exactPath(
              "architecture/current-architecture.md",
            ),
            physicalRoot: "architecture",
          },
          {
            key: "kgpr-data",
            title: "数据模型",
            level: 3,
            category: "子主题",
            selector: pathPrefix("data"),
            physicalRoot: "data",
          },
          {
            key: "kgpr-rendering",
            title: "渲染流程",
            level: 3,
            category: "子主题",
            selector: pathPrefix("rendering"),
            physicalRoot: "rendering",
          },
          {
            key: "kgpr-integration",
            title: "引擎集成边界",
            level: 3,
            category: "子主题",
            selector: pathPrefix("integration"),
            physicalRoot: "integration",
          },
          {
            key: "kgpr-history",
            title: "演进与决策记录",
            level: 3,
            category: "子主题",
            selector: pathPrefix("history"),
            physicalRoot: "history",
          },
          {
            key: "kgpr-optimization",
            title: "优化策略与 Backlog",
            level: 3,
            category: "子主题",
            selector: pathPrefix("optimization"),
            physicalRoot: "optimization",
          },
          {
            key: "kgpr-maintenance",
            title: "验证、排障与升级",
            level: 3,
            category: "子主题",
            selector: pathPrefix("maintenance"),
            physicalRoot: "maintenance",
          },
          {
            key: "kgpr-reference",
            title: "设计模式参考",
            level: 3,
            category: "子主题",
            selector: pathPrefix("reference"),
            physicalRoot: "reference",
          },
          {
            key: "kgpr-evidence",
            title: "来源与证据边界",
            level: 3,
            category: "子主题",
            selector: exactPath("sources/kgpr-source-set.md"),
            physicalRoot: "sources",
          },
          {
            key: "kgpr-overview",
            title: "KGPR 总体技术设计",
            level: 3,
            category: "子主题",
            selector: exactPath("overview/comprehensive-technical-design.md"),
            physicalRoot: "overview",
          },
        ],
      },
    ],
  };
}

function buildSelfWikiTaxonomyDefinition(): SelfWikiTaxonomyDefinition[] {
  return [
    sceneExportTaxonomy(),
    renderingTaxonomy(),
    {
      key: "selfwiki-guides",
      title: "SelfWiki 使用与维护",
      level: 1,
      category: "大主题",
      selector: exactPath("quickstart.md"),
      children: [
        {
          key: "quickstart",
          title: "快速开始",
          level: 2,
          category: "子主题",
          selector: exactPath("quickstart.md"),
        },
      ],
    },
  ];
}

function buildSelfWikiTaxonomyNode(
  definition: SelfWikiTaxonomyDefinition,
  pages: WikiPage[]
): WikiTreeNode | null {
  const selected = pages.filter((page) =>
    matchesTaxonomySelector(page.path, definition.selector)
  );
  if (selected.length === 0) return null;

  const representativePath = definition.representative
    ? normalizedTaxonomyPath(definition.representative)
    : "";
  const representative = selected.find(
    (page) => normalizedTaxonomyPath(page.path) === representativePath
  );
  const childNodes: WikiTreeNode[] = [];
  const claimed = new Set<string>();
  if (representative) claimed.add(normalizedTaxonomyPath(representative.path));

  for (const child of definition.children ?? []) {
    const childPages = selected.filter((page) => {
      const path = normalizedTaxonomyPath(page.path);
      if (claimed.has(path)) return false;
      return matchesTaxonomySelector(page.path, child.selector);
    });
    const childNode = buildSelfWikiTaxonomyNode(child, childPages);
    if (!childNode) continue;
    childNodes.push(childNode);
    for (const page of childPages) {
      claimed.add(normalizedTaxonomyPath(page.path));
    }
  }

  const directPages = selected.filter(
    (page) => !claimed.has(normalizedTaxonomyPath(page.path))
  );
  childNodes.push(
    ...buildPhysicalTaxonomyChildren(
      directPages,
      definition.level + 1,
      `taxonomy:${definition.key}`,
      definition.physicalRoot
    )
  );

  return {
    id: `taxonomy:${definition.key}`,
    title: definition.title,
    path: `taxonomy/${definition.key}`,
    kind: definition.level === 0 ? "root" : "directory",
    category: definition.category,
    level: definition.level,
    pageSlug: representative?.slug,
    children: childNodes,
  };
}

export function buildSelfWikiHierarchy(pages: WikiPage[]): WikiTreeNode {
  const root: WikiTreeNode = {
    id: "taxonomy:selfwiki",
    title: "SelfWiki",
    path: "",
    kind: "root",
    category: "SelfWiki",
    level: 0,
    children: [],
  };
  const claimed = new Set<string>();

  for (const definition of buildSelfWikiTaxonomyDefinition()) {
    const selected = pages.filter((page) =>
      matchesTaxonomySelector(page.path, definition.selector)
    );
    const node = buildSelfWikiTaxonomyNode(definition, selected);
    if (!node) continue;
    root.children.push(node);
    for (const page of selected) {
      claimed.add(normalizedTaxonomyPath(page.path));
    }
  }

  const unclassified = pages.filter(
    (page) => !claimed.has(normalizedTaxonomyPath(page.path))
  );
  if (unclassified.length > 0) {
    root.children.push({
      id: "taxonomy:unclassified",
      title: "其他内容（待归类）",
      path: "taxonomy/unclassified",
      kind: "directory",
      category: "待归类",
      level: 1,
      children: buildPhysicalTaxonomyChildren(
        unclassified,
        2,
        "taxonomy:unclassified"
      ),
    });
  }

  return root;
}

export type WikiHierarchyMode = "filesystem" | "selfwiki";

export function buildWikiData(
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
  options: { hierarchyMode?: WikiHierarchyMode } = {}
): WikiData {
  const pages: WikiPage[] = [];
  let readme = "";

  for (const file of [...files].sort((a, b) =>
    normalizeWikiPath(a.path).localeCompare(normalizeWikiPath(b.path))
  )) {
    const normalizedPath = normalizeWikiPath(file.path);
    const { frontmatter, body } = parseFrontmatter(file.content);
    const links = extractWikiLinks(file.content, normalizedPath);
    const slug = slugFromPath(normalizedPath);
    const category = inferCategory(normalizedPath, frontmatter);

    const title =
      stringValue(frontmatter.title) ||
      normalizedPath
        .split("/")
        .pop()!
        .replace(/\.md$/, "")
        .replace(/-/g, " ");

    if (
      normalizedPath.toLowerCase() === "readme.md" ||
      normalizedPath.toLowerCase() === "index.md"
    ) {
      readme = body;
    }

    pages.push({
      path: normalizedPath,
      slug,
      title,
      content: body,
      frontmatter,
      category,
      links,
    });
  }

  // Build categories
  const categories: Record<string, WikiPage[]> = {};
  for (const page of pages) {
    if (!categories[page.category]) {
      categories[page.category] = [];
    }
    categories[page.category].push(page);
  }
  // Sort pages within each category
  for (const cat of Object.keys(categories)) {
    categories[cat].sort((a, b) => a.title.localeCompare(b.title));
  }

  const hierarchy =
    options.hierarchyMode === "selfwiki"
      ? buildSelfWikiHierarchy(pages)
      : buildHierarchy(repo, pages);
  const pageLevels = new Map<string, number>();

  function collectPageLevels(node: WikiTreeNode): void {
    if (node.pageSlug !== undefined && node.level !== undefined) {
      const previousLevel = pageLevels.get(node.pageSlug);
      pageLevels.set(
        node.pageSlug,
        previousLevel === undefined
          ? node.level
          : Math.max(previousLevel, node.level)
      );
    }
    for (const child of node.children) collectPageLevels(child);
  }
  collectPageLevels(hierarchy);

  // Build knowledge graph
  const slugSet = new Set(pages.map((p) => p.slug));
  const slugByName = new Map<string, string>();
  const directorySlug = new Map<string, string>();
  for (const p of pages) {
    const name = withoutExtension(basename(p.path)).toLowerCase();
    const path = p.path.toLowerCase();
    const pathWithoutExtension = withoutExtension(path);
    if (!slugByName.has(name)) slugByName.set(name, p.slug);
    slugByName.set(path, p.slug);
    slugByName.set(pathWithoutExtension, p.slug);

    const directory = dirname(p.path).toLowerCase();
    if (
      name === "index" ||
      name === "readme" ||
      name === "overview" ||
      name === basename(directory)
    ) {
      directorySlug.set(directory, p.slug);
    }
    // A sibling entry page such as `scene-export.md` is also the explicit
    // entry for the `scene-export/` directory.
    const siblingDirectory = `${directory ? `${directory}/` : ""}${name}`;
    directorySlug.set(siblingDirectory, p.slug);
  }

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.slug,
    title: p.title,
    displayTitle: getDisplayTitle(p.title, p.path),
    category: p.category,
    level: pageLevels.get(p.slug),
    linkCount: p.links.length,
  }));

  const links: GraphLink[] = [];
  for (const page of pages) {
    for (const link of page.links) {
      const targetSlug =
        slugByName.get(link) ?? directorySlug.get(link.replace(/\/$/, ""));
      if (targetSlug && slugSet.has(targetSlug)) {
        links.push({ source: page.slug, target: targetSlug });
      }
    }
  }

  return {
    owner,
    repo,
    pages,
    readme,
    categories,
    hierarchy,
    graph: { nodes, links },
  };
}
