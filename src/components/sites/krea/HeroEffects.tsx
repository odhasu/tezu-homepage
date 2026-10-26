"use client";

import { useEffect, useRef, type RefObject } from "react";

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
