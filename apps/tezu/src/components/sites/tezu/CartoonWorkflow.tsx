"use client";

import Image from "next/image";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, BookOpen, Check, Code2, ImageIcon, MessageCircle, Plug, Sparkles } from "lucide-react";
import { asset } from "./assets";
import "./cartoon-workflow.css";

gsap.registerPlugin(useGSAP);

const steps = [
  { title: "Connect MCP", description: "Bring TEZU into your favourite assistant. Your cartoon studio, one conversation away." },
  { title: "Add reference images", description: "Give your story a familiar face. Add your characters, scenes, and visual inspiration." },
  { title: "Story builder", description: "Chat through your idea. Build the plot, write the dialogue, and shape your story scene by scene." },
  { title: "Generate images & videos", description: "Turn your script into scenes, then bring them to life. Same character. A whole new story." },
];

function ConnectionPreview() {
  return (
    <div className="workflow-panel workflow-connect">
      <div className="workflow-panel-top"><span><Plug size={14} aria-hidden="true" />TEZU MCP</span><span className="workflow-soon">Coming soon</span></div>
      <div className="workflow-connection-diagram" aria-hidden="true">
        <div className="workflow-assistant-mark"><MessageCircle size={36} strokeWidth={1.5} /></div>
        <div className="workflow-connection-line"><span /><Plug size={19} /><span /></div>
        <div className="workflow-tezu-mark"><Image src={asset("tezu-white-knot-logo.png")} width={62} height={62} alt="" /></div>
      </div>
      <div className="workflow-connection-labels"><span>Your assistant</span><span>Your studio</span></div>
      <div className="workflow-assistants"><span><Sparkles size={14} aria-hidden="true" />Claude</span><span><MessageCircle size={14} aria-hidden="true" />ChatGPT</span><span><Code2 size={14} aria-hidden="true" />VS Code</span></div>
      <p>One connection.<br /><strong>So many stories.</strong></p>
    </div>
  );
}

function ReferencePreview() {
  return (
    <div className="workflow-panel workflow-references">
      <div className="workflow-panel-top"><span><ImageIcon size={14} aria-hidden="true" />Your reference board</span><span>3 references</span></div>
      <div className="workflow-reference-board">
        <figure className="workflow-character-sheet"><Image src={asset("boy.png")} fill sizes="(min-width: 1024px) 300px, (min-width: 640px) 35vw, 65vw" alt="Cartoon boy character sheet showing the same character from several angles" /><figcaption>Character</figcaption></figure>
        <div className="workflow-scene-references">
          <figure><Image src={asset("boy-scene.webp")} fill sizes="150px" alt="The character beside a red sports car on a neon city street" /><figcaption>The world</figcaption></figure>
          <figure><Image src={asset("tezu-07-poster.jpg")} fill sizes="150px" alt="The same character in the driver's seat" /><figcaption>The mood</figcaption></figure>
        </div>
      </div>
      <div className="workflow-reference-caption"><Check size={14} aria-hidden="true" />One character to build your story around.</div>
    </div>
  );
}

function StoryBuilderPreview() {
  return (
    <div className="workflow-panel workflow-script">
      <div className="workflow-panel-top"><span><BookOpen size={14} aria-hidden="true" />Story builder</span><span>3 scenes · 30 seconds</span></div>
      <div className="workflow-chat-prompt">Build a cartoon about my character finding a mysterious red car.</div>
      <div className="workflow-script-reply"><span className="workflow-reply-icon"><Sparkles size={15} aria-hidden="true" /></span><div><strong>Your story, scene by scene.</strong><p>Shape the hook, dialogue, and ending.</p></div></div>
      <ol className="workflow-story-beats">
        <li><span>01</span><div><strong>Set the scene</strong><p>An empty street. A red car. Keys inside.</p></div></li>
        <li><span>02</span><div><strong>Give him a voice</strong><p>“Just one lap around the block…”</p></div></li>
        <li><span>03</span><div><strong>Build the twist</strong><p>The car has a destination of its own.</p></div></li>
      </ol>
    </div>
  );
}

function GenerationPreview() {
  return (
    <div className="workflow-panel workflow-generate">
      <div className="workflow-panel-top"><span><Sparkles size={14} aria-hidden="true" />From still to story</span><span>Example result</span></div>
      <div className="workflow-generated-media">
        <figure><Image src={asset("boy-scene.webp")} fill sizes="(min-width: 1024px) 210px, 40vw" alt="Generated cartoon scene of the boy and his red sports car" /><figcaption><ImageIcon size={12} aria-hidden="true" />Image</figcaption></figure>
        <div className="workflow-result-video"><video src={asset("tezu-07-preview.mp4")} poster={asset("tezu-07-poster.jpg")} controls playsInline preload="none" aria-label="Play the example cartoon video of the character driving" /></div>
      </div>
      <div className="workflow-result-caption"><strong>Your idea, brought to life.</strong><span>Images → scenes → animation</span></div>
    </div>
  );
}

