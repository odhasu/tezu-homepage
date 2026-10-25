"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, Check, Code2, ImageIcon, MessageCircle, Play, Sparkles } from "lucide-react";
import { asset } from "./assets";
import "./mcp-showcase.css";

const assistants = [
  {
    id: "claude",
    name: "Claude",
    icon: Sparkles,
    caption: "Your ideas, in conversation with Claude.",
    prompt: "Create a cinematic city scene with my character. Then bring it to life.",
    reply: "A little neon. A little main-character energy. Here's the scene, and its next move.",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    icon: MessageCircle,
    caption: "From a thought in ChatGPT to something you can see.",
    prompt: "Take my character into a neon-lit city. Give me an image and a video concept.",
    reply: "Let's set the scene: rain-soaked streets, city lights, and your character at the centre.",
  },
  {
    id: "vscode",
    name: "VS Code",
    icon: Code2,
    caption: "A creative studio, right beside your next build.",
    prompt: "I need a character-led city scene for my project. Show me a still and a video concept.",
    reply: "Here's a visual direction for your project. The same character, from the street to the driver's seat.",
  },
] as const;

const steps = [
  { title: "Choose your assistant", description: "Start where your ideas already happen." },
  { title: "Connect TEZU", description: "One connection to your creative studio.", soon: true },
  { title: "Create in conversation", description: "Describe it. Refine it. Make it yours." },
];

export function McpShowcase() {
  const [activeAssistant, setActiveAssistant] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % assistants.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + assistants.length) % assistants.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = assistants.length - 1;
    else return;
    event.preventDefault();
    setActiveAssistant(nextIndex);
    tabs.current[nextIndex]?.focus();
  }

  return (
    <section className="mcp-showcase" id="mcp" aria-labelledby="mcp-heading">
      <div className="mcp-inner">
        <div className="mcp-main">
          <div className="mcp-intro" data-reveal>
            <div className="mcp-eyebrow-row">
              <span className="eyebrow">TEZU MCP</span>
              <span className="mcp-soon"><span aria-hidden="true" />Coming soon</span>
            </div>
            <h2 id="mcp-heading">Your studio.<br />Inside your <span>conversation.</span></h2>
            <p className="mcp-description">Meet your next creative shortcut. Bring TEZU&apos;s image and video tools into the assistants you already love. Just say what you see.</p>

            <div className="mcp-tabs" role="tablist" aria-label="Preview TEZU with your assistant">
              {assistants.map((assistant, index) => {
                const Icon = assistant.icon;
                return (
                  <button
                    type="button"
                    role="tab"
                    id={`mcp-tab-${assistant.id}`}
                    key={assistant.id}
                    ref={element => { tabs.current[index] = element; }}
                    aria-selected={activeAssistant === index}
                    aria-controls={`mcp-panel-${assistant.id}`}
                    tabIndex={activeAssistant === index ? 0 : -1}
                    onClick={() => setActiveAssistant(index)}
                    onKeyDown={event => handleTabKey(event, index)}
                  >
                    <Icon size={16} aria-hidden="true" />{assistant.name}
                  </button>
                );
              })}
            </div>
            <div className="mcp-actions">
              <button className="mcp-connection-button" type="button" disabled>Coming soon <ArrowRight size={16} aria-hidden="true" /></button>
              <a href="#tools">Explore the studio <ArrowRight size={15} aria-hidden="true" /></a>
            </div>
          </div>

          <div className="mcp-demo-wrap" data-reveal>
            {assistants.map((assistant, index) => {
              const Icon = assistant.icon;
              return (
                <div
                  className="mcp-demo"
                  role="tabpanel"
                  id={`mcp-panel-${assistant.id}`}
                  aria-labelledby={`mcp-tab-${assistant.id}`}
                  key={assistant.id}
                  hidden={activeAssistant !== index}
                  tabIndex={0}
                >
                  <div className="mcp-demo-topbar"><span><Icon size={16} aria-hidden="true" />{assistant.name}<span className="mcp-topbar-divider" />TEZU</span><span className="mcp-preview-label">Concept preview</span></div>
                  <div className="mcp-conversation">
                    <p className="mcp-demo-caption">{assistant.caption}</p>
                    <div className="mcp-user-message">{assistant.prompt}</div>
                    <div className="mcp-response">
                      <div className="mcp-response-brand"><Image src={asset("tezu-white-knot-logo.png")} alt="" width={24} height={24} /><span>TEZU</span><span className="mcp-response-tag">Creative tools</span></div>
                      <p>{assistant.reply}</p>
                      <div className="mcp-tool-status"><Check size={12} aria-hidden="true" />Example creative direction</div>
                      <div className="mcp-results">
                        <figure>
                          <Image src={asset("boy-scene.webp")} alt="TEZU character beside a red sports car on a neon-lit city street" width={768} height={1376} sizes="(min-width: 900px) 250px, 42vw" />
                          <figcaption><ImageIcon size={13} aria-hidden="true" /><span>The scene</span><span>IMAGE</span></figcaption>
                        </figure>
                        <figure>
                          <Image src={asset("tezu-07-poster.jpg")} alt="The same TEZU character driving the sports car" width={720} height={1280} sizes="(min-width: 900px) 250px, 42vw" />
                          <span className="mcp-result-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
                          <figcaption><Play size={12} aria-hidden="true" /><span>The next move</span><span>VIDEO</span></figcaption>
                        </figure>
                      </div>
                    </div>
                  </div>
                  <div className="mcp-demo-footer"><span aria-hidden="true" />Visual preview · TEZU MCP is coming soon</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mcp-how" data-reveal>
          <div className="mcp-how-heading"><h3>A new way to connect.</h3><p>Less switching. More making.</p></div>
          <ol className="mcp-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="mcp-step-number">0{index + 1}</span>
                <div><h4>{step.title}{step.soon && <span>Coming soon</span>}</h4><p>{step.description}</p></div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
