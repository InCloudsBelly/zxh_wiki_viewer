"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  Search,
} from "lucide-react";
import type { WikiTreeNode } from "@/lib/github";

interface SidebarProps {
  hierarchy: WikiTreeNode;
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  root: "text-accent-gold",
  SelfWiki: "text-accent-gold",
  大主题: "text-accent-emerald",
  技术专题: "text-accent-purple",
  流程阶段: "text-accent-amber",
  子主题: "text-accent-blue",
  待归类: "text-accent-rose",
  concepts: "text-accent-blue",
  entities: "text-accent-purple",
  changelog: "text-accent-emerald",
  guides: "text-accent-amber",
  docs: "text-accent-amber",
  api: "text-accent-rose",
};

function collectDirectoryIds(node: WikiTreeNode, result = new Set<string>()) {
  if (node.kind !== "page") result.add(node.id);
  for (const child of node.children) collectDirectoryIds(child, result);
  return result;
}

function countPages(node: WikiTreeNode): number {
  if (node.kind === "page") return 1;
  return node.children.reduce((total, child) => total + countPages(child), 0) +
    (node.pageSlug ? 1 : 0);
}

function filterTree(node: WikiTreeNode, query: string): WikiTreeNode | null {
  if (!query) return node;

  const ownMatch =
    node.title.toLowerCase().includes(query) ||
    node.path.toLowerCase().includes(query) ||
    node.category.toLowerCase().includes(query);
  if (ownMatch) return node;

  const children = node.children
    .map((child) => filterTree(child, query))
    .filter((child): child is WikiTreeNode => child !== null);
  if (children.length === 0) return null;
  return { ...node, children };
}

export default function Sidebar({
  hierarchy,
  activeSlug,
  onSelect,
}: SidebarProps) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => collectDirectoryIds(hierarchy)
  );
  const [filter, setFilter] = useState("");

  useEffect(() => {
    setExpandedDirs(collectDirectoryIds(hierarchy));
  }, [hierarchy]);

  const filteredTree = useMemo(
    () => filterTree(hierarchy, filter.trim().toLowerCase()),
    [hierarchy, filter]
  );

  const totalPages = countPages(hierarchy);

  function toggleDirectory(id: string) {
    setExpandedDirs((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node: WikiTreeNode, depth: number): React.ReactNode {
    const isDirectory = node.kind !== "page";
    const hasChildren = node.children.length > 0;
    const expanded = expandedDirs.has(node.id) || filter.trim().length > 0;
    const active = node.pageSlug === activeSlug;
    const colorClass = CATEGORY_COLORS[node.category] || "text-accent-blue";

    return (
      <div key={node.id}>
        <div className="flex items-center min-w-0">
          {isDirectory ? (
            <button
              type="button"
              aria-label={expanded ? "收起目录" : "展开目录"}
              onClick={() => toggleDirectory(node.id)}
              className="p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover shrink-0 cursor-pointer"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <button
            type="button"
            onClick={() => {
              if (node.pageSlug) onSelect(node.pageSlug);
              else if (isDirectory) toggleDirectory(node.id);
            }}
            className={`min-w-0 flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
              active
                ? "bg-accent-vivid/10 text-accent-vivid border border-accent-vivid/15"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent"
            }`}
            style={{ paddingLeft: `${Math.max(depth - 1, 0) * 10 + 6}px` }}
            title={node.path || node.title}
          >
            {isDirectory ? (
              <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />
            ) : (
              <FileText className="w-3.5 h-3.5 shrink-0 opacity-60" />
            )}
            {node.level !== undefined && (
              <span className="text-[9px] text-text-tertiary shrink-0">
                L{node.level}
              </span>
            )}
            <span className="truncate text-sm">{node.title}</span>
            {isDirectory && node.children.length > 0 && (
              <span className="ml-auto text-[10px] text-text-tertiary shrink-0">
                {node.children.length}
              </span>
            )}
            {!isDirectory && node.category && (
              <span className="ml-auto max-w-24 truncate text-[10px] text-text-tertiary shrink-0">
                {node.category}
              </span>
            )}
          </button>
        </div>
        {isDirectory && hasChildren && expanded && (
          <div className="ml-2 border-l border-border-primary/70 pl-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="w-80 shrink-0 bg-bg-secondary border-r border-border-primary flex flex-col h-full">
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center gap-2 text-xs text-text-tertiary mb-3">
          <FileText className="w-3.5 h-3.5" />
          <span>{totalPages} 个页面 · 目录层级</span>
        </div>
        <p className="text-[10px] leading-4 text-text-tertiary mb-3">
          L0 SelfWiki → L1 大主题 → L2 技术专题 → L3 流程阶段 → L4+ 子主题/页面
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="筛选目录或页面..."
            className="w-full bg-bg-tertiary border border-border-primary rounded-lg pl-8 pr-3 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-gold/30 transition-colors"
          />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto sidebar-scroll p-2">
        {filteredTree ? (
          renderNode(filteredTree, 0)
        ) : (
          <p className="px-3 py-6 text-center text-xs text-text-tertiary">
            没有匹配的目录或页面
          </p>
        )}
      </nav>
    </aside>
  );
}
