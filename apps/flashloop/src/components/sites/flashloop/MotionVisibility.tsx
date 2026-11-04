"use client";
import { useEffect } from "react";

export function MotionVisibility() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".home-hero");
    let visible = true;
    function update() {
      document.documentElement.dataset.paused = String(document.hidden);
      hero?.style.setProperty(
        "--hero-play-state",
        visible && !document.hidden ? "running" : "paused",
      );
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    if (hero) observer.observe(hero);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      delete document.documentElement.dataset.paused;
    };
  }, []);
  return null;
}
