"use client";

/* eslint-disable @next/next/no-img-element -- Brand SVGs are small local assets. */

import { Bot, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { publicAsset } from "./assets";
import { tezuAppHome } from "./app-links";
import "./integration-banner.css";

const platforms = [
  { id: "chatgpt", name: "ChatGPT", heading: "ChatGPT" },
  { id: "claude", name: "Claude App", heading: "Claude App" },
  { id: "other", name: "Other", heading: "your assistant" },
] as const;
type Platform = (typeof platforms)[number];
type PlatformId = Platform["id"];
const assetPath = publicAsset("/sites/tezu/integrations/");

function PlatformLogo({ id }: { id: PlatformId }) {
  if (id === "other") return <Bot aria-hidden="true" strokeWidth={1.65} />;
  return <img src={`${assetPath}${id}.svg`} width={28} height={28} alt="" draggable={false} />;
}

function AssistantMcpBanner({ platform, onConnect }: { platform: "chatgpt" | "claude"; onConnect: () => void }) {
  const isClaude = platform === "claude";
  const name = isClaude ? "Claude" : "ChatGPT";
  return <div className={`chatgpt-mcp${isClaude ? " claude-mcp" : ""}`} data-platform={platform}>
    <div className="chatgpt-mcp-rays" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
    </div>
    <div className="chatgpt-mcp-heading">
      <span className="mcp-brand-icon" aria-hidden="true">
        {isClaude ? <span className="claude-mcp-brand"><PlatformLogo id="claude" /></span>
          : <img src={publicAsset("/sites/krea/chatgpt-mcp-icon.webp")} width={48} height={48} alt="" />}
        <span className="mcp-brand-shine" />
      </span>
      <h2>Get Tezu into {name}</h2>
    </div>
    <div className="chatgpt-mcp-stage">
      <div className="chatgpt-mcp-details">
        <p>Get the world&apos;s best image, video, and upscaling<br className="chatgpt-mcp-break" /> models in {name} in 3 simple steps.</p>
        <button type="button" onClick={onConnect}>
          <PlatformLogo id={platform} /><span>Add to {name}</span>
        </button>
      </div>
      <img className="chatgpt-mcp-preview"
        src={publicAsset(isClaude ? "/sites/tezu/integrations/claude-mcp-ui.webp" : "/sites/krea/chatgpt-mcp-ui.webp")}
        width={isClaude ? 1430 : 3422} height={isClaude ? 476 : 1151}
        alt={isClaude ? "Claude settings preview showing the Tezu plugin" : "Studio preview from the original ChatGPT MCP banner"} loading="lazy" />
    </div>
  </div>;
}

function OtherMcpBanner({ onConnect }: { onConnect: () => void }) {
  return <div className="chatgpt-mcp other-mcp" data-platform="other">
    <div className="chatgpt-mcp-rays" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
    </div>
    <div className="chatgpt-mcp-heading">
      <span className="mcp-brand-icon" aria-hidden="true">
        <span className="other-mcp-brand"><PlatformLogo id="other" /></span>
        <span className="mcp-brand-shine" />
      </span>
      <h2>Get Tezu into your assistant</h2>
    </div>
    <div className="chatgpt-mcp-stage">
      <div className="chatgpt-mcp-details">
        <p>More ways to work with Tezu are on the way.<br className="chatgpt-mcp-break" /> Assistant connections are coming soon.</p>
        <button type="button" onClick={onConnect} aria-haspopup="dialog"><PlatformLogo id="other" /><span>Connect</span></button>
      </div>
    </div>
  </div>;
}

export function IntegrationBanner() {
  const [active, setActive] = useState<PlatformId>("chatgpt");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const guide = useRef<HTMLDialogElement>(null);
  const platform = platforms.find((item) => item.id === active)!;

  function select(index: number, focus = false) {
    setActive(platforms[index].id);
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

  return <section id="mcp" className="integration-section" aria-label="Create with Tezu in your apps">
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
      {active === item.id && (active === "other" ? <OtherMcpBanner onConnect={() => guide.current?.showModal()} /> : <AssistantMcpBanner platform={active} onConnect={() => guide.current?.showModal()} />)}
    </div>)}
    <dialog ref={guide} className="integration-guide" aria-labelledby="integration-guide-title" onClick={(event) => { if (event.target === event.currentTarget) guide.current?.close(); }}>
      <button type="button" className="integration-guide-close" aria-label="Close connection guide" onClick={() => guide.current?.close()}><X size={22} /></button>
      <div className="integration-guide-icon"><PlatformLogo id={active} /></div>
      <h2 id="integration-guide-title">Tezu in {platform.heading}</h2>
      <p>Tezu&apos;s assistant connections are coming soon. This preview does not connect an assistant. Check back for setup instructions.</p>
      <a href={tezuAppHome}>Explore the studio preview</a>
    </dialog>
  </section>;
}
