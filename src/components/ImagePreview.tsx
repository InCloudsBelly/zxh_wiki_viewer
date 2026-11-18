"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { Maximize, X, ZoomIn, ZoomOut } from "lucide-react";

type Graphic = HTMLImageElement | SVGSVGElement;
type Point = { x: number; y: number };
type View = Point & { scale: number };
const INITIAL_VIEW: View = { scale: 1, x: 0, y: 0 };

function findGraphic(target: EventTarget | null): Graphic | null {
  if (!(target instanceof Element) || target.closest("a, button, .diagram-label")) return null;
  const math = target.closest(".katex");
  // A formula is not a picture; math inside a diagram still belongs to that diagram.
  const graphic = math ? math.parentElement?.closest("svg") : target.closest("img, svg");
  return graphic instanceof HTMLImageElement || graphic instanceof SVGSVGElement ? graphic : null;
}

function graphicLabel(graphic: Graphic): string {
  return graphic.dataset.wikiImagePreview || graphic.getAttribute("aria-label") ||
    graphic.getAttribute("alt") || graphic.querySelector("title")?.textContent || "图片";
}

export default function ImagePreview({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Graphic | null>(null);

  useEffect(() => {
    const container = scope.current;
    if (!container) return;
    const enhance = () => {
      for (const element of container.querySelectorAll("img, svg")) {
        const graphic = findGraphic(element);
        if (!graphic || graphic.dataset.wikiImagePreview) continue;
        const label = graphicLabel(graphic);
        graphic.dataset.wikiImagePreview = label;
        graphic.setAttribute("role", "button");
        graphic.setAttribute("tabindex", "0");
        graphic.setAttribute("aria-haspopup", "dialog");
        graphic.setAttribute("aria-label", `放大查看：${label}`);
      }
    };
    enhance();
    // Mermaid inserts its SVG after the Markdown has rendered.
    const observer = new MutationObserver(enhance);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [children]);

  return <>
    <div className="wiki-content" ref={scope}
      onClick={(event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const graphic = findGraphic(event.target);
        if (graphic) { event.preventDefault(); setSelected(graphic); }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const graphic = findGraphic(event.target);
        if (graphic) { event.preventDefault(); event.stopPropagation(); setSelected(graphic); }
      }}>
      {children}
    </div>
    {selected && <ImageDialog source={selected} onClose={() => setSelected(null)} />}
  </>;
}

function ImageDialog({ source, onClose }: { source: Graphic; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const artwork = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const dimensions = useRef({ width: 1, height: 1, viewportWidth: 1, viewportHeight: 1 });
  const viewRef = useRef<View>(INITIAL_VIEW);
  const [view, setView] = useState<View>(INITIAL_VIEW);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [failed, setFailed] = useState(() => source instanceof HTMLImageElement && source.complete && !source.naturalWidth);
  const label = graphicLabel(source);

  const update = useCallback((next: View) => {
    const d = dimensions.current;
    const scale = Math.max(1, Math.min(8, next.scale));
    const maxX = Math.max(0, (d.width * scale - d.viewportWidth) / 2);
    const maxY = Math.max(0, (d.height * scale - d.viewportHeight) / 2);
    const bounded = { scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    viewRef.current = bounded;
    setView(bounded);
  }, []);

  const zoom = useCallback((requestedScale: number, anchor: Point = { x: 0, y: 0 }) => {
    const previous = viewRef.current;
    const scale = Math.max(1, Math.min(8, requestedScale));
    const ratio = scale / previous.scale;
    update({ scale, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio });
  }, [update]);

  useLayoutEffect(() => {
    const modal = dialog.current!;
    const surface = canvas.current!;
    const holder = artwork.current!;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    closeButton.current?.focus();
    const copy = source.cloneNode(true) as Graphic;
    copy.removeAttribute("tabindex");
    copy.removeAttribute("role");
    copy.removeAttribute("aria-haspopup");
    copy.removeAttribute("data-wiki-image-preview");
    copy.style.width = "100%";
    copy.style.height = "100%";
    copy.style.maxWidth = "none";
    copy.style.maxHeight = "none";
    copy.style.margin = "0";
    copy.style.objectFit = "contain";
    holder.replaceChildren(copy);

    const fit = () => {
      const bounds = surface.getBoundingClientRect();
      const image = source instanceof HTMLImageElement;
      const box = source.getBoundingClientRect();
      const width = (image ? source.naturalWidth : source.viewBox.baseVal.width) || box.width || 1;
      const height = (image ? source.naturalHeight : source.viewBox.baseVal.height) || box.height || 1;
      const factor = Math.min(1, Math.max(1, bounds.width - 32) / width, Math.max(1, bounds.height - 32) / height);
      const fitted = { width: width * factor, height: height * factor };
      dimensions.current = { ...fitted, viewportWidth: bounds.width, viewportHeight: bounds.height };
      setSize(fitted);
      pointers.current.clear();
      update(INITIAL_VIEW);
    };
    if (copy instanceof HTMLImageElement) {
      copy.loading = "eager";
      copy.draggable = false;
      copy.onload = () => { setFailed(false); fit(); };
      copy.onerror = () => setFailed(true);
      copy.removeAttribute("srcset");
      copy.src = (source as HTMLImageElement).currentSrc || (source as HTMLImageElement).src;
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(surface);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      zoom(viewRef.current.scale * Math.exp(-delta * 0.002), {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      });
    };
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      surface.removeEventListener("wheel", wheel);
      if (copy instanceof HTMLImageElement) { copy.onload = null; copy.onerror = null; }
      if (modal.open) modal.close();
      document.body.style.overflow = oldOverflow;
      if (source.isConnected) source.focus({ preventScroll: true });
    };
  }, [source, update, zoom]);

  const gesture = () => {
    const points = [...pointers.current.values()].slice(0, 2);
    if (!points.length) return null;
    const [first, second = first] = points;
    const bounds = canvas.current!.getBoundingClientRect();
    return { x: (first.x + second.x) / 2 - bounds.left - bounds.width / 2,
      y: (first.y + second.y) / 2 - bounds.top - bounds.height / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y) };
  };
  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <dialog ref={dialog} className="image-preview-dialog" aria-label="图片预览"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(viewRef.current.scale * 1.25); }
      else if (event.key === "-") { event.preventDefault(); zoom(viewRef.current.scale / 1.25); }
      else if (event.key === "0" || event.key === "Home") { event.preventDefault(); update(INITIAL_VIEW); }
      else if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const offset = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
        if (offset) update({ ...viewRef.current, x: viewRef.current.x + offset[0], y: viewRef.current.y + offset[1] });
      }
    }}>
    <header className="image-preview-header">
      <p className="image-preview-title" title={label}>{label}</p>
      <div className="image-preview-controls">
        <button type="button" aria-label="缩小图片" title="缩小 (-)" disabled={failed || view.scale <= 1} onClick={() => zoom(viewRef.current.scale / 1.25)}><ZoomOut size={20} /></button>
        <output aria-label="缩放比例" aria-live="polite">{Math.round(view.scale * 100)}%</output>
        <button type="button" aria-label="放大图片" title="放大 (+)" disabled={failed || view.scale >= 8} onClick={() => zoom(viewRef.current.scale * 1.25)}><ZoomIn size={20} /></button>
        <button type="button" aria-label="适应窗口" title="适应窗口 (0)" onClick={() => update(INITIAL_VIEW)}><Maximize size={20} /></button>
      </div>
      <button ref={closeButton} className="image-preview-close" type="button" aria-label="关闭图片预览" title="关闭 (Esc)" onClick={onClose}><X size={22} /></button>
    </header>
    <div ref={canvas} className="image-preview-canvas" role="region" aria-label="图片查看区域" tabIndex={0}
      style={{ cursor: view.scale > 1 ? "grab" : "zoom-in" }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        if (!pointers.current.has(event.pointerId)) return;
        const previous = gesture()!;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const next = gesture()!;
        const oldView = viewRef.current;
        const scale = Math.max(1, Math.min(8, previous.distance && next.distance ? oldView.scale * next.distance / previous.distance : oldView.scale));
        const ratio = scale / oldView.scale;
        update({ scale, x: next.x - (previous.x - oldView.x) * ratio, y: next.y - (previous.y - oldView.y) * ratio });
      }}
      onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
      onDoubleClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        zoom(viewRef.current.scale > 1 ? 1 : 2, { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 });
      }}>
      {failed && <p className="image-preview-error" role="status">图片暂时无法加载，请关闭后重试。</p>}
      <div className="image-preview-transform" role="img" aria-label={label}
        style={{ width: size.width, height: size.height, visibility: failed ? "hidden" : "visible", transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <div ref={artwork} inert className={`wiki-content image-preview-artwork${source.closest(".mermaid-rendered") ? " mermaid-rendered" : ""}`} />
      </div>
    </div>
    <footer className="image-preview-hint">滚轮或双指缩放 · 拖动查看 · 双击切换缩放</footer>
  </dialog>;
}
