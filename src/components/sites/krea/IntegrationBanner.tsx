"use client";

/* eslint-disable @next/next/no-img-element -- Brand SVGs are small local assets. */

import { Bot, Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { publicAsset } from "./assets";
import "./integration-banner.css";

const platforms = [
  { id: "chatgpt", name: "ChatGPT", heading: "ChatGPT", action: "Add Tezu in ChatGPT", mode: "app" },
  { id: "claude", name: "Claude App", heading: "Claude App", action: "Connect Tezu", mode: "app" },
  { id: "claude-code", name: "Claude Code", heading: "Claude Code", action: "Connect Tezu", mode: "code" },
  { id: "other", name: "Other", heading: "your assistant", action: "Connect Tezu", mode: "app" },
] as const;
type Platform = (typeof platforms)[number];
type PlatformId = Platform["id"];
const assetPath = publicAsset("/sites/tezu/integrations/");

function PlatformLogo({ id }: { id: PlatformId }) {
  if (id === "other") return <Bot aria-hidden="true" strokeWidth={1.65} />;
  return <img src={`${assetPath}${id}.svg`} width={28} height={28} alt="" draggable={false} />;
}

function setupRequest(platform: Platform) {
  return `Help me set up Tezu in ${platform.heading} so I can create images and videos from here.\n\n1. Check the official Tezu connection instructions at https://tezu.ai/.\n2. When the ${platform.name} connection is available, walk me through the official setup and sign-in.\n3. Help me create my first image or cartoon video with Tezu.`;
}

const pattern = Array.from({ length: 17 }, (_, row) => Array.from({ length: 60 }, (_, column) => {
  const characters = ["1", "0", "/", "+", " ", "/", "1", " "];
  return characters[(row * 11 + column * 7 + Math.floor(column / 3)) % characters.length];
}).join("   ")).join("\n");

function ChatGptMcpBanner({ onConnect }: { onConnect: () => void }) {
  return <div className="chatgpt-mcp" data-platform="chatgpt">
    <div className="chatgpt-mcp-rays" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
    </div>
    <div className="chatgpt-mcp-heading">
      <img src={publicAsset("/sites/krea/chatgpt-mcp-icon.webp")} width={48} height={48} alt="" />
      <h2>Get Tezu into ChatGPT</h2>
    </div>
    <div className="chatgpt-mcp-stage">
      <div className="chatgpt-mcp-details">
        <p>Get the world&apos;s best image, video, and upscaling<br className="chatgpt-mcp-break" /> models in ChatGPT in 3 simple steps.</p>
        <button type="button" onClick={onConnect}>
          <PlatformLogo id="chatgpt" /><span>Add to ChatGPT</span>
        </button>
      </div>
      <img className="chatgpt-mcp-preview" src={publicAsset("/sites/krea/chatgpt-mcp-ui.webp")} width={3422} height={1151}
        alt="Studio preview from the original ChatGPT MCP banner" loading="lazy" />
    </div>
  </div>;
}

export function IntegrationBanner() {
  const [active, setActive] = useState<PlatformId>("chatgpt");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const guide = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const platform = platforms.find((item) => item.id === active)!;
  const codeMode = platform.mode === "code";

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function select(index: number, focus = false) {
    setActive(platforms[index].id);
    setCopied(false);
    setCopyFailed(false);
    if (timer.current) clearTimeout(timer.current);
    if (focus) {
      tabs.current[index]?.focus({ preventScroll: true });
      tabs.current[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % platforms.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + platforms.length) % platforms.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = platforms.length - 1;
    else return;
    event.preventDefault();
    select(next, true);
  }

  async function copySetup() {
    try {
      await navigator.clipboard.writeText(setupRequest(platform));
      setCopied(true);
      setCopyFailed(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailed(true);
    }
  }

  return <section className="integration-section" aria-label="Create with Tezu in your apps">
    <div className="integration-tabs" role="tablist" aria-label="Choose your app">
      {platforms.map((item, index) => <button type="button" role="tab" key={item.id}
        ref={(element) => { tabs.current[index] = element; }}
        id={`integration-tab-${item.id}`} aria-controls={`integration-panel-${item.id}`}
        aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1}
        onClick={() => select(index)} onKeyDown={(event) => navigate(event, index)}>
        <PlatformLogo id={item.id} /><span>{item.name}</span>
      </button>)}
    </div>
    {platforms.map((item) => <div role="tabpanel" key={item.id} id={`integration-panel-${item.id}`}
      aria-labelledby={`integration-tab-${item.id}`} hidden={active !== item.id} tabIndex={0}>
      {active === item.id && (active === "chatgpt" ? <ChatGptMcpBanner onConnect={() => guide.current?.showModal()} /> : <div className="integration-panel" data-platform={active}>
        <pre className="integration-pattern" aria-hidden="true">{pattern}</pre>
        <div className="integration-content" key={active}>
          <h2 className="integration-heading">
            <span className="integration-heading-line">Generate <strong>images &amp; videos</strong></span>
            <span className="integration-heading-line integration-platform-line">
              <span>in</span><span className={`integration-app-icon integration-app-icon-${active}`}><PlatformLogo id={active} /></span>
              <span>{platform.heading}</span><span className="integration-brand"><span>with</span><span className="integration-tezu-icon" aria-hidden="true" /><span>Tezu</span></span>
            </span>
          </h2>
          {codeMode ? <div className="integration-code-card">
            <div className="integration-code-header"><h3>{active === "claude-code" ? "Copy and send this to Claude Code" : "Start with your Tezu setup request"}</h3>
              <button type="button" className="integration-copy" onClick={copySetup}>{copied ? <Check size={18} /> : <Copy size={18} />}<span>{copied ? "Copied" : "Copy"}</span></button>
            </div>
            <pre className="integration-code">{setupRequest(platform)}</pre>
            <p className="integration-copy-status" role="status">{copyFailed ? "Copy unavailable. Select and copy the text above." : copied ? "Setup request copied." : ""}</p>
          </div> : <div className="integration-actions">
            <button type="button" className={`integration-connect integration-connect-${active}`} onClick={() => guide.current?.showModal()}>
              <PlatformLogo id={active} /><span>{platform.action}</span>
            </button>
            <button type="button" className="integration-how" onClick={() => guide.current?.showModal()}>How to connect?</button>
          </div>}
        </div>
      </div>)}
    </div>)}
    <dialog ref={guide} className="integration-guide" aria-labelledby="integration-guide-title" onClick={(event) => { if (event.target === event.currentTarget) guide.current?.close(); }}>
      <button type="button" className="integration-guide-close" aria-label="Close connection guide" onClick={() => guide.current?.close()}><X size={22} /></button>
      <div className="integration-guide-icon"><PlatformLogo id={active} /></div>
      <h2 id="integration-guide-title">Tezu in {platform.heading}</h2>
      <p>Tezu&apos;s assistant connections are coming soon. Create images and videos in the Tezu studio today, and check back for connection instructions.</p>
      <a href="https://tezu.ai/" target="_blank" rel="noreferrer">Open Tezu studio</a>
    </dialog>
  </section>;
}
