"use client";

/* eslint-disable @next/next/no-img-element -- Reuse the original local Tezu artwork. */

import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tezuMedia } from "./assets";
import { createGalleryFrameLoop } from "./gallery-runtime";
import "./media-gallery.css";

const images = ["tezu-07-preview", "0808_139-preview", "boy-scene", "tezu-03-preview", "0808_140-preview", "tezu-04-preview", "0808_151-preview", "tezu-preview", "0808_142-preview", "tezu-05-preview", "0808_143-preview"]
  .map(id => tezuMedia.find(item => item.id === id)!);

/** Screen-space centers stay evenly spaced while depth and yaw curl the strip. */
export function MediaGallery({ reducedMotion }: { reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const cards = useRef<(HTMLButtonElement | null)[]>([]);
  const position = useRef(0);
  const step = useRef(190);
  const interaction = useRef({ pointer: false, focus: false });
  const wake = useRef<() => void>(() => {});
  const playback = useRef({ paused: false, selected: false, reducedMotion });
  const drag = useRef({ x: 0, active: false, moved: false });
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<(typeof images)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let width = element.clientWidth;
    let visible = false;
    let paintedPosition = Number.NaN;
    let paintedWidth = 0;
    const canAnimate = () => visible && !document.hidden && !playback.current.paused && !playback.current.selected && !playback.current.reducedMotion && !interaction.current.pointer && !interaction.current.focus && !drag.current.active;
    const loop = createGalleryFrameLoop(elapsed => {
      if (!visible || document.hidden) return;
      const cardWidth = width < 600 ? 138 : Math.min(220, Math.max(170, width * .128));
      const gap = width < 600 ? 12 : 18;
      step.current = cardWidth + gap;
      if (canAnimate()) position.current += elapsed * .014;
      if (paintedPosition !== position.current || paintedWidth !== width) {
        const span = images.length * step.current;
        cards.current.forEach((card, index) => {
          if (!card) return;
          const screenX = ((index * step.current + position.current + span / 2) % span + span) % span - span / 2;
          const normalized = screenX / Math.max(width / 2, 300);
          const depth = Math.min(normalized ** 2, 2) * 125;
          const projection = 1 - depth / 1200;
          if (paintedWidth !== width) {
            card.style.width = `${cardWidth}px`;
            card.style.height = `${cardWidth * 1.52}px`;
          }
          card.style.transform = `translate3d(${screenX * projection - cardWidth / 2}px,${18 - Math.min(normalized ** 2, 2) * 12}px,${depth}px) rotateY(${-normalized * 28}deg)`;
          card.style.visibility = Math.abs(screenX) > width / 2 + cardWidth ? "hidden" : "visible";
        });
        paintedPosition = position.current;
        paintedWidth = width;
      }
    }, canAnimate);
    const wakeFrame = () => { if (visible && !document.hidden) loop.wake(); };
    wake.current = wakeFrame;
    const resize = new ResizeObserver(([entry]) => { width = entry.contentRect.width; wakeFrame(); });
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) wakeFrame();
      else loop.sleep();
    });
    const onVisibilityChange = () => { if (document.hidden) loop.sleep(); else wakeFrame(); };
    resize.observe(element);
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      loop.dispose();
      wake.current = () => {};
      resize.disconnect();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    playback.current = { paused, selected: !!selected, reducedMotion };
    wake.current();
  }, [paused, selected, reducedMotion]);

  const move = (direction: number) => { position.current += direction * step.current; wake.current(); };
  return <section className="media-gallery" id="create" aria-label="Tezu image gallery" aria-roledescription="carousel">
    <div className="media-gallery-stage" ref={root}
      onPointerEnter={() => { interaction.current.pointer = true; wake.current(); }} onPointerLeave={() => { interaction.current.pointer = false; wake.current(); }}
      onFocusCapture={() => { interaction.current.focus = true; wake.current(); }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) { interaction.current.focus = false; wake.current(); } }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, active: true, moved: false };
        wake.current();
      }}
      onPointerMove={event => {
        if (!drag.current.active) return;
        const delta = event.clientX - drag.current.x;
        if (!drag.current.moved && Math.abs(delta) < 6) return;
        drag.current.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        position.current += delta;
        drag.current.x = event.clientX;
        wake.current();
      }}
      onPointerUp={() => { drag.current.active = false; wake.current(); }}
      onPointerCancel={() => { drag.current.active = false; wake.current(); }}>
      <div className="media-gallery-ring">{images.map((item, index) => <button className="media-gallery-card" type="button" key={item.id} ref={node => { cards.current[index] = node; }} aria-label={`View image: ${item.title}`} onClick={event => {
        if (drag.current.moved && event.detail > 0) return;
        setSelected(item);
        dialog.current?.showModal();
      }}>
        <img src={item.thumbnail} alt={item.title} draggable={false} width={item.width} height={item.height} loading="lazy" />
        <span>{item.title.replace("Video for ", "")}</span>
      </button>)}</div>
    </div>
    <div className="media-gallery-footer"><p>A few ideas. Endless possibilities.</p><div className="media-gallery-controls">
      <button type="button" aria-label="Previous gallery images" onClick={() => move(1)}><ChevronLeft size={18} /></button>
      {!reducedMotion && <button type="button" aria-label={paused ? "Play image gallery" : "Pause image gallery"} onClick={() => setPaused(current => !current)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}
      <button type="button" aria-label="Next gallery images" onClick={() => move(-1)}><ChevronRight size={18} /></button>
    </div></div>
    <dialog ref={dialog} className="tezu-media-dialog" aria-label="Tezu image preview" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button className="tezu-dialog-close" type="button" aria-label="Close image preview" onClick={() => dialog.current?.close()}><X size={24} /></button>
      {selected && <div className="tezu-dialog-content"><img src={selected.poster} alt={selected.title} width={selected.width} height={selected.height} /><div><p>{selected.title}</p><a href="#home" onClick={() => dialog.current?.close()}>Create your own</a></div></div>}
    </dialog>
  </section>;
}
