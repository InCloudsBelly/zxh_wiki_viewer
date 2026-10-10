import { readdir, readFile, realpath, stat } from "fs/promises";
import { basename, join, relative, sep } from "path";
import { buildWikiData } from "@/lib/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MD_FILES = 5000;
const MAX_MD_BYTES = 25 * 1024 * 1024;

interface CollectState {
  files: number;
  bytes: number;
}

async function collectMdFiles(
  dir: string,
  base: string,
  state: CollectState = { files: 0, bytes: 0 }
): Promise<{ path: string; content: string }[]> {
  const results: { path: string; content: string }[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      results.push(...(await collectMdFiles(fullPath, base, state)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const content = await readFile(fullPath, "utf-8");
      const relPath = relative(base, fullPath).split(sep).join("/");
      results.push({ path: relPath, content });
      state.files += 1;
      state.bytes += Buffer.byteLength(content, "utf8");
      if (state.files > MAX_MD_FILES) {
        throw new Error(`本地 Wiki 页面数量超过限制（${MAX_MD_FILES}）。`);
      }
      if (state.bytes > MAX_MD_BYTES) {
        throw new Error(`本地 Wiki 内容超过限制（${MAX_MD_BYTES / 1024 / 1024} MB）。`);
      }
    }
  }

  return results;
}

export async function GET() {
  // The root is configured on the server and is never accepted from the
  // browser. This keeps a private Wiki path out of the URL and prevents the
  // endpoint from becoming an arbitrary local-file browser.
  const configuredRoot = process.env.SELFOPENWIKI_WIKI_ROOT?.trim();
  if (!configuredRoot) {
    return Response.json(
      { error: "未配置 SELFOPENWIKI_WIKI_ROOT。请在 .env.local 中设置 Wiki 根目录。" },
      { status: 503 }
    );
  }

  try {
    const resolved = await realpath(configuredRoot);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      return Response.json(
        { error: "Path is not a directory" },
        { status: 400 }
      );
    }

    const files = await collectMdFiles(resolved, resolved);

    if (files.length === 0) {
      return Response.json(
        { error: "No .md files found in directory" },
        { status: 404 }
      );
    }

    const dirName = basename(resolved) || "local";
    const wikiData = buildWikiData("local", dirName, files, {
      hierarchyMode: "selfwiki",
    });

    return Response.json(wikiData, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
