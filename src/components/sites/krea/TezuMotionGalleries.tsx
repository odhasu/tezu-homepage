"use client";

/* eslint-disable @next/next/no-img-element -- These local source assets retain their original formats. */

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Expand, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { MotionGalleryEngine, GalleryMotion } from "./motion-gallery-engine";
import { gallerySelections, type TezuMotionItem } from "./motion-gallery-media";
import "./tezu-motion-galleries.css";

const scenes: { mode: GalleryMotion; title: string }[] = [
  { mode: "lens", title: "Lens gallery" },
  { mode: "reel", title: "Bending reel" },
  { mode: "fold", title: "Folding gallery" },
  { mode: "arc", title: "Arc gallery" },
];

function MotionScene({ mode, title, reducedMotion, blocked, onOpen }: {
  mode: GalleryMotion; title: string; reducedMotion: boolean; blocked: boolean; onOpen: (item: TezuMotionItem) => void;
}) {
  const items = gallerySelections[mode];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [nearby, setNearby] = useState(false);
  const root = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MotionGalleryEngine | null>(null);
  const playbackPaused = useRef(false);
  const selectedIndex = useRef(0);
  const id = useId();
  const pointer = useRef<{ id: number; x: number; y: number; previous: number; time: number; moved: number; velocity: number } | null>(null);
  const item = items[index];
  const updateIndex = useCallback((next: number) => {
    selectedIndex.current = next;
    setIndex(next);
  }, []);

  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const region = root.current;
    if (!nearby || !element || !region) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("./motion-gallery-engine").then(({ MotionGalleryEngine: Engine }) => {
      if (cancelled) return;
      const instance = new Engine(element, mode, items, reducedMotion, updateIndex, () => setReady(true), selectedIndex.current);
      engine.current = instance;
      const onLost = (event: Event) => { event.preventDefault(); setReady(false); instance.setVisible(false); };
      const visibility = new IntersectionObserver(([entry]) => instance.setVisible(entry.isIntersecting), { threshold: .05 });
      visibility.observe(region);
      const onDocumentVisibility = () => instance.setPaused(document.hidden || playbackPaused.current);
      onDocumentVisibility();
      document.addEventListener("visibilitychange", onDocumentVisibility);
      const wheel = (event: WheelEvent) => {
        // Vertical wheel input also advances the lens, while the document keeps scrolling.
        const pixels = mode === "lens" ? event.deltaY : event.deltaX;
        if (pixels) instance.scroll(pixels);
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
      };
      element.addEventListener("wheel", wheel, { passive: false });
      element.addEventListener("webglcontextlost", onLost);
      dispose = () => {
        visibility.disconnect();
        document.removeEventListener("visibilitychange", onDocumentVisibility);
        element.removeEventListener("wheel", wheel);
        element.removeEventListener("webglcontextlost", onLost);
        instance.dispose();
        engine.current = null;
      };
    }).catch(error => {
      if (cancelled) return;
      element.dataset.fallbackReason = error instanceof Error ? error.message : "Renderer unavailable";
      // Native media cards remain usable on devices without a graphics context.
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [nearby, mode, items, reducedMotion, updateIndex]);

  useEffect(() => {
    playbackPaused.current = paused || blocked;
    engine.current?.setPaused(paused || blocked || document.hidden);
  }, [paused, blocked, nearby]);

  function step(direction: number) {
    if (engine.current) engine.current.step(direction);
    else updateIndex((selectedIndex.current + direction + items.length) % items.length);
  }

  return <article ref={root} className="tezu-motion-scene" data-motion={mode} aria-labelledby={`${id}-title`}>
    <div className="tezu-motion-scene-heading">
      <h3 id={`${id}-title`}>{title}</h3>
      <span className="tezu-motion-count" aria-hidden="true">{String(index + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}</span>
    </div>
    <div className="tezu-motion-stage" data-ready={ready}>
      <div className="tezu-motion-fallback" aria-hidden={ready || undefined} inert={ready}>
        {items.map((entry, itemIndex) => <button key={`${entry.id}-${itemIndex}`} type="button" aria-label={`Open ${entry.title}`} onClick={() => onOpen(entry)}>
          <img src={entry.thumbnail} width={entry.width} height={entry.height} alt={entry.title} loading="lazy" />
        </button>)}
      </div>
      <canvas ref={canvas} className="tezu-motion-canvas" tabIndex={ready ? 0 : -1} role="group"
        aria-label={`${title}. ${mode === "lens" ? "Drag up or down with a mouse" : "Drag left or right"} to browse. Use arrow keys to select a creation, and Enter to open it.`}
        aria-describedby={`${id}-caption`}
        onKeyDown={event => {
          if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            step(event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); }
          else if (event.key === "Home" || event.key === "End") { event.preventDefault(); engine.current?.moveTo(event.key === "Home" ? 0 : items.length - 1); }
        }}
        onPointerDown={event => {
          if (event.button !== 0 || !ready) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const position = mode === "lens" && event.pointerType === "mouse" ? event.clientY : event.clientX;
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, previous: position, time: event.timeStamp, moved: 0, velocity: 0 };
          engine.current?.beginDrag();
        }}
        onPointerMove={event => {
          const previous = pointer.current;
          if (!previous || previous.id !== event.pointerId) return;
          const position = mode === "lens" && event.pointerType === "mouse" ? event.clientY : event.clientX;
          const delta = position - previous.previous;
          previous.moved = Math.max(previous.moved, Math.hypot(event.clientX - previous.x, event.clientY - previous.y));
          previous.velocity = delta / Math.max(8, event.timeStamp - previous.time);
          previous.previous = position;
          previous.time = event.timeStamp;
          engine.current?.drag(delta);
        }}
        onPointerUp={event => {
          const previous = pointer.current;
          if (!previous || previous.id !== event.pointerId) return;
          pointer.current = null;
          engine.current?.endDrag(previous.moved > 5 ? previous.velocity : 0);
          if (previous.moved < 5) {
            const bounds = event.currentTarget.getBoundingClientRect();
            const chosen = engine.current?.pick(event.clientX - bounds.left, event.clientY - bounds.top);
            if (chosen) onOpen(chosen);
          }
        }}
        onPointerCancel={() => { pointer.current = null; engine.current?.endDrag(0); }}
        onLostPointerCapture={() => { if (pointer.current) { pointer.current = null; engine.current?.endDrag(0); } }}
      />
      <span className="tezu-motion-drag-hint" aria-hidden="true">{mode === "lens" ? "Scroll to explore" : "Drag to explore"}</span>
    </div>
    <div className="tezu-motion-footer">
      <div className="tezu-motion-caption" id={`${id}-caption`}><span>{item.kind === "video" ? "Video" : "Image"}</span><p>{item.title}</p></div>
      <div className="tezu-motion-controls">
        <button type="button" aria-label={`Previous creation in ${title}`} onClick={() => step(-1)}>{mode === "lens" ? <ArrowUp size={17} /> : <ArrowLeft size={17} />}</button>
        <button type="button" aria-label={`Next creation in ${title}`} onClick={() => step(1)}>{mode === "lens" ? <ArrowDown size={17} /> : <ArrowRight size={17} />}</button>
        {!reducedMotion && <button type="button" aria-label={`${paused ? "Play" : "Pause"} ${title}`} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>}
        <button type="button" aria-label={`Open selected creation in ${title}`} onClick={() => onOpen(item)}><Expand size={16} /></button>
      </div>
    </div>
  </article>;
}

