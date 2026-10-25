"use client";

import { useEffect, useRef, type RefObject } from "react";
import { wallGeometry } from "./wall-geometry";

// Invert the entrance curve so the zoom and glass arrive together.
function entranceEase(x: number) {
  const bezier = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, 0.6, 0.2) < x) low = mid;
    else high = mid;
  }
  return bezier((low + high) / 2, 0.02, 1);
}

export function useHeroEntrance(hero: RefObject<HTMLElement | null>, prompt: RefObject<HTMLFormElement | null>, reducedMotion: boolean) {
  useEffect(() => {
    const region = hero.current;
    const form = prompt.current;
    const stage = region?.querySelector<HTMLElement>(".wall-stage");
    const title = region?.querySelector<HTMLElement>(".hero-intro");
    const wall = region?.querySelector<HTMLElement>(".image-wall");
    const centre = stage?.querySelector<HTMLImageElement>("[data-origin=true] img");
    if (!region || !form || !stage || !title || !wall) return;
    if (region.dataset.entered === "true") return;
    if (reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      region.setAttribute("data-entered", "true");
      return;
    }
    let frame = 0;
    let fallback: ReturnType<typeof setTimeout>;
    let cancelled = false;
    let started = 0;
    const angle = -18;
    const radians = Math.abs(angle) * Math.PI / 180;
    form.setAttribute("inert", "");
    wall.setAttribute("inert", "");
    function animate(time: number) {
      if (!region || !form || !stage || !wall) return;
      const elapsed = Math.min(1, (time - started) / 5500);
      const progress = entranceEase(elapsed);
      const width = region.clientWidth;
      const height = region.clientHeight;
      const { tileWidth, tileHeight } = wallGeometry(width);
      const origin = centre?.closest<HTMLElement>(".wall-tile");
      const originWidth = origin?.offsetWidth || tileWidth;
      const originHeight = origin?.offsetHeight || tileHeight;
      const zoom = Math.max((width * Math.cos(radians) + height * Math.sin(radians)) / originWidth, (width * Math.sin(radians) + height * Math.cos(radians)) / originHeight) * 1.1;
      const glassZoom = Math.max(width / form.offsetWidth, height / form.offsetHeight) * 1.15;
      stage.style.transform = `scale(${zoom ** (1 - progress)}) rotate(${angle * (1 - progress)}deg)`;
      form.style.scale = String(glassZoom ** (1 - Math.max(0, (progress - 0.12) / 0.88)) ** 2);
      const fade = Math.max(0, Math.min(1, (progress - 0.55) / 0.45));
      form.style.setProperty("--controls-opacity", String(fade * fade * (3 - 2 * fade)));
      form.inert = progress < 0.85;
      if (elapsed < 1) frame = requestAnimationFrame(animate);
      else {
        region.dataset.entered = "true";
        wall.inert = false;
        stage.style.removeProperty("transform");
        form.style.removeProperty("scale");
        form.style.removeProperty("--controls-opacity");
      }
    }

    // Like the source, finish the title and load the central artwork before zooming.
    const artworkReady = Promise.race([
      centre?.decode().catch(() => {}),
      new Promise<void>((resolve) => { fallback = setTimeout(resolve, 6000); }),
    ]);
    const titleReady = Promise.allSettled(title.getAnimations({ subtree: true }).map((animation) => animation.finished));
    void Promise.all([artworkReady, titleReady]).then(() => {
      clearTimeout(fallback);
      if (cancelled) return;
      started = performance.now();
      animate(started);
      region.dataset.go = "true";
    });
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      cancelAnimationFrame(frame);
      stage.style.removeProperty("transform");
      form.style.removeProperty("scale");
      form.style.removeProperty("--controls-opacity");
      form.inert = false;
      wall.inert = false;
      delete region.dataset.go;
      delete region.dataset.entered;
    };
  }, [hero, prompt, reducedMotion]);
}

export function GlassLens({ target }: { target: RefObject<HTMLFormElement | null> }) {
  const image = useRef<SVGFEImageElement>(null);
  useEffect(() => {
    const element = target.current;
    if (!element || !CSS.supports("backdrop-filter", "url(#krea-glass)")) return;
    const resize = new ResizeObserver(() => {
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      if (!width || !height) return;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      const pixels = context.createImageData(width, height);
      const radius = parseFloat(getComputedStyle(element).borderRadius) || 32;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const px = x - width / 2;
          const py = y - height / 2;
          const qx = Math.abs(px) - width / 2 + radius;
          const qy = Math.abs(py) - height / 2 + radius;
          const cx = Math.max(qx, 0);
          const cy = Math.max(qy, 0);
          const length = Math.hypot(cx, cy);
          const distance = -(length + Math.min(Math.max(qx, qy), 0) - radius);
          const bend = distance >= 0 && distance < 20 ? Math.cos(distance / 20 * Math.PI / 2) ** 2 : 0;
          const nx = length ? cx / length : +(qx > qy);
          const ny = length ? cy / length : +(qy >= qx);
          const index = (y * width + x) * 4;
          pixels.data[index] = 128 + Math.sign(px) * nx * bend * 127;
          pixels.data[index + 1] = 128 + Math.sign(py) * ny * bend * 127;
          pixels.data[index + 2] = 128;
          pixels.data[index + 3] = 255;
        }
      }
      context.putImageData(pixels, 0, 0);
      image.current?.setAttribute("href", canvas.toDataURL());
      image.current?.setAttribute("width", String(width));
      image.current?.setAttribute("height", String(height));
      element.dataset.lens = "true";
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, [target]);
  return <svg className="glass-filter" aria-hidden="true" width="0" height="0"><defs><filter id="krea-glass" x="0" y="0" width="100%" height="100%" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="frost" />
    <feImage ref={image} result="lens" />
    <feDisplacementMap in="frost" in2="lens" scale="38" xChannelSelector="R" yChannelSelector="G" />
  </filter></defs></svg>;
}
