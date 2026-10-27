"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight, Heart, Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { publicAsset } from "./asset-urls";
import "./motion-control.css";

export function MotionComparison({ large = false }: { large?: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const viralVideo = useRef<HTMLVideoElement>(null);
  const referenceVideo = useRef<HTMLVideoElement>(null);
  const controls = useRef({ toggle: () => {}, fail: () => {} });
  const id = useId();
  const [position, setPosition] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    const region = stage.current;
    const viral = viralVideo.current;
    const reference = referenceVideo.current;
    if (!region || !viral || !reference) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let disposed = false;
    let intent: "auto" | "play" | "pause" = "auto";
    let running = false;
    let starting = false;
    let failed = false;
    let request = 0;
    let sync: ReturnType<typeof setInterval> | undefined;

    const eligible = () => visible && !document.hidden && !document.querySelector("dialog[open]") && !failed && intent !== "pause" && (!motion.matches || intent === "play");
    const stop = () => {
      request++;
      viral.pause();
      reference.pause();
      running = starting = false;
      clearInterval(sync);
      sync = undefined;
      if (!disposed) { setPlaying(false); setPending(false); }
    };
    const synchronize = () => {
      if (viral.readyState < 2 || reference.readyState < 2) return;
      const duration = Math.min(viral.duration, reference.duration);
      // Both supplied clips share the same motion; loop over their common duration.
      if (Number.isFinite(duration) && viral.currentTime >= duration - .12) {
        viral.currentTime = reference.currentTime = 0;
      } else if (Math.abs(viral.currentTime - reference.currentTime) > .16) reference.currentTime = viral.currentTime;
    };
    const update = () => {
      if (disposed) return;
      if (!eligible()) { if (running || starting) stop(); return; }
      if (running || starting) return;
      // Sources are assigned only when the comparison can actually play.
      if (!viral.getAttribute("src")) {
        viral.src = publicAsset("/sites/tezu/motion-control-reference.mp4");
        reference.src = publicAsset("/sites/tezu/3d30b0c9-template-2.mp4");
      }
      if (reference.readyState >= 1) reference.currentTime = Math.min(viral.currentTime, reference.duration || 0);
      starting = true;
      const attempt = ++request;
      setPending(true);
      setMessage("");
      void Promise.all([viral.play(), reference.play()]).then(() => {
        if (disposed || attempt !== request) {
          if (disposed || !eligible()) { viral.pause(); reference.pause(); }
          return;
        }
        if (!eligible()) { stop(); return; }
        running = true;
        starting = false;
        setPending(false);
        setPlaying(true);
        sync = setInterval(synchronize, 100);
      }).catch(() => {
        if (disposed || attempt !== request) return;
        intent = "pause";
        stop();
        setMessage("Playback is paused. Press Play comparison to start both videos.");
      });
    };
    controls.current = {
      toggle: () => {
        if (running || starting) { intent = "pause"; stop(); }
        else { intent = "play"; update(); }
      },
      fail: () => {
        failed = true;
        stop();
        setMediaError(true);
        setMessage("One of the videos could not load. You can still compare the preview images.");
      },
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .1 });
    observer.observe(region);
    const onMotionChange = () => { if (motion.matches) intent = "pause"; update(); };
    // Dialogs include signup and the full-media previews elsewhere on the page.
    const modals = new MutationObserver(update);
    modals.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    document.addEventListener("visibilitychange", update);
    motion.addEventListener("change", onMotionChange);
    return () => {
      disposed = true;
      stop();
      observer.disconnect();
      modals.disconnect();
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", onMotionChange);
      controls.current = { toggle: () => {}, fail: () => {} };
    };
  }, []);

  const moveDivider = (event: PointerEvent<HTMLInputElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setPosition(Math.min(100, Math.max(0, (event.clientX - bounds.left) / bounds.width * 100)));
  };

  return <figure className={`motion-comparison${large ? " motion-comparison-large" : ""}`} aria-labelledby={`${id}-caption`}>
    <div ref={stage} className="motion-comparison-stage" style={{ "--comparison-position": `${position}%` } as CSSProperties}>
      <video ref={referenceVideo} className="motion-comparison-video" poster={publicAsset("/sites/tezu/motion-control-result.jpg")} width={540} height={960} muted loop playsInline preload="none" aria-label="Motion reference: a person in a purple suit" onError={() => controls.current.fail()} />
      <div className="motion-comparison-reveal">
        <video ref={viralVideo} className="motion-comparison-video" poster={publicAsset("/sites/tezu/motion-control-reference.jpg")} width={720} height={1280} muted loop playsInline preload="none" aria-label="Viral result: an animated fairy following the reference motion" onError={() => controls.current.fail()} />
      </div>
      <div className="motion-comparison-labels" aria-hidden="true"><span>Viral result</span><span>Motion reference</span></div>
      <span className="motion-comparison-divider" aria-hidden="true"><span className="motion-comparison-handle"><ChevronLeft size={19} strokeWidth={2.2} /><ChevronRight size={19} strokeWidth={2.2} /></span></span>
      <input className="motion-comparison-range" type="range" min={0} max={100} step={1} value={position} aria-label="Compare viral result and motion reference" aria-valuetext={`${Math.round(position)}% viral result, ${Math.round(100 - position)}% motion reference`} aria-describedby={`${id}-help`} onChange={event => setPosition(Number(event.target.value))} onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        moveDivider(event);
      }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveDivider(event); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    </div>
    <figcaption id={`${id}-caption`} className="motion-comparison-caption">
      <span className="motion-comparison-credit"><Heart size={15} aria-hidden="true" /><span><strong>450k likes</strong> on the viral clip</span></span>
      <button className="motion-playback" type="button" disabled={mediaError} onClick={() => controls.current.toggle()} aria-label={`${playing || pending ? "Pause" : "Play"} comparison`}>
        {playing || pending ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}<span>{pending ? "Loading…" : playing ? "Pause" : "Play comparison"}</span>
      </button>
    </figcaption>
    <p id={`${id}-help`} className="motion-comparison-help">Drag the divider, or use the arrow keys to compare. Sound is off.</p>
    <p className="motion-playback-status" role="status">{message}</p>
  </figure>;
}

export function MotionControlFeature() {
  return <section className="motion-control-feature" aria-labelledby="motion-feature-heading" id="motion-control-feature">
    <div className="motion-control-feature-heading">
      <div><h2 id="motion-feature-heading">Motion control</h2><p>One movement. A whole new character. Drag to compare the reference and the viral result.</p></div>
      <a href={publicAsset("/motion-control/")}>Explore motion control<ArrowUpRight size={17} aria-hidden="true" /></a>
    </div>
    <MotionComparison large />
  </section>;
}
