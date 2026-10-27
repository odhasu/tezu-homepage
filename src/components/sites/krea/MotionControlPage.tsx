"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Heart, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { publicAsset } from "./asset-urls";
import { TezuSiteHeader } from "./TezuSiteHeader";
import { TezuFaq } from "./TezuFaq";
import "./motion-control.css";

export function MotionControlPage() {
  const viralVideo = useRef<HTMLVideoElement>(null);
  const referenceVideo = useRef<HTMLVideoElement>(null);
  const wantsPlayback = useRef(false);
  const attempt = useRef(0);
  const mounted = useRef(false);
  const [position, setPosition] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [mediaError, setMediaError] = useState(false);

  const pause = useCallback((manual = true) => {
    attempt.current += 1;
    if (manual) wantsPlayback.current = false;
    viralVideo.current?.pause();
    referenceVideo.current?.pause();
    setPlaying(false);
    setPending(false);
  }, []);

  const play = useCallback(async () => {
    const viral = viralVideo.current;
    const reference = referenceVideo.current;
    if (!viral || !reference) return;
    const request = ++attempt.current;
    wantsPlayback.current = true;
    setPending(true);
    setMessage("");
    if (reference.readyState >= 1) reference.currentTime = Math.min(viral.currentTime, reference.duration || 0);
    try {
      await Promise.all([viral.play(), reference.play()]);
      if (!mounted.current || request !== attempt.current) return;
      setPlaying(true);
      setPending(false);
    } catch {
      if (!mounted.current || request !== attempt.current) return;
      wantsPlayback.current = false;
      viral.pause();
      reference.pause();
      setPlaying(false);
      setPending(false);
      setMessage("Playback is paused. Press Play comparison to start both videos.");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const autoplay = requestAnimationFrame(() => {
      if (!reducedMotion.matches && document.visibilityState === "visible") void play();
    });
    const onMotionChange = () => { if (reducedMotion.matches) pause(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pause(false);
      else if (wantsPlayback.current && !reducedMotion.matches) void play();
    };
    reducedMotion.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const viral = viralVideo.current;
    const reference = referenceVideo.current;
    return () => {
      mounted.current = false;
      attempt.current += 1;
      cancelAnimationFrame(autoplay);
      viral?.pause();
      reference?.pause();
      reducedMotion.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pause, play]);

  useEffect(() => {
    if (!playing) return;
    const sync = window.setInterval(() => {
      const viral = viralVideo.current;
      const reference = referenceVideo.current;
      if (!viral || !reference || viral.readyState < 2 || reference.readyState < 2) return;
      // Both supplied clips share the same motion; loop over their common duration.
      const duration = Math.min(viral.duration, reference.duration);
      if (Number.isFinite(duration) && viral.currentTime >= duration - 0.12) {
        viral.currentTime = 0;
        reference.currentTime = 0;
      } else if (Math.abs(viral.currentTime - reference.currentTime) > 0.16) {
        reference.currentTime = viral.currentTime;
      }
    }, 100);
    return () => window.clearInterval(sync);
  }, [playing]);

  const onMediaError = () => {
    pause();
    setMediaError(true);
    setMessage("One of the videos could not load. You can still compare the preview images.");
  };

  const moveDivider = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setPosition(Math.min(100, Math.max(0, (event.clientX - bounds.left) / bounds.width * 100)));
  };

  return <div className="motion-control-page">
    <TezuSiteHeader page="motion-control" />
    <main className="motion-control-main" id="motion-control">
      <header className="motion-control-heading">
        <h1>Motion control</h1>
        <p>One movement. A whole new character.<br />Drag to compare the reference and the viral result.</p>
      </header>

      <figure className="motion-comparison" aria-labelledby="motion-comparison-caption">
        <div className="motion-comparison-stage" style={{ "--comparison-position": `${position}%` } as CSSProperties}>
          <video ref={referenceVideo} className="motion-comparison-video" src={publicAsset("/sites/tezu/3d30b0c9-template-2.mp4")} poster={publicAsset("/sites/tezu/motion-control-result.jpg")} width={540} height={960} muted loop playsInline preload="metadata" aria-label="Motion reference: a person in a purple suit" onError={onMediaError} />
          <div className="motion-comparison-reveal">
            <video ref={viralVideo} className="motion-comparison-video" src={publicAsset("/sites/tezu/motion-control-reference.mp4")} poster={publicAsset("/sites/tezu/motion-control-reference.jpg")} width={720} height={1280} muted loop playsInline preload="metadata" aria-label="Viral result: an animated fairy following the reference motion" onError={onMediaError} />
          </div>
          <div className="motion-comparison-labels" aria-hidden="true"><span>Viral result</span><span>Motion reference</span></div>
          <span className="motion-comparison-divider" aria-hidden="true"><span className="motion-comparison-handle"><ChevronLeft size={19} strokeWidth={2.2} /><ChevronRight size={19} strokeWidth={2.2} /></span></span>
          <input className="motion-comparison-range" type="range" min={0} max={100} step={1} value={position} aria-label="Compare viral result and motion reference" aria-valuetext={`${Math.round(position)}% viral result, ${Math.round(100 - position)}% motion reference`} aria-describedby="motion-comparison-help" onChange={event => setPosition(Number(event.target.value))} onPointerDown={event => {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            moveDivider(event);
          }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveDivider(event); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
        </div>
        <figcaption id="motion-comparison-caption" className="motion-comparison-caption">
          <span className="motion-comparison-credit"><Heart size={15} aria-hidden="true" /><span><strong>450k likes</strong> on the viral clip</span></span>
          <button className="motion-playback" type="button" disabled={mediaError} onClick={() => { if (playing || pending) pause(); else void play(); }} aria-label={`${playing || pending ? "Pause" : "Play"} comparison`}>
            {playing || pending ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}<span>{pending ? "Loading…" : playing ? "Pause" : "Play comparison"}</span>
          </button>
        </figcaption>
        <p id="motion-comparison-help" className="motion-comparison-help">Drag the divider, or use the arrow keys to compare. Sound is off.</p>
        <p className="motion-playback-status" role="status">{message}</p>
      </figure>

      <a className="motion-control-cta" href={publicAsset("/#home")}>Create with Tezu<ArrowUpRight size={17} aria-hidden="true" /></a>
      <TezuFaq />
    </main>
  </div>;
}
