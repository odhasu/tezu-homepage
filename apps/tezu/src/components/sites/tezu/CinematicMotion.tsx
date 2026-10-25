"use client";

import { type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP);

export function useCinematicMotion(scope: RefObject<HTMLElement | null>, paused: boolean) {
  useGSAP(() => {
    gsap.registerPlugin(ScrollTrigger);
    if (paused) return;
    const media = gsap.matchMedia();
    let disposed = false;

    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(".story-scene", { y: -32, ease: "none", scrollTrigger: { trigger: ".home-stage", start: "top top", end: "bottom top", scrub: .8 } });
      gsap.to(".story-action", { y: 28, ease: "none", scrollTrigger: { trigger: ".home-stage", start: "top top", end: "bottom top", scrub: .8 } });
      gsap.from(".engine-workspace", { y: 48, opacity: .55, duration: .9, ease: "power2.out", scrollTrigger: { trigger: ".engine-workspace", start: "top 90%", once: true } });
      gsap.from(".hire-copy", { x: -35, opacity: .4, duration: .9, ease: "power2.out", scrollTrigger: { trigger: ".hire-cinema", start: "top 75%", once: true } });
      gsap.to(".hire-tv", { y: -32, ease: "none", scrollTrigger: { trigger: ".hire-cinema", start: "top bottom", end: "bottom top", scrub: 1 } });
      gsap.from(".template-gallery .gallery-heading", { y: 32, opacity: .5, duration: .8, ease: "power2.out", scrollTrigger: { trigger: ".template-gallery", start: "top 85%", once: true } });
    });

    media.add("(min-width: 1024px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)", () => {
      const root = scope.current;
      const stage = root?.querySelector<HTMLElement>(".film-stage");
      const viewport = root?.querySelector<HTMLElement>(".film-viewport");
      const track = root?.querySelector<HTMLElement>(".film-track");
      const progress = root?.querySelector<HTMLElement>(".film-progress>span");
      if (!stage || !track || !viewport) return;
      const distance = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
      if (!distance()) return;
      gsap.set(viewport, { overflowX: "clip" });
      gsap.to(track, {
        x: () => -distance(),
        ease: "none",
        scrollTrigger: {
          id: "tezu-film-gallery",
          trigger: stage,
          start: "top 96px",
          end: () => "+=" + Math.min(distance(), 1900),
          pin: true,
          scrub: .8,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: self => { if (progress) gsap.set(progress, { scaleX: self.progress }); },
        },
      });
    });

    void document.fonts.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    return () => { disposed = true; media.revert(); };
  }, { scope, dependencies: [paused], revertOnUpdate: true });
}
