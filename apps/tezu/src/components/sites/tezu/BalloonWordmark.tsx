/* eslint-disable @next/next/no-img-element */
import { asset } from "./assets";
import "./balloon-wordmark.css";

export type BalloonAnimation = "soft-spin" | "float-up" | "turn" | "inflate";

export const balloonAnimations: { id: BalloonAnimation; name: string; description: string; duration: string }[] = [
  { id: "soft-spin", name: "Soft spin", description: "A slow twist, fading up into place.", duration: "1.8 seconds" },
  { id: "float-up", name: "Balloon lift", description: "Each letter floats up with its own little wobble.", duration: "2.3 seconds" },
  { id: "turn", name: "3D turn", description: "The wordmark turns toward you, then settles.", duration: "2 seconds" },
  { id: "inflate", name: "Inflate & bounce", description: "The letters swell into shape with a soft bounce.", duration: "1.8 seconds" },
];

export function BalloonWordmark({ animation, replay = 0 }: { animation?: BalloonAnimation; replay?: number | string }) {
  const src = asset("tezu-wordmark-3d-liquid-Soy1GVc8.webp");
  return (
    <div className={`balloon-wordmark ${animation ? `balloon-${animation}` : "balloon-still"}`} role="img" aria-label="TEZU balloon lettering">
      <div className="balloon-sequence" key={`${animation}-${replay}`} aria-hidden="true">
        {animation === "float-up" ? ["t", "e", "z", "u"].map(letter => (
          <span key={letter} className={`balloon-letter balloon-letter-${letter}`}><img src={src} width={1100} height={291} alt="" fetchPriority="high" draggable={false} /></span>
        )) : <img className="balloon-whole" src={src} width={1100} height={291} alt="" fetchPriority="high" draggable={false} />}
      </div>
    </div>
  );
}
