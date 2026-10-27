"use client";

import { ArrowUpRight } from "lucide-react";
import { publicAsset } from "./asset-urls";
import { MotionComparison } from "./MotionComparison";
import { TezuSiteHeader } from "./TezuSiteHeader";
import { TezuFaq } from "./TezuFaq";
import "./motion-control.css";

export function MotionControlPage() {
  return <div className="motion-control-page">
    <TezuSiteHeader page="motion-control" />
    <main className="motion-control-main" id="motion-control">
      <header className="motion-control-heading">
        <h1>Motion control</h1>
        <p>One movement. A whole new character.<br />Drag to compare the reference and the viral result.</p>
      </header>
      <MotionComparison />
      <a className="motion-control-cta" href={publicAsset("/#home")}>Create with Tezu<ArrowUpRight size={17} aria-hidden="true" /></a>
      <TezuFaq />
    </main>
  </div>;
}
