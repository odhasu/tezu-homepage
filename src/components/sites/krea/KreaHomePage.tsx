"use client";

import { useSyncExternalStore } from "react";
import { TezuHero } from "./TezuHero";
import { TezuResults } from "./TezuShowcase";
import { MediaGallery } from "./MediaGallery";
import { IntegrationBanner } from "./IntegrationBanner";
import { TezuSiteHeader } from "./TezuSiteHeader";
import { TezuMotionGalleries } from "./TezuMotionGalleries";
import { TezuFaq } from "./TezuFaq";
import { MotionControlFeature } from "./MotionComparison";
import "./text-motion.css";

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const getMotionPreference = () => window.matchMedia(motionQuery).matches;
const serverMotionPreference = () => false;

export function KreaHomePage() {
  const reducedMotion = useSyncExternalStore(subscribeMotion, getMotionPreference, serverMotionPreference);
  return <>
    <TezuSiteHeader />
    <main id="main-content" className="krea-home">
      <TezuHero reducedMotion={reducedMotion} />
      <MediaGallery reducedMotion={reducedMotion} />
      <IntegrationBanner />
      <TezuMotionGalleries reducedMotion={reducedMotion} />
      <MotionControlFeature />
      <TezuResults reducedMotion={reducedMotion} />
      <TezuFaq />
    </main>
  </>;
}