export function TezuMotionGalleries({ reducedMotion }: { reducedMotion: boolean }) {
  const [selected, setSelected] = useState<TezuMotionItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = useCallback((item: TezuMotionItem) => { setSelected(item); dialog.current?.showModal(); }, []);

  return <section className="tezu-motion-collection" aria-labelledby="tezu-explore-title">
    <div className="section-heading"><h2 id="tezu-explore-title">Explore with Tezu</h2></div>
    <div className="tezu-motion-grid">{scenes.map(scene => <MotionScene key={`${scene.mode}-${reducedMotion}`} {...scene} reducedMotion={reducedMotion} blocked={!!selected} onOpen={open} />)}</div>
    <dialog ref={dialog} className="tezu-media-dialog" aria-label="Explore Tezu creation" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button className="tezu-dialog-close" type="button" aria-label="Close creation preview" onClick={() => dialog.current?.close()}><X size={24} /></button>
      {selected && <div className="tezu-dialog-content">
        {selected.kind === "video" ? <video key={selected.id} src={selected.src} poster={selected.poster} width={selected.width} height={selected.height} controls autoPlay={!reducedMotion} playsInline /> : <img src={selected.src} width={selected.width} height={selected.height} alt={selected.title} />}
        <div><p>{selected.title}</p></div>
      </div>}
    </dialog>
  </section>;
}
