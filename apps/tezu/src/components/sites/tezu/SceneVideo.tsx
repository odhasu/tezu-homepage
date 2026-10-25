"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { asset } from "./assets";

/** Silent previews run only while visible, with manual playback for reduced motion. */
export function SceneVideo({ video, poster, label, paused }: { video: string; poster: string; label: string; paused: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const manuallyStarted = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [userPaused, setUserPaused] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const update = () => {
      if (visible && !paused && !userPaused && (!preference.matches || manuallyStarted.current) && document.visibilityState === "visible") void element.play().catch(() => {});
      else element.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .3 });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    preference.addEventListener("change", update);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); preference.removeEventListener("change", update); element.pause(); };
  }, [paused, userPaused]);

  function toggle() {
    const element = ref.current;
    if (!element) return;
    if (!element.paused) { setUserPaused(true); element.pause(); }
    else { manuallyStarted.current = true; setUserPaused(false); setFailed(false); setLoading(true); void element.play().catch(() => { setLoading(false); setFailed(true); }); }
  }

  return <div className="scene-video"><video ref={ref} src={asset(video)} poster={asset(poster)} muted loop playsInline preload="none" aria-label={label} onWaiting={() => setLoading(true)} onPlaying={() => { setLoading(false); setPlaying(true); }} onPause={() => { setPlaying(false); setLoading(false); }} onError={() => { setLoading(false); setFailed(true); }} /><button type="button" className="scene-play" aria-label={playing ? "Pause scene preview" : label} onClick={toggle}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}</button>{loading && !failed && <p className="scene-loading" role="status">Loading scene…</p>}{failed && <p className="scene-error" role="status">Preview unavailable. Try playing again.</p>}</div>;
}
