"use client";

/* eslint-disable @next/next/no-img-element -- Original source files preserve the supplied media formats. */

import { ArrowRight, Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tezuMedia as media } from "./assets";
import "./tezu-showcase.css";

type MediaItem = (typeof media)[number];

function TezuVideo({ item, reducedMotion, paused = false, autoplay = false, className }: {
  item: MediaItem; reducedMotion: boolean; paused?: boolean; autoplay?: boolean; className?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (entry.isIntersecting) setLoaded(true);
    }, { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (visible && !paused && !reducedMotion && (autoplay || hovered)) void element.play().catch(() => {});
    else element.pause();
  }, [visible, paused, reducedMotion, autoplay, hovered]);
  return <video ref={video} className={className} src={loaded ? item.src : undefined} poster={item.poster}
    width={item.width} height={item.height} muted loop playsInline preload={loaded ? "metadata" : "none"} aria-label={item.title}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} />;
}

const features = [
  { title: "Cartoon Maker", mediaId: "tezu-07-preview", href: "https://tezu.ai/create/video", action: "Create a cartoon" },
  { title: "Character Swap", mediaId: "template-1", href: "https://tezu.ai/templates", action: "Swap a character" },
];

export function TezuFeatures({ reducedMotion }: { reducedMotion: boolean }) {
  return <section className="tezu-features" aria-labelledby="tezu-create-heading">
    <div className="section-heading"><h2 id="tezu-create-heading">Create with Tezu</h2></div>
    <div className="tezu-feature-grid">{features.map((feature) => {
      const item = media.find((item) => item.id === feature.mediaId)!;
      return <a className="tezu-feature" key={feature.title} href={feature.href}>
        <div className="tezu-feature-preview"><TezuVideo item={item} reducedMotion={reducedMotion} autoplay />
          <span className="tezu-feature-shade" />
        </div>
        <div className="tezu-feature-copy"><h3>{feature.title}</h3><span>{feature.action}<ArrowRight size={18} /></span></div>
      </a>;
    })}</div>
  </section>;
}

export function TezuResults({ reducedMotion }: { reducedMotion: boolean }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const open = (item: MediaItem) => { setSelected(item); dialog.current?.showModal(); };
  return <section className="tezu-results" aria-labelledby="tezu-results-heading">
    <div className="tezu-results-heading"><h2 id="tezu-results-heading">Tezu results</h2>
      {!reducedMotion && <button type="button" className="tezu-pause" onClick={() => setPaused(!paused)} aria-label={paused ? "Play result videos" : "Pause result videos"}>{paused ? <Play size={17} /> : <Pause size={17} />}</button>}
    </div>
    <div className="tezu-results-grid">{media.map((item) => <button className="tezu-result" key={item.id} type="button" aria-label={`View ${item.title}`} onClick={() => open(item)} style={{ "--media-ratio": `${item.width} / ${item.height}` } as CSSProperties}>
      {item.kind === "video" ? <TezuVideo item={item} reducedMotion={reducedMotion} paused={paused || !!selected} autoplay /> : <img src={item.src} width={item.width} height={item.height} alt={item.title} loading="lazy" />}
      <span className="tezu-result-shade" />
      {item.kind === "video" && <span className="tezu-result-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>}
    </button>)}</div>
    <dialog ref={dialog} className="tezu-media-dialog" aria-label="Tezu result preview" onClose={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button className="tezu-dialog-close" type="button" aria-label="Close result preview" onClick={() => dialog.current?.close()}><X size={24} /></button>
      {selected && <div className="tezu-dialog-content">
        {selected.kind === "video" ? <video key={selected.id} src={selected.src} poster={selected.poster} width={selected.width} height={selected.height} controls autoPlay playsInline /> : <img src={selected.src} width={selected.width} height={selected.height} alt={selected.title} />}
        <div><p>{selected.title}</p><a href={selected.href} target="_blank" rel="noreferrer">Create with Tezu <ArrowRight size={16} /></a></div>
      </div>}
    </dialog>
  </section>;
}
