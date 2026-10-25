"use client";

import { useState } from "react";
import { ArrowLeft, ArrowUpRight, RotateCcw } from "lucide-react";
import { BalloonWordmark, balloonAnimations, type BalloonAnimation } from "./BalloonWordmark";
import { HomeHero } from "./HomeHero";
import "./intro-preview.css";

function AnimationCard({ index, replayAll, open }: { index: number; replayAll: number; open: (animation: BalloonAnimation) => void }) {
  const [replay, setReplay] = useState(0);
  const animation = balloonAnimations[index];
  return (
    <article className="intro-option" aria-labelledby={`intro-option-${animation.id}`}>
      <div className="intro-option-heading"><h2 id={`intro-option-${animation.id}`}><span>{index + 1}</span>{animation.name}</h2><span>{animation.duration}</span></div>
      <div className="intro-option-stage"><BalloonWordmark animation={animation.id} replay={`${replayAll}-${replay}`} /><p>Create beyond imagination.</p></div>
      <p className="intro-option-description">{animation.description}</p>
      <div className="intro-option-actions"><button type="button" onClick={() => setReplay(replay + 1)} aria-label={`Replay ${animation.name}`}><RotateCcw size={15} aria-hidden="true" />Replay</button><button type="button" onClick={() => open(animation.id)}>Preview homepage<ArrowUpRight size={15} aria-hidden="true" /></button></div>
    </article>
  );
}

export function IntroPreview() {
  const [view, setView] = useState<BalloonAnimation | "compare">("compare");
  const [replay, setReplay] = useState(0);
  function open(animation: BalloonAnimation) { setView(animation); setReplay(replay + 1); window.scrollTo({ top: 0, behavior: "instant" }); }
  return (
    <main className={`intro-preview ${view !== "compare" ? "intro-full-preview" : ""}`}>
      <div className="intro-preview-toolbar">
        <div>{view === "compare" ? <><h1>Give TEZU an entrance.</h1><p>Four takes on the original balloon letters. Replay, compare, pick your favourite.</p></> : <button className="intro-back" type="button" onClick={() => setView("compare")}><ArrowLeft size={16} aria-hidden="true" />Compare all four</button>}</div>
        <button className="intro-replay-all" type="button" onClick={() => setReplay(replay + 1)}><RotateCcw size={16} aria-hidden="true" />{view === "compare" ? "Replay all" : "Replay entrance"}</button>
      </div>
      {view === "compare" ? <div className="intro-options">{balloonAnimations.map((animation, index) => <AnimationCard key={animation.id} index={index} replayAll={replay} open={open} />)}</div> : <><div className="intro-switcher" role="group" aria-label="Animation options">{balloonAnimations.map((animation, index) => <button type="button" key={animation.id} aria-pressed={view === animation.id} onClick={() => open(animation.id)}>{index + 1}. {animation.name}</button>)}</div><HomeHero wordmarkAnimation={view} wordmarkReplay={replay} /></>}
      <p className="intro-preview-note">Each entrance plays once. Reduced motion shows the finished wordmark.</p>
    </main>
  );
}
