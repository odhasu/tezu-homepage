"use client";

import { ArrowUpRight, Pause, Play, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tezuMedia as media } from "./assets";
import { tezuAppHome } from "./app-links";
import { FadeText } from "./AnimatedText";
import "./tezu-showcase.css";

type MediaItem = (typeof media)[number];
const templateVideos = media.filter(item => item.id.startsWith("template-"));
const cartoonHref = `${tezuAppHome}#mcp`;
const templateHref = `${tezuAppHome}templates/`;

function TezuVideo({ item, reducedMotion, paused }: { item: MediaItem; reducedMotion: boolean; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
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
    const update = () => {
      if (visible && !paused && !reducedMotion && document.visibilityState === "visible") void element.play().catch(() => {});
      else element.pause();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); element.pause(); };
  }, [visible, loaded, paused, reducedMotion]);
  return <video ref={video} src={loaded ? item.src : undefined} poster={item.poster} width={item.width} height={item.height} muted loop playsInline preload={loaded ? "metadata" : "none"} aria-label={item.title} />;
}

export function TezuResults({ reducedMotion }: { reducedMotion: boolean }) {
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const results = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const headings = results.current?.querySelectorAll<HTMLElement>(".showcase-copy");
    if (!headings) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.visible = "true"; observer.unobserve(entry.target); } });
    }, { threshold: .2 });
    headings.forEach(heading => observer.observe(heading));
    return () => observer.disconnect();
  }, []);
  const open = (item: MediaItem) => { setSelected(item); dialog.current?.showModal(); };
  const groups = [
    { id: "character-swap", title: "Character Swap", description: "Pick a template. Add your characters. Make the scene yours.", action: "Explore templates", href: templateHref, items: templateVideos },
  ];
  return <div ref={results} className="tezu-showcases">
    {groups.map(group => <section id={group.id} className="tezu-results" key={group.id} aria-labelledby={`${group.id}-heading`}>
      <div className="tezu-showcase-heading">
        <div className="showcase-copy"><h2 id={`${group.id}-heading`}><FadeText text={group.title} /></h2><p>{group.description}</p></div>
        <div className="tezu-showcase-actions"><a href={group.href}>{group.action}<ArrowUpRight size={17} aria-hidden="true" /></a>
          {!reducedMotion && <button type="button" className="tezu-pause" onClick={() => setPaused(current => !current)} aria-label={`${paused ? "Play" : "Pause"} ${group.title} videos`}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>}
        </div>
      </div>
      <div className="tezu-results-grid">{group.items.map(item => <button className="tezu-result" key={item.id} type="button" aria-label={`View ${item.title}`} onClick={() => open(item)} style={{ "--media-ratio": `${item.width} / ${item.height}` } as CSSProperties}>
        <TezuVideo item={item} reducedMotion={reducedMotion} paused={paused || !!selected} />
        <span className="tezu-result-shade" /><span className="tezu-result-caption">{item.title.replace("Video for ", "")}</span>
        <span className="tezu-result-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
      </button>)}</div>
    </section>)}
    <dialog ref={dialog} className="tezu-media-dialog" aria-label="Tezu video preview" onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <button className="tezu-dialog-close" type="button" aria-label="Close video preview" onClick={() => dialog.current?.close()}><X size={24} /></button>
      {selected && <div className="tezu-dialog-content"><video key={selected.id} src={selected.src} poster={selected.poster} width={selected.width} height={selected.height} controls autoPlay playsInline />
        <div><p>{selected.title}</p><a href={selected.id.startsWith("template-") ? templateHref : cartoonHref}>Create with Tezu<ArrowUpRight size={16} /></a></div>
      </div>}
    </dialog>
  </div>;
}
