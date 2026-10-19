"use client";

import { useEffect, useState, useMemo, type MouseEvent } from "react";
import { List } from "lucide-react";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface TableOfContentsProps {
  content: string;
}

function extractHeadings(markdown: string): TocItem[] {
  const headings: TocItem[] = [];
  const lines = markdown.split("\n");
  let codeFence: { marker: string; length: number } | null = null;
  let detailsDepth = 0;
  let inHtmlComment = false;
  const idCount = new Map<string, number>();

  for (const line of lines) {
    const fence = line.trim().match(/^(`{3,}|~{3,})(.*)$/);
    if (fence && !inHtmlComment) {
      if (!codeFence) {
        codeFence = { marker: fence[1][0], length: fence[1].length };
      } else if (
        fence[1][0] === codeFence.marker &&
        fence[1].length >= codeFence.length &&
        fence[2].trim() === ""
      ) {
        codeFence = null;
      }
      continue;
    }
    if (codeFence) continue;

    const insideComment = inHtmlComment;
    let insideDetails = detailsDepth > 0;
    const tokens = Array.from(line.matchAll(/`+|<!--|-->|<\/?details(?:\s[^>]*)?>/gi));
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index][0];
      if (inHtmlComment) {
        if (token === "-->") inHtmlComment = false;
        continue;
      }
      if (token.startsWith("`")) {
        const closeIndex = tokens.findIndex((candidate, position) =>
          position > index && candidate[0] === token
        );
        if (closeIndex >= 0) index = closeIndex;
      } else if (token === "<!--") {
        inHtmlComment = true;
      } else if (/^<details[\s>]/i.test(token)) {
        insideDetails = true;
        detailsDepth++;
      } else if (/^<\/details[\s>]/i.test(token)) {
        detailsDepth = Math.max(0, detailsDepth - 1);
      }
    }

    const match = line.match(/^(#{1,4})\s+(.+)$/);
    if (match && !insideComment) {
      const level = match[1].length;
      const text = match[2].replace(/[`*_~]/g, "").trim();
      let id = text
        .toLowerCase()
        .replace(/[^\w\s\u4e00-\u9fff-]/g, "")
        .replace(/\s+/g, "-");
      const count = idCount.get(id) || 0;
      idCount.set(id, count + 1);
      if (count > 0) id = `${id}-${count}`;
      if (!insideDetails) headings.push({ id, text, level });
    }
  }
  return headings;
}

export default function TableOfContents({ content }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const headings = useMemo(() => extractHeadings(content), [content]);

  useEffect(() => {
    const scrollRoot = document.getElementById("wiki-content-area");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { root: scrollRoot, rootMargin: "-80px 0px -70% 0px" }
    );

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean);

    elements.forEach((el) => observer.observe(el!));
    return () => observer.disconnect();
  }, [headings]);

  function handleHeadingClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const target = document.getElementById(id);
    const scrollRoot = document.getElementById("wiki-content-area");
    if (!target || !scrollRoot) return;

    event.preventDefault();
    const rootRect = scrollRoot.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    scrollRoot.scrollTo({
      top: scrollRoot.scrollTop + targetRect.top - rootRect.top - 24,
      behavior: "auto",
    });
    setActiveId(id);
  }

  if (headings.length < 2) return null;

  return (
    <aside className="w-56 shrink-0 hidden xl:block">
      <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto sidebar-scroll">
        <div className="flex items-center gap-2 text-xs font-medium text-text-tertiary mb-3 uppercase tracking-wider">
          <List className="w-3.5 h-3.5" />
          目录
        </div>
        <nav className="space-y-0.5">
          {headings.map((heading) => {
            const isActive = heading.id === activeId;
            const indent = (heading.level - 1) * 12;
            return (
              <a
                key={heading.id}
                href={`#${heading.id}`}
                onClick={(event) => handleHeadingClick(event, heading.id)}
                style={{ paddingLeft: `${indent + 8}px` }}
                className={`block py-1 text-xs leading-relaxed border-l-2 transition-colors ${
                  isActive
                    ? "border-accent-blue text-accent-blue"
                    : "border-transparent text-text-tertiary hover:text-text-secondary hover:border-border-secondary"
                }`}
              >
                {heading.text}
              </a>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
