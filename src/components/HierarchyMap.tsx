"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { FileText, Search } from "lucide-react";
import type { WikiTreeNode } from "@/lib/github";

interface HierarchyMapProps {
  hierarchy: WikiTreeNode;
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  viewport?: ViewportSnapshot;
  onViewportChange?: (snapshot: ViewportSnapshot) => void;
}

interface ViewportSnapshot {
  x: number;
  y: number;
  k: number;
  scrollLeft?: number;
  scrollTop?: number;
}

function nodeColor(node: WikiTreeNode, light: boolean): string {
  if (!node.pageSlug) return light ? "#b4ada4" : "#687383";
  if (node.kind === "root") return "#d4a96a";
  if (node.level === 1) return "#5bb99a";
  if (node.level === 2) return "#ae82d7";
  if (node.level === 3) return "#d6a448";
  if (node.level === 4) return "#6ca7dc";
  if (node.kind === "directory") return "#7ba3c4";
  return "#b48ec4";
}

function isLightTheme(): boolean {
  return document.documentElement.getAttribute("data-theme") === "light";
}

export default function HierarchyMap({
  hierarchy,
  activeSlug,
  onSelect,
  viewport,
  onViewportChange,
}: HierarchyMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const initialViewportRef = useRef(viewport);
  const transformRef = useRef(d3.zoomIdentity);
  const initializedViewportRef = useRef(false);
  const initializedTransformRef = useRef(false);
  const [query, setQuery] = useState("");
  const [showPages, setShowPages] = useState(true);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();

    const root = d3.hierarchy(hierarchy, (node) => {
      if (showPages) return node.children;
      return node.children.filter(
        (child) =>
          child.kind !== "page" &&
          (child.level === undefined || child.level <= 4)
      );
    });
    const layout = d3.tree<WikiTreeNode>().nodeSize([34, 240]);
    layout(root);

    const descendants = root.descendants();
    const minX = d3.min(descendants, (node) => node.x) ?? 0;
    const maxX = d3.max(descendants, (node) => node.x) ?? 0;
    const maxY = d3.max(descendants, (node) => node.y) ?? 0;
    const width = Math.max(900, maxY + 360);
    const height = Math.max(560, maxX - minX + 80);
    const light = isLightTheme();
    const textColor = light ? "#403a35" : "#e8edf5";
    const mutedColor = light ? "#82766b" : "#8c9ab0";
    const lineColor = light ? "#c9bfb5" : "#45526b";
    const search = query.trim().toLowerCase();

    svg
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    const scrollViewport = viewportRef.current;
    if (scrollViewport && !initializedViewportRef.current) {
      const savedViewport = initialViewportRef.current;
      if (savedViewport) {
        scrollViewport.scrollLeft = savedViewport.scrollLeft ?? 0;
        scrollViewport.scrollTop = savedViewport.scrollTop ?? 0;
      } else {
        const rootY = (root.x ?? 0) - minX + 40;
        scrollViewport.scrollTop = Math.max(
          0,
          rootY - Math.max(scrollViewport.clientHeight / 2, 240)
        );
        scrollViewport.scrollLeft = 0;
      }
      initializedViewportRef.current = true;
    }

    const zoomLayer = svg.append("g");
    const content = zoomLayer
      .append("g")
      .attr("transform", `translate(48,${40 - minX})`);

    content
      .selectAll("path")
      .data(root.links())
      .join("path")
      .attr("fill", "none")
      .attr("stroke", lineColor)
      .attr("stroke-width", 1.5)
      .attr("d", (link) => {
        const sourceX = link.source.x ?? 0;
        const sourceY = link.source.y ?? 0;
        const targetX = link.target.x ?? 0;
        const targetY = link.target.y ?? 0;
        const midpoint = (sourceY + targetY) / 2;
        return `M${sourceY},${sourceX}C${midpoint},${sourceX} ${midpoint},${targetX} ${targetY},${targetX}`;
      });

    const nodeGroup = content
      .selectAll("g.hierarchy-node")
      .data(descendants)
      .join("g")
      .attr("class", "hierarchy-node")
      .attr("transform", (node) => `translate(${node.y},${node.x})`)
      .style("cursor", (node) => (node.data.pageSlug ? "pointer" : "default"));

    nodeGroup
      .append("circle")
      .attr("r", (node) => (node.data.kind === "page" ? 5 : 7))
      .attr("fill", (node) => nodeColor(node.data, light))
      .attr("opacity", (node) => (node.data.pageSlug ? 1 : 0.72))
      .attr("stroke", (node) =>
        node.data.pageSlug === activeSlug ? textColor : "none"
      )
      .attr("stroke-width", 3);

    nodeGroup
      .append("text")
      .attr("x", 14)
      .attr("dy", "0.35em")
      .attr("fill", (node) => {
        const matches =
          !search ||
          node.data.title.toLowerCase().includes(search) ||
          node.data.path.toLowerCase().includes(search) ||
          node.data.category.toLowerCase().includes(search);
        return matches ? textColor : mutedColor;
      })
      .attr("font-size", (node) => (node.data.kind === "page" ? 12 : 13))
      .attr("font-weight", (node) =>
        node.data.pageSlug === activeSlug || node.data.kind !== "page" ? 650 : 450
      )
      .text((node) => node.data.title);

    nodeGroup
      .append("text")
      .attr("x", 14)
      .attr("dy", "1.55em")
      .attr("fill", mutedColor)
      .attr("font-size", 9)
      .text((node) =>
        node.data.level !== undefined
          ? `L${node.data.level} · ${node.data.category}`
          : node.data.category
      );

    nodeGroup
      .on("click", (_, node) => {
        if (node.data.pageSlug) onSelect(node.data.pageSlug);
      })
      .append("title")
      .text((node) =>
        node.data.pageSlug
          ? node.data.path || node.data.title
          : `${node.data.title}（层级节点，不可直接打开）`
      );

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 2.5])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        zoomLayer.attr("transform", event.transform);
        onViewportChange?.({
          x: event.transform.x,
          y: event.transform.y,
          k: event.transform.k,
          scrollLeft: scrollViewport?.scrollLeft ?? 0,
          scrollTop: scrollViewport?.scrollTop ?? 0,
        });
      });
    svg.call(zoom);

    const savedViewport = initialViewportRef.current;
    const restoredTransform = !initializedTransformRef.current && savedViewport
      ? d3.zoomIdentity
          .translate(savedViewport.x, savedViewport.y)
          .scale(savedViewport.k)
      : transformRef.current;
    transformRef.current = restoredTransform;
    initializedTransformRef.current = true;
    svg.call(zoom.transform, restoredTransform);

    const handleScroll = () => {
      onViewportChange?.({
        x: transformRef.current.x,
        y: transformRef.current.y,
        k: transformRef.current.k,
        scrollLeft: scrollViewport?.scrollLeft ?? 0,
        scrollTop: scrollViewport?.scrollTop ?? 0,
      });
    };
    scrollViewport?.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => scrollViewport?.removeEventListener("scroll", handleScroll);
  }, [hierarchy, activeSlug, onSelect, onViewportChange, query, showPages]);

  return (
    <div ref={viewportRef} className="relative w-full h-full min-h-[500px] bg-bg-primary overflow-auto">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索层级..."
            className="w-full bg-bg-secondary/90 backdrop-blur border border-border-primary rounded-lg pl-8 pr-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowPages((value) => !value)}
          aria-pressed={showPages}
          className={`flex items-center gap-1.5 whitespace-nowrap bg-bg-secondary/90 backdrop-blur border border-border-primary rounded-lg px-3 py-2 text-xs transition-colors cursor-pointer ${
            showPages
              ? "text-accent-vivid border-accent-vivid/40"
              : "text-text-tertiary hover:text-text-secondary"
          }`}
          title={showPages ? "隐藏具体 Markdown 页面" : "显示具体 Markdown 页面"}
        >
          <FileText className="w-3.5 h-3.5" />
          {showPages ? "隐藏页面" : "显示页面"}
        </button>
      </div>
      <div className="absolute bottom-4 left-4 z-10 bg-bg-secondary/85 backdrop-blur border border-border-primary rounded-lg px-3 py-2 text-[11px] text-text-tertiary">
        {showPages
          ? "高亮节点可打开 Markdown · 灰色节点仅表示层级分组 · L0 根 · L1 大主题 · L2 技术专题 · L3 阶段 · 滚轮缩放 · 拖动画布"
          : "高亮节点可打开 Markdown · 灰色节点仅表示层级分组 · 页面已折叠 · L0 根 · L1 大主题 · L2 技术专题 · L3 阶段 · L4 子主题 · 滚轮缩放 · 拖动画布"}
      </div>
      <svg ref={svgRef} className="block min-w-full min-h-full" />
    </div>
  );
}
