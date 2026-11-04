"use client";

import { localPath } from "@/lib/local-path";
import { useEffect, useRef, useState } from "react";

export type MediaItem = {
  poster: string;
  src?: string;
  label?: string;
  kind?: string;
};

export function Media({ item }: { item: MediaItem }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video || !item.src) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    function sync() {
      if (!video) return;
      if (visible && !document.hidden && !reducedMotion.matches)
        void video.play().catch(() => {});
      else video.pause();
    }
    const preload = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          preload.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    const playback = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { threshold: 0.1 },
    );
    preload.observe(video);
    playback.observe(video);
    video.addEventListener("loadeddata", sync);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    return () => {
      preload.disconnect();
      playback.disconnect();
      video.pause();
      video.removeEventListener("loadeddata", sync);
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, [item.src]);
  if (!item.src || item.kind === "image")
    return (
      <img
        src={localPath(item.poster)}
        alt={item.label ?? ""}
        loading="lazy"
        decoding="async"
      />
    );
  return (
    <video
      ref={ref}
      src={near ? localPath(item.src) : undefined}
      poster={localPath(item.poster)}
      aria-label={item.label}
      muted
      loop
      playsInline
      preload="none"
    />
  );
}
