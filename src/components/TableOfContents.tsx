"use client";

import { useEffect, useState, useMemo, type MouseEvent } from "react";
import { List } from "lucide-react";
import { extractHeadings } from "../lib/markdown.mjs";

interface TableOfContentsProps {
  content: string;
  slugByName?: Map<string, string>;
}

export default function TableOfContents({ content, slugByName }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>("");
  const headings = useMemo(() => extractHeadings(content, slugByName), [content, slugByName]);

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
