"use client";

/* eslint-disable @next/next/no-img-element -- Source artwork is downloaded and preoptimized locally. */

import { useEffect, useRef } from "react";
import { tezuMedia } from "./assets";
import { wallGeometry } from "./wall-geometry";
import { createWallFrameLoop, settleTowards, wallHasMotion } from "./wall-animation";

const wallAssets = tezuMedia.map((item) => ({ ...item, image: item.thumbnail, reference: item.poster,
  category: item.kind === "video" ? "Tezu video" : "Tezu character",
  prompt: `Create a cartoon scene inspired by ${item.title.toLowerCase()}.` }));

export type WallImage = (typeof wallAssets)[number];

const coordinates = Array.from({ length: 45 }, (_, index) => ({ col: index % 9 - 4, row: Math.floor(index / 9) - 2 }));
const modulo = (value: number, span: number) => ((value % span) + span) % span;
const presetAt = (col: number, row: number) => wallAssets[modulo(20 + col + 9 * row, wallAssets.length)];

export function ImageWall({ onSelect, reducedMotion, paused }: { onSelect: (image: WallImage) => void; reducedMotion: boolean; paused: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const wake = useRef<() => void>(() => {});
  const drag = useRef({ x: 0, y: 0, lastTime: 0, active: false, moved: false });
  const movement = useRef({ x: 0, y: 0, vx: 0, vy: 0, hover: -1, visible: true, paused: false, lastActivity: 0, target: null as null | { x: number; y: number } });

  useEffect(() => { movement.current.paused = paused; wake.current(); }, [paused]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let width = element.clientWidth;
    let height = element.clientHeight;
    let geometry = wallGeometry(width);
    let sizesDirty = true;
    movement.current.lastActivity = performance.now();
    const lifts = coordinates.map(() => 0);
    const resize = new ResizeObserver(([entry]) => {
      if (width !== entry.contentRect.width || height !== entry.contentRect.height) {
        width = entry.contentRect.width; height = entry.contentRect.height;
        geometry = wallGeometry(width);
        sizesDirty = true;
        loop.wake();
      }
    });
    const visibility = new IntersectionObserver(([entry]) => {
      movement.current.visible = entry.isIntersecting;
      if (entry.isIntersecting) loop.wake(); else loop.stop();
    });
    resize.observe(element);
    visibility.observe(element);

    const curve = (value: number, edge: number, band: number) => {
      const distance = Math.abs(value);
      const start = edge - band;
      return distance <= start ? value : Math.sign(value) * (start + band * Math.tanh((distance - start) / band));
    };

    const tileSizes = coordinates.map(({ col, row }) => {
      const image = presetAt(col, row);
      return { ratio: image.width / image.height, width: 0, height: 0, hidden: undefined as boolean | undefined, small: undefined as boolean | undefined };
    });
    const loop = createWallFrameLoop(requestAnimationFrame, cancelAnimationFrame, dt => {
      const state = movement.current;
      if (!state.visible || document.visibilityState !== "visible") return false;
      const { tileWidth: size, tileHeight: tall, stepX, stepY } = geometry;
      const band = size * 0.25;
      const halfX = width / 2 - size * 0.08;
      const halfY = height / 2 - size * 0.08;
      if (state.target) {
        state.x = settleTowards(state.x, state.target.x, dt, .2, reducedMotion, .05);
        state.y = settleTowards(state.y, state.target.y, dt, .2, reducedMotion, .05);
      } else if (!drag.current.active && !reducedMotion && !state.paused && document.visibilityState === "visible") {
        const decay = Math.exp(-dt / 0.7);
        state.vx = state.vx * decay + 9 * (1 - decay);
        state.vy = state.vy * decay;
        state.x += state.vx * dt;
        state.y += state.vy * dt;
      }
      let liftMoving = false;
      tileRefs.current.forEach((tile, index) => {
        if (!tile) return;
        const { col, row } = coordinates[index];
        const cached = tileSizes[index];
        if (sizesDirty) {
          cached.width = Math.min(size, tall * cached.ratio);
          cached.height = cached.width / cached.ratio;
          tile.style.width = `${cached.width}px`;
          tile.style.height = `${cached.height}px`;
          tile.style.borderRadius = `${size * .07}px`;
        }
        const tileWidth = cached.width;
        const tileHeight = cached.height;
        const x = modulo((col + (row & 1) / 2) * stepX + state.x + stepX * 4.5, stepX * 9) - stepX * 4.5;
        const y = modulo(row * stepY + state.y + stepY * 2.5, stepY * 5) - stepY * 2.5;
        const left = curve(x - tileWidth / 2, halfX, band);
        const right = curve(x + tileWidth / 2, halfX, band);
        const top = curve(y - tileHeight / 2, halfY, band);
        const bottom = curve(y + tileHeight / 2, halfY, band);
        // Uniform edge scaling preserves every source image's native proportions.
        const fit = Math.min((right - left) / tileWidth, (bottom - top) / tileHeight);
        const small = fit < 0.8;
        const hidden = fit < 0.04;
        if (cached.hidden !== hidden) { tile.style.visibility = hidden ? "hidden" : "visible"; cached.hidden = hidden; }
        if (cached.small !== small) { tile.dataset.small = String(small); cached.small = small; }
        const targetLift = state.hover === index && !small ? 1 : 0;
        lifts[index] = settleTowards(lifts[index], targetLift, dt, .12, reducedMotion, .001);
        if (lifts[index] !== targetLift) liftMoving = true;
        const scale = 1 + 0.03 * lifts[index];
        tile.style.transform = `translate3d(${width / 2 + (left + right - tileWidth * fit * scale) / 2}px,${height / 2 + (top + bottom - tileHeight * fit * scale) / 2}px,0) scale(${fit * scale})`;
      });
      sizesDirty = false;
      return wallHasMotion({ paused: state.paused, reducedMotion, dragging: drag.current.active, hasTarget: !!state.target,
        targetMoving: !!state.target && (state.x !== state.target.x || state.y !== state.target.y), liftMoving });
    });
    const onVisibility = () => { if (document.visibilityState === "visible") loop.wake(); else loop.stop(); };
    wake.current = loop.wake;
    document.addEventListener("visibilitychange", onVisibility);
    loop.wake();
    return () => { wake.current = () => {}; loop.stop(); resize.disconnect(); visibility.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [reducedMotion]);

  return (
    <div
      ref={root}
      className="image-wall"
      aria-label="Image inspiration. Drag to explore. Use arrow keys to move between images."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, lastTime: event.timeStamp, active: true, moved: false };
        movement.current.target = null;
        movement.current.lastActivity = performance.now();
        movement.current.vx = movement.current.vy = 0;
        wake.current();
      }}
      onPointerMove={(event) => {
        movement.current.lastActivity = performance.now();
        const pointer = drag.current;
        if (!pointer.active || !(event.buttons & 1)) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        if (!pointer.moved && Math.hypot(dx, dy) < 6) return;
        if (!pointer.moved && event.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) { pointer.active = false; wake.current(); return; }
        pointer.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = "true";
        const dt = Math.max(8, event.timeStamp - pointer.lastTime) / 1000;
        const state = movement.current;
        state.x += dx;
        state.y += dy;
        state.vx = state.vx * 0.3 + dx / dt * 0.7;
        state.vy = state.vy * 0.3 + dy / dt * 0.7;
        state.hover = -1;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.lastTime = event.timeStamp;
        wake.current();
      }}
      onPointerUp={(event) => { drag.current.active = false; event.currentTarget.dataset.dragging = "false"; wake.current(); }}
      onPointerCancel={(event) => { drag.current.active = false; drag.current.moved = false; event.currentTarget.dataset.dragging = "false"; wake.current(); }}
    >
      <div className="wall-stage">{coordinates.map(({ col, row }, index) => {
        const image = presetAt(col, row);
        return <button
          key={`${col},${row}`}
          ref={(node) => { tileRefs.current[index] = node; }}
          type="button"
          className="wall-tile"
          data-origin={col === 0 && row === 0 ? "true" : undefined}
          tabIndex={col === 0 && row === 0 ? 0 : -1}
          aria-label={`${image.category}: ${image.title}`}
          onClick={() => { if (!drag.current.moved) onSelect(image); }}
          onPointerEnter={() => { movement.current.hover = index; wake.current(); }}
          onPointerLeave={() => { movement.current.hover = -1; wake.current(); }}
          onFocus={(event) => {
            movement.current.hover = index;
            if (event.currentTarget.matches(":focus-visible")) {
              const { stepX, stepY } = wallGeometry(root.current?.clientWidth ?? 1440);
              movement.current.target = { x: -(col + (row & 1) / 2) * stepX, y: -row * stepY };
            }
            wake.current();
          }}
          onBlur={() => { movement.current.target = null; movement.current.hover = -1; wake.current(); }}
          onKeyDown={(event) => {
            const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            const next = coordinates.findIndex((point) => point.col === col + direction[0] && point.row === row + direction[1]);
            tileRefs.current[next]?.focus({ preventScroll: true });
          }}
        >
          <span className="wall-face">
            {/* Original Tezu artwork stays uncropped at its native aspect ratio. */}
            <img src={image.image} alt="" draggable={false} decoding="async" fetchPriority={row === 0 && Math.abs(col) <= 1 ? "high" : "auto"} />
            <span className="wall-caption"><small>{image.category}</small><span>{image.title}</span></span>
          </span>
        </button>;
      })}</div>
      <div className="wall-scrim" />
    </div>
  );
}
