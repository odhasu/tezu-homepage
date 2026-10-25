"use client";

/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, Users, X } from "lucide-react";
import { asset } from "./assets";
import content from "./media-content.json";
import faq from "./faq-content.json";
import { Footer } from "./SiteShell";
import { PricingCards } from "./Pricing";
import { CreationEngine } from "./CreationEngine";
import { CartoonWorkflow } from "./CartoonWorkflow";
import { HomeHero } from "./HomeHero";
import "./home.css";

type MediaItem = typeof content[number];
const creations = content.filter(item => item.kind === "creation");
const templates = content.filter(item => item.kind === "template");

function MediaPreview({ item, close }: { item: MediaItem; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video');
        if (!focusable?.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", listener);
    return () => { document.body.style.overflow = original; document.removeEventListener("keydown", listener); before?.focus(); };
  }, [close]);

  return <div className="media-overlay" onClick={close}><div className="media-modal" role="dialog" aria-modal="true" aria-labelledby="media-title" ref={ref} onClick={event => event.stopPropagation()}>
    <button className="media-close icon-button" aria-label="Close preview" onClick={close}><X /></button>
    <video ref={video} src={asset(item.video)} poster={asset(item.poster)} controls autoPlay playsInline onCanPlay={() => setLoading(false)} onError={() => { setLoading(false); setFailed(true); }} />
    {loading && <p className="media-status" role="status">Loading preview…</p>}
    {failed && <div className="media-failure" role="alert"><p>This clip could not load.</p><button className="secondary-button" onClick={() => { setFailed(false); setLoading(true); video.current?.load(); void video.current?.play().catch(() => { setLoading(false); setFailed(true); }); }}>Try again</button></div>}
    <div className="media-modal-caption"><h2 id="media-title">{item.title}</h2>{item.kind === "template" && <Link className="primary-button" href={"/templates/" + item.title.toLowerCase().replaceAll(" ", "-")}>View template</Link>}</div>
  </div></div>;
}

function MediaRail({ kind, preview }: { kind: "creation" | "template"; preview: (item: MediaItem) => void }) {
  const rail = useRef<HTMLDivElement>(null);
  const items = kind === "template" ? templates : creations;
  const interaction = useRef(false);
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    let frame = 0;
    let previous = 0;
    let visible = false;
    let position = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(element);
    const mediaObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting && !reducedMotion) void video.play().catch(() => {});
        else video.pause();
      }
    }, { threshold: .1 });
    element.querySelectorAll("video").forEach(video => mediaObserver.observe(video));
    const resize = new ResizeObserver(() => {
      const cards = element.querySelectorAll<HTMLElement>(".media-card");
      position = (cards[items.length]?.offsetLeft ?? 0) - (cards[0]?.offsetLeft ?? 0);
      element.scrollLeft = position;
    });
    resize.observe(element);
    const animate = (time: number) => {
      if (visible && !interaction.current && !reducedMotion && previous) {
        const period = element.scrollWidth / 3;
        position = Math.abs(position - element.scrollLeft) > 2 ? element.scrollLeft : position;
        position += Math.min(time - previous, 50) * .025;
        element.scrollLeft = position;
        if (element.scrollLeft >= period * 2) { position -= period; element.scrollLeft = position; }
        else if (element.scrollLeft < period / 2) { position += period; element.scrollLeft = position; }
      }
      previous = time;
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mediaObserver.disconnect(); resize.disconnect(); };
  }, [items]);
  return <div className="media-rail-wrap"><div className="media-rail" ref={rail} onPointerEnter={() => { interaction.current = true; }} onPointerLeave={() => { interaction.current = false; }} onFocusCapture={() => { interaction.current = true; }} onBlurCapture={() => { interaction.current = false; }}>{[...items, ...items, ...items].map((item, index) => { const i = index % items.length; return <button className="media-card" key={`${index}-${item.video}`} aria-label={kind === "template" ? `Preview the ${item.title} template` : `Play ${item.title}`} onClick={() => preview(item)}><video src={asset(item.video)} poster={asset(item.poster)} muted loop playsInline preload="none" onMouseEnter={event => { void event.currentTarget.play().catch(() => {}); }} onMouseLeave={event => { event.currentTarget.pause(); }} /><div className="media-card-shade" /><span className="media-card-play"><Play size={20} fill="currentColor" /></span>{kind === "template" && <span className="people-count"><Users size={12} />{[2,1,1,1,2,2,2,3,1][i]} {i === 0 || (i > 3 && i < 8) ? "PEOPLE" : "PERSON"}</span>}<span className="media-card-title">{item.title}</span></button>; })}</div><div className="rail-arrows"><button className="icon-button" aria-label={`Scroll to previous ${kind === "template" ? "templates" : "creations"}`} onClick={() => rail.current?.scrollBy({left: -(rail.current.clientWidth * .8), behavior: "smooth"})}><ChevronLeft size={18} /></button><button className="icon-button" aria-label={`Scroll to more ${kind === "template" ? "templates" : "creations"}`} onClick={() => rail.current?.scrollBy({left: rail.current.clientWidth * .8, behavior: "smooth"})}><ChevronRight size={18} /></button></div></div>;
}



