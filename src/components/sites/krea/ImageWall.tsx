"use client";

/* eslint-disable @next/next/no-img-element -- Source artwork is downloaded and preoptimized locally. */

import { useEffect, useRef } from "react";
import { tezuMedia } from "./assets";
import { wallGeometry } from "./wall-geometry";

const wallAssets = tezuMedia.map((item) => ({ ...item, image: item.poster, reference: item.poster,
  category: item.kind === "video" ? "Tezu video" : "Tezu character",
  prompt: `Create a cartoon scene inspired by ${item.title.toLowerCase()}.` }));

export type WallImage = (typeof wallAssets)[number];

const coordinates = Array.from({ length: 45 }, (_, index) => ({ col: index % 9 - 4, row: Math.floor(index / 9) - 2 }));
const modulo = (value: number, span: number) => ((value % span) + span) % span;
const presetAt = (col: number, row: number) => wallAssets[modulo(20 + col + 9 * row, wallAssets.length)];

export function ImageWall({ onSelect, reducedMotion, paused }: { onSelect: (image: WallImage) => void; reducedMotion: boolean; paused: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef({ x: 0, y: 0, lastTime: 0, active: false, moved: false });
  const movement = useRef({ x: 0, y: 0, vx: 0, vy: 0, hover: -1, visible: true, paused: false, lastActivity: 0, target: null as null | { x: number; y: number } });

  useEffect(() => { movement.current.paused = paused; }, [paused]);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let width = element.clientWidth;
    let height = element.clientHeight;
    let frame = 0;
    let last = 0;
    movement.current.lastActivity = performance.now();
    const lifts = coordinates.map(() => 0);
    const resize = new ResizeObserver(([entry]) => { width = entry.contentRect.width; height = entry.contentRect.height; });
    const visibility = new IntersectionObserver(([entry]) => { movement.current.visible = entry.isIntersecting; });
    resize.observe(element);
    visibility.observe(element);

    const curve = (value: number, edge: number, band: number) => {
      const distance = Math.abs(value);
      const start = edge - band;
      return distance <= start ? value : Math.sign(value) * (start + band * Math.tanh((distance - start) / band));
    };

    function animate(time: number) {
      const dt = Math.min(0.05, (time - (last || time)) / 1000);
      last = time;
      const state = movement.current;
      if (state.visible) {
        const { tileWidth: size, tileHeight: tall, stepX, stepY } = wallGeometry(width);
        const band = size * 0.25;
        const halfX = width / 2 - size * 0.08;
        const halfY = height / 2 - size * 0.08;
        if (state.target) {
          const ease = reducedMotion ? 1 : 1 - Math.exp(-dt / 0.2);
          state.x += (state.target.x - state.x) * ease;
          state.y += (state.target.y - state.y) * ease;
        } else if (!drag.current.active && !reducedMotion && !state.paused && element?.closest(".hero")?.getAttribute("data-entered") === "true") {
          const decay = Math.exp(-dt / 0.7);
          const idle = state.hover < 0 && time < state.lastActivity + 15000 ? 1 : 0;
          state.vx = state.vx * decay - 10 * idle * (1 - decay);
          state.vy = state.vy * decay - 6 * idle * (1 - decay);
          state.x += state.vx * dt;
          state.y += state.vy * dt;
        }
        tileRefs.current.forEach((tile, index) => {
          if (!tile) return;
          const { col, row } = coordinates[index];
          const image = presetAt(col, row);
          const tileWidth = Math.min(size, tall * image.width / image.height);
          const tileHeight = tileWidth * image.height / image.width;
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
          tile.style.visibility = hidden ? "hidden" : "visible";
          tile.dataset.small = String(small);
          const targetLift = state.hover === index && !small ? 1 : 0;
          lifts[index] += (targetLift - lifts[index]) * (reducedMotion ? 1 : 1 - Math.exp(-dt / 0.12));
          const scale = 1 + 0.03 * lifts[index];
          tile.style.width = `${tileWidth}px`;
          tile.style.height = `${tileHeight}px`;
          tile.style.borderRadius = `${size * 0.07}px`;
          tile.style.transform = `translate3d(${width / 2 + (left + right - tileWidth * fit * scale) / 2}px,${height / 2 + (top + bottom - tileHeight * fit * scale) / 2}px,0) scale(${fit * scale})`;
        });
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); visibility.disconnect(); };
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
      }}
      onPointerMove={(event) => {
        movement.current.lastActivity = performance.now();
        const pointer = drag.current;
        if (!pointer.active || !(event.buttons & 1)) return;
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        if (!pointer.moved && Math.hypot(dx, dy) < 6) return;
        if (!pointer.moved && event.pointerType === "touch" && Math.abs(dy) > Math.abs(dx)) { pointer.active = false; return; }
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
      }}
      onPointerUp={(event) => { drag.current.active = false; event.currentTarget.dataset.dragging = "false"; }}
      onPointerCancel={() => { drag.current.active = false; drag.current.moved = false; }}
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
          onPointerEnter={() => { movement.current.hover = index; }}
          onPointerLeave={() => { movement.current.hover = -1; }}
          onFocus={(event) => {
            movement.current.hover = index;
            if (event.currentTarget.matches(":focus-visible")) {
              const { stepX, stepY } = wallGeometry(root.current?.clientWidth ?? 1440);
              movement.current.target = { x: -(col + (row & 1) / 2) * stepX, y: -row * stepY };
            }
          }}
          onBlur={() => { movement.current.target = null; movement.current.hover = -1; }}
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
            <img src={image.image} alt="" draggable={false} decoding="async" fetchPriority={row === 0 ? "high" : "auto"} />
            <span className="wall-caption"><small>{image.category}</small><span>{image.title}</span></span>
          </span>
        </button>;
      })}</div>
      <div className="wall-scrim" />
    </div>
  );
}
