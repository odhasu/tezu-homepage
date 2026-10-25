"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clapperboard, ImageIcon, ImagePlus, SlidersHorizontal, UserRound, X } from "lucide-react";
import { asset } from "./assets";
import media from "./media-content.json";
import { BalloonWordmark, type BalloonAnimation } from "./BalloonWordmark";
import { ModelPicker } from "./ModelPicker";
import "./home-hero.css";

type Kind = "character" | "image" | "video";
const modes = [
  { id: "character" as const, label: "Character", icon: UserRound },
  { id: "image" as const, label: "Image", icon: ImageIcon },
  { id: "video" as const, label: "Video", icon: Clapperboard },
];
const models = {
  character: [{ id: "", name: "TEZU Character", logo: "tezu-white-knot-logo.png" }],
  image: [{ id: "nano-banana-2.1", name: "Nano Banana 2.1", logo: "model-gemini.svg" }, { id: "gpt-image-2.5", name: "GPT Image 2.5", logo: "model-openai.svg" }, { id: "grok-imagine", name: "Grok Imagine", logo: "model-grok.svg" }],
  video: [{ id: "seedance-2.5", name: "Seedance 2.5", logo: "model-bytedance.svg" }, { id: "minimax-h3", name: "MiniMax H3", logo: "model-minimax.svg" }, { id: "wan-3", name: "Wan 3.0", logo: "model-qwen.svg" }],
};
const tiles = [0, 11, 4, 12, 8, 2].map((index) => media.filter((item) => item.kind === "creation")[index]);

export function HomeHero({ wordmarkAnimation, wordmarkReplay = 0 }: { wordmarkAnimation?: BalloonAnimation; wordmarkReplay?: number }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("video");
  const [model, setModel] = useState("seedance-2.5");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [duration, setDuration] = useState("5s");
  const [reference, setReference] = useState<{ url: string; name: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const stage = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const videos = Array.from(element.querySelectorAll<HTMLVideoElement>(".stage-tile video"));
    let visible = false;
    const update = () => {
      const play = visible && !preference.matches && document.visibilityState === "visible";
      for (const video of videos) {
        if (play && getComputedStyle(video.parentElement!).display !== "none") void video.play().catch(() => {});
        else video.pause();
      }
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .08 });
    observer.observe(element);
    preference.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); preference.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); videos.forEach((video) => video.pause()); };
  }, []);

  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);

  function changeKind(next: Kind) { setKind(next); setModel(models[next][0].id); }
  function addReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setFileError("Choose a JPG, PNG, WebP or AVIF image under 10 MB.");
    } else { setReference({ url: URL.createObjectURL(file), name: file.name }); setFileError(""); }
    event.target.value = "";
  }
  function openStudio(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = new URLSearchParams();
    if (model) query.set("model", model);
    if (prompt.trim()) query.set("prompt", prompt.trim());
    if (kind !== "character") query.set("ratio", ratio);
    if (kind === "video") query.set("duration", duration.replace("s", ""));
    router.push(`/create/${kind}${query.size ? `?${query}` : ""}`);
  }

  return (
    <section className="home-stage" ref={stage} aria-labelledby="home-title">
      <div className="stage-glow" aria-hidden="true" />
      <div className="stage-gallery" aria-hidden="true">
        {tiles.map((item, index) => <div className={`stage-tile stage-tile-${index}`} key={`${item.video}-${index}`}><video src={asset(item.video)} poster={asset(item.poster)} muted loop playsInline preload="none" /><span>{["Character stories", "Cinematic worlds", "Made with TEZU", "Endless expressions", "Your next scene", "Ideas in motion"][index]}</span></div>)}
      </div>
      <div className="stage-content">
        <BalloonWordmark animation={wordmarkAnimation} replay={wordmarkReplay} />
        <h1 id="home-title">Create beyond imagination.</h1>
        <p className="stage-description">Your characters. Your worlds. Your way.<br />Turn a few words into images and cinematic video.</p>
        <form className="stage-composer" onSubmit={openStudio}>
          <div className="stage-modes" role="group" aria-label="What do you want to create?">{modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => changeKind(id)}><Icon size={15} aria-hidden="true" />{label}</button>)}</div>
          <label className="sr-only" htmlFor="hero-prompt">Describe what you want to create</label>
          <textarea id="hero-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} maxLength={kind === "character" ? 500 : 3000} placeholder={kind === "character" ? "A character only you could imagine..." : kind === "image" ? "A new world, a familiar face, a different point of view..." : "A slow camera move through a neon city. Your character steps into the light..."} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") event.currentTarget.form?.requestSubmit(); }} />
          {reference && <div className="stage-reference"><img src={reference.url} alt="Your reference preview" width={38} height={38} /><span>{reference.name}<small>Local preview · add again in the studio</small></span><button className="icon-button" type="button" aria-label="Remove reference image" onClick={() => setReference(null)}><X size={14} /></button></div>}
          {fileError && <p className="stage-file-error" role="alert">{fileError}</p>}
          <div className="stage-toolbar">
            <div className="stage-tool-options">
              <input ref={fileInput} type="file" className="sr-only" tabIndex={-1} accept="image/jpeg,image/png,image/webp,image/avif" onChange={addReference} aria-label="Choose a reference image" />
              <button className="stage-add-image" type="button" aria-label="Add a reference image" onClick={() => fileInput.current?.click()}><ImagePlus size={18} /></button>
              <ModelPicker key={kind} models={models[kind]} value={model} onValueChange={setModel} />
              {kind !== "character" && <details className="stage-settings"><summary aria-label="Output settings"><SlidersHorizontal size={14} aria-hidden="true" /><span>{ratio}{kind === "video" && ` · ${duration}`}</span></summary><div><label>Format<select value={ratio} onChange={(event) => setRatio(event.target.value)}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>{kind === "video" && <label>Duration<select value={duration} onChange={(event) => setDuration(event.target.value)}><option>5s</option><option>10s</option></select></label>}<p>Applied when you open the studio.</p></div></details>}
            </div>
            <button className="stage-submit" type="submit">{kind === "video" ? "Create a video" : kind === "image" ? "Create an image" : "Create a character"}<ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </form>
      </div>
    </section>
  );
}
