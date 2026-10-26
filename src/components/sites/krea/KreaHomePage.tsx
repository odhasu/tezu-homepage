"use client";

/* eslint-disable @next/next/no-img-element -- Source artwork is downloaded and preoptimized locally. */

import { ChevronDown, Clapperboard, Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ImageWall, type WallImage } from "./ImageWall";
import { GlassLens } from "./HeroEffects";
import { TezuResults } from "./TezuShowcase";
import { FadeText, RotatingPrompt } from "./AnimatedText";
import { MediaGallery } from "./MediaGallery";
import { IntegrationBanner } from "./IntegrationBanner";
import { TezuSiteHeader } from "./TezuSiteHeader";
import { TezuMotionGalleries } from "./TezuMotionGalleries";
import "./text-motion.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const getMotionPreference = () => window.matchMedia(motionQuery).matches;
const serverMotionPreference = () => false;

function Sparkle() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1.65 0 1.67 5.62 3.1 6.9C16.38 10.33 22 10.35 22 12s-5.62 1.67-6.9 3.1C13.67 16.38 13.65 22 12 22s-1.67-5.62-3.1-6.9C7.62 13.67 2 13.65 2 12s5.62-1.67 6.9-3.1C10.33 7.62 10.35 2 12 2Z" /></svg>;
}

function Hero({ reducedMotion }: { reducedMotion: boolean }) {
  const hero = useRef<HTMLElement>(null);
  const [prompt, setPrompt] = useState("");
  const [batch, setBatch] = useState(3);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptBox = useRef<HTMLFormElement>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  const useExample = (image: WallImage) => {
    setPrompt(image.prompt);
    setAttachment(image.reference);
    textarea.current?.focus({ preventScroll: true });
  };

  return <section id="home" ref={hero} className="hero" aria-labelledby="hero-heading">
    <GlassLens target={promptBox} />
    <ImageWall onSelect={useExample} reducedMotion={reducedMotion} paused={focused || !!prompt || !!attachment} />
    <div className="prompt-position">
      <div className="hero-copy">
        <h1 id="hero-heading"><FadeText text="Create beyond imagination." delay={100} /></h1>
        <p><FadeText text="Your characters. Your stories. Brought to life." delay={340} /></p>
      </div>
      <form ref={promptBox} className="glass-prompt" action="https://tezu.ai/create/video" method="get" onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        {attachment && <div className="prompt-attachment"><img src={attachment} alt="Image reference" />
          <button type="button" aria-label="Remove image" onClick={() => setAttachment(null)}><X size={14} /></button>
        </div>}
        <div className="prompt-input">
          <textarea ref={textarea} value={prompt} onChange={(event) => setPrompt(event.target.value)} name="prompt" aria-label="Describe an idea" placeholder={focused ? "Describe your video or add an image to animate…" : ""} rows={2} required />
          <RotatingPrompt reducedMotion={reducedMotion} active={!prompt && !focused} />
        </div>
        <div className="prompt-toolbar">
          <input ref={fileInput} className="sr-only" tabIndex={-1} type="file" accept="image/*" aria-label="Upload reference image" onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
            objectUrl.current = URL.createObjectURL(file);
            setAttachment(objectUrl.current);
          }} />
          <button className="glass-button add-reference" type="button" aria-label="Add image" onClick={() => fileInput.current?.click()}><Plus size={20} strokeWidth={1.3} /></button>
          <span className="glass-button model-option" aria-label="Video model: Seedance 2.5"><Clapperboard size={17} strokeWidth={1.4} /><span>Seedance 2.5</span></span>
          <input type="hidden" name="model" value="seedance-2.5" />
          <div className="resolution-option">
            <select className="glass-button resolution-select" name="resolution" aria-label="Video resolution" defaultValue="720p">
              <option value="480p">480p</option>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </div>
          <div className="batch-control" aria-label="Batch size"><button type="button" aria-label="Fewer videos" disabled={batch === 1} onClick={() => setBatch(Math.max(1, batch - 1))}><Minus size={14} /></button><output aria-live="polite">{batch}</output><button type="button" aria-label="More videos" disabled={batch === 8} onClick={() => setBatch(Math.min(8, batch + 1))}><Plus size={14} /></button></div>
          <input type="hidden" name="batchSize" value={batch} />
          <button className="generate-button" aria-label="Generate videos on Tezu" title="Generate videos on Tezu" type="submit"><Sparkle /></button>
        </div>
      </form>
    </div>
  </section>;
}

export function KreaHomePage() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getMotionPreference, serverMotionPreference);
  return <><TezuSiteHeader /><main id="main-content" className="krea-home"><Hero reducedMotion={reducedMotion} /><MediaGallery reducedMotion={reducedMotion} /><IntegrationBanner /><TezuMotionGalleries reducedMotion={reducedMotion} /><TezuResults reducedMotion={reducedMotion} /></main></>;
}
