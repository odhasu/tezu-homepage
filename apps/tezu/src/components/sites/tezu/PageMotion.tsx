"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import "./motion.css";

/** Reveal once with native scrolling; content stays readable without JavaScript. */
export function PageMotion() {
  const pathname = usePathname();

  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (!anchor) return;
    let cancelled = false;
    let frame = 0;
    // Position deep links after fonts and scroll scenes establish the page height.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = requestAnimationFrame(() => {
        document.getElementById(anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [pathname]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const reveal = (element: HTMLElement) => { element.dataset.revealState = "visible"; };
    if (preference.matches) {
      targets.forEach(reveal);
      return;
    }
    const onIntersect: IntersectionObserverCallback = (entries, observer) => {
      for (const entry of entries) {
        const requiredRatio = entry.target.hasAttribute("data-pricing-reveal") ? .25 : .12;
        if (!entry.isIntersecting || entry.intersectionRatio < requiredRatio) continue;
        reveal(entry.target as HTMLElement);
        observer.unobserve(entry.target);
      }
    };
    const observer = new IntersectionObserver(onIntersect, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });
    const pricingObserver = new IntersectionObserver(onIntersect, { threshold: 0.25 });

    for (const element of targets) {
      const bounds = element.getBoundingClientRect();
      // Reveal restored scroll positions immediately; don't hide content above the viewport.
      if (bounds.top < 0) reveal(element);
      else {
        element.dataset.revealState = "pending";
        (element.hasAttribute("data-pricing-reveal") ? pricingObserver : observer).observe(element);
      }
    }
    const reduce = () => { if (preference.matches) { observer.disconnect(); pricingObserver.disconnect(); targets.forEach(reveal); } };
    preference.addEventListener("change", reduce);
    return () => { observer.disconnect(); pricingObserver.disconnect(); preference.removeEventListener("change", reduce); };
  }, [pathname]);

  return null;
}