/** Desktop scroll scene; the default and mobile layout always exposes every step. */
export function CartoonWorkflow() {
  const root = useRef<HTMLElement>(null);

  useGSAP(() => {
    gsap.registerPlugin(ScrollTrigger);
    const section = root.current;
    const stage = section?.querySelector<HTMLElement>(".workflow-stage");
    const track = section?.querySelector<HTMLOListElement>(".workflow-track");
    const progress = section?.querySelector<HTMLElement>(".workflow-progress-fill");
    if (!section || !stage || !track) return;
    const media = gsap.matchMedia();
    let disposed = false;

    media.add("(min-width: 1024px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)", () => {
      section.classList.add("workflow-animated");
      const gutter = () => Math.max(48, window.innerWidth * .055);
      const startX = () => stage.clientWidth + 40;
      const endX = () => Math.min(0, stage.clientWidth - track.scrollWidth - gutter());
      const distance = () => startX() - endX();
      const sizeScene = () => { section.style.height = `${stage.clientHeight + distance() * 1.25}px`; };
      sizeScene();
      ScrollTrigger.addEventListener("refreshInit", sizeScene);

      const timeline = gsap.timeline({
        scrollTrigger: {
          id: "tezu-cartoon-workflow",
          trigger: section,
          start: () => `top ${getComputedStyle(section).getPropertyValue("--nav-h").trim()}`,
          end: "bottom bottom",
          scrub: .65,
          invalidateOnRefresh: true,
          onUpdate: self => { if (progress) gsap.set(progress, { scaleX: self.progress }); },
        },
      });
      timeline.fromTo(track, { x: startX }, { x: endX, duration: 1, ease: "none" }, .08);
      timeline.to(".workflow-backdrop", { opacity: .28, duration: .25, ease: "none" }, .08);
      timeline.to({}, { duration: .08 });

      // Bring the last card into view when its native video controls receive keyboard focus.
      const revealVideo = (event: FocusEvent) => {
        if (!(event.target instanceof HTMLElement) || !event.target.closest(".workflow-result-video")) return;
        stage.scrollLeft = 0;
        const trigger = timeline.scrollTrigger;
        if (!trigger) return;
        const bounds = event.target.getBoundingClientRect();
        if (bounds.left < 0 || bounds.right > stage.clientWidth) {
          trigger.scroll(trigger.end);
          timeline.totalProgress(1);
        }
      };
      track.addEventListener("focusin", revealVideo);

      return () => {
        track.removeEventListener("focusin", revealVideo);
        ScrollTrigger.removeEventListener("refreshInit", sizeScene);
        section.classList.remove("workflow-animated");
        section.style.removeProperty("height");
      };
    });

    void document.fonts.ready.then(() => { if (!disposed) ScrollTrigger.refresh(); });
    return () => { disposed = true; media.revert(); };
  }, { scope: root });

  const previews = [<ConnectionPreview key="connect" />, <ReferencePreview key="references" />, <StoryBuilderPreview key="story" />, <GenerationPreview key="generate" />];

  return (
    <section className="cartoon-workflow" id="mcp" ref={root} aria-labelledby="workflow-heading">
      <div className="workflow-stage">
        <div className="workflow-topline"><span>From your first idea to the final scene.</span><a href="#characters">Skip walkthrough<ArrowDown size={14} aria-hidden="true" /></a></div>
        <h2 className="workflow-backdrop" id="workflow-heading">How to create<br />cartoon animations.</h2>
        <ol className="workflow-track">
          {steps.map((step, index) => (
            <li className={`workflow-step workflow-step-${index + 1}`} key={step.title}>
              <div className="workflow-step-copy"><h3><span>{index + 1}.</span> {step.title}</h3><p>{step.description}</p></div>
              {previews[index]}
            </li>
          ))}
        </ol>
        <div className="workflow-bottomline"><span>Scroll to follow the story<ArrowDown size={13} aria-hidden="true" /></span><div className="workflow-progress" aria-hidden="true"><span className="workflow-progress-fill" /></div><span>4 steps. Endless possibilities.</span></div>
        <p className="workflow-preview-note">A preview of the creative workflow. TEZU MCP is coming soon.</p>
      </div>
    </section>
  );
}