export function HomePage() {
  const [character, setCharacter] = useState("Boy");
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [preview, setPreview] = useState<MediaItem | null>(null);
  const [paused, setPaused] = useState(false);
  const cinema = useRef<HTMLVideoElement>(null);
  const cinematicSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!cinematicSection.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && !paused && !reduced) void cinema.current?.play().catch(() => {}); else cinema.current?.pause(); }, {threshold: .15});
    observer.observe(cinematicSection.current);
    return () => observer.disconnect();
  }, [paused]);
  return <main id="main-content" tabIndex={-1}>
    <HomeHero wordmarkAnimation="float-up" />
    <section data-reveal className="cinema-section" ref={cinematicSection} aria-label="TEZU IN MOTION."><div className="cinema-tv"><div className="cinema-screen"><video ref={cinema} src={asset("0808_170-cinema.webm")} poster={asset("0808_170-cinema.jpg")} muted loop playsInline preload="none" /></div><img className="cinema-frame" src={asset("tezu-crt-frame.png")} alt="" loading="lazy" /><div className="cinema-content"><span>TEZU VIDEO STUDIO</span><h2>TEZU<br />IN MOTION.</h2><Link href="/create/video" className="primary-button">Create a video <ArrowUpRight size={18} /></Link></div><button className="cinema-pause icon-button" aria-label={paused ? "Play cinematic preview" : "Pause cinematic preview"} onClick={() => {setPaused(!paused);if (!paused) cinema.current?.pause();else void cinema.current?.play().catch(() => {});}}>{paused ? <Play size={17} /> : <Pause size={17} />}</button></div></section>
    <CreationEngine />
    <CartoonWorkflow />
    <section data-reveal className="section character-section" id="characters"><div className="section-inner"><div className="character-heading"><div className="section-heading feature-heading"><h2>One character. Any scene.</h2><p>Make a character. Put them in a scene. Bring them to life.</p></div><div className="character-toggle" role="radiogroup" aria-label="Example character">{["Boy","Girl"].map(value => <button key={value} role="radio" aria-checked={value === character} onClick={() => setCharacter(value)}>{value}{value === character && <Check size={14} />}</button>)}</div></div><div className="character-journey"><div className="journey-cell"><img src={asset(character === "Boy" ? "boy.png" : "girl-sheet-v2.webp")} alt={`Example ${character.toLowerCase()} character reference sheet`} loading="lazy" /><span><b>01</b> Character</span></div><div className="journey-cell"><img src={asset(character === "Boy" ? "boy-scene.webp" : "girl-scene.webp")} alt="Example image scene made from the character" loading="lazy" /><span><b>02</b> Image</span></div><div className="journey-cell"><video src={asset(character === "Boy" ? "tezu-07-preview.mp4" : "tezu-08-preview.mp4")} poster={asset(character === "Boy" ? "tezu-07-poster.jpg" : "tezu-08-poster.jpg")} autoPlay muted loop playsInline preload="none" /><span><b>03</b> Video</span></div></div><div className="journey-caption"><p>Results can vary between scenes. Using saved characters in Image and Video Studio is rolling out during launch testing.</p><Link href="/create/character" className="secondary-button">Create your own character <ArrowRight size={15} /></Link></div></div></section>
    <section data-reveal className="section" id="explore"><div className="section-inner"><div className="section-heading"><h2>Explore creations</h2><p>See what&apos;s possible with TEZU. Examples made by the TEZU team.</p></div><MediaRail kind="creation" preview={setPreview} /></div></section>
    <section data-reveal className="section" id="templates"><div className="section-inner"><div className="section-heading"><h2>Templates</h2><p>Copy a clip, swap in your characters, generate the full sequence.</p><Link href="/templates">View all <ArrowRight size={13} /></Link></div><MediaRail kind="template" preview={setPreview} /></div></section>
    <PricingCards home />
    <section data-reveal className="section faq-section" id="faq"><div className="section-inner"><div className="faq-heading"><span className="eyebrow">FAQ</span><h2>Questions, answered.</h2><p>Something else? <Link href="/hire">Get in touch</Link>.</p></div><div className="faq-list">{faq.map(([question, answer], index) => <div className={`faq-item ${activeFaq === index ? "open" : ""}`} key={question}><h3><button aria-expanded={activeFaq === index} aria-controls={`faq-answer-${index}`} onClick={() => setActiveFaq(activeFaq === index ? null : index)}>{question}<ChevronDown size={16} /></button></h3><div id={`faq-answer-${index}`} hidden={activeFaq !== index}><p>{answer}</p></div></div>)}</div></div></section>
    <section data-reveal className="final-cta section"><div><h2>Start with one idea.</h2><p>Make a character, an image or a scene — then keep going.</p><div><Link className="primary-button" href="/auth?mode=signup">Start Creating <ArrowRight size={16} /></Link><a className="secondary-button" href="#explore">Explore Creations</a></div></div></section>
    <Footer />
    {preview && <MediaPreview item={preview} close={() => setPreview(null)} />}
  </main>;
}
