"use client";

/* eslint-disable @next/next/no-img-element -- Supplied transparent logo is served from local assets. */

import { Bot, Clapperboard, ImagePlay, MessageCircle, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader, type SiteHeaderItem } from "./SiteHeader";
import { publicAsset, tezuMedia } from "./assets";
import styles from "./SiteHeader.module.css";
import { tezuAppHome as appHome } from "./app-links";

const iconProps = { size: 18, strokeWidth: 1.5, "aria-hidden": true } as const;
const artwork = tezuMedia.find(item => item.id === "tezu-07-preview");
function navigationItems(page: "home" | "motion-control"): SiteHeaderItem[] {
  const section = (id: string) => page === "home" ? `#${id}` : `${publicAsset("/")}#${id}`;
  const integration = (platform: string) => page === "home" ? "#mcp" : `${publicAsset("/")}?integration=${platform}#mcp`;
  return [
    { value: "home", label: "Home", href: section("home") },
    {
      value: "create", label: "Create",
      links: [
        { label: "Cartoon Maker", description: "Bring your stories to life", icon: <Clapperboard {...iconProps} />, href: `${appHome}#mcp` },
        { label: "Character Swap", description: "Make every character your own", icon: <Users {...iconProps} />, href: `${appHome}templates/` },
        { label: "Video studio", description: "Turn an idea into a video", icon: <ImagePlay {...iconProps} />, href: `${appHome}create/video/` },
        { label: "Explore tools", description: "Find your next creative starting point", icon: <Sparkles {...iconProps} />, href: section("create") },
      ],
      feature: {
        title: "Made with Tezu", description: "A little inspiration for your next idea.", href: section("character-swap"),
        image: artwork ? { src: artwork.poster, alt: "A cartoon created with Tezu" } : undefined,
      },
    },
    {
      value: "mcp", label: "MCP",
      links: [
        { label: "ChatGPT", description: "Create with Tezu in ChatGPT", icon: <MessageCircle {...iconProps} />, href: integration("chatgpt") },
        { label: "Claude", description: "Create with Tezu in Claude", icon: <Sparkles {...iconProps} />, href: integration("claude") },
        { label: "Other", description: "Tezu for your assistant", icon: <Bot {...iconProps} />, href: integration("other") },
      ],
    },
    { value: "motion-control", label: "Motion control", href: publicAsset("/motion-control/") },
    { value: "pricing", label: "Pricing", href: `${appHome}pricing/` },
  ];
}

export function TezuSiteHeader({ page = "home" }: { page?: "home" | "motion-control" }) {
  const [current, setCurrent] = useState("home");
  const items = useMemo(() => navigationItems(page), [page]);

  useEffect(() => {
    if (page !== "home") return;
    const platform = new URLSearchParams(window.location.search).get("integration");
    if (platform && ["chatgpt", "claude", "other"].includes(platform)) {
      document.getElementById(`integration-tab-${platform}`)?.click();
    }
    const update = () => {
      const sections = ["home", "create", "mcp"];
      const marker = Math.min(window.innerHeight * .35, 240);
      let next = "home";
      for (const section of sections) {
        const element = document.getElementById(section);
        if (element && element.getBoundingClientRect().top <= marker) next = section;
      }
      setCurrent(next);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [page]);

  return <SiteHeader
    appearance="resend"
    textureUrl={publicAsset("/sites/resend/texture-btn.png")}
    variant="mega"
    brand={{ name: "Tezu", href: page === "home" ? "#home" : `${publicAsset("/")}#home`, mark: <img className={styles.brandMark} src={publicAsset("/sites/tezu/tezu-knot-logo.png")} width={36} height={36} alt="" /> }}
    items={items}
    current={page === "home" ? current : page}
    onCurrentChange={setCurrent}
    onNavigate={destination => {
      if (destination.label === "Start creating") {
        requestAnimationFrame(() => document.getElementById("hero-prompt")?.focus({ preventScroll: true }));
      }
      if (destination.label === "ChatGPT" || destination.label === "Claude" || destination.label === "Other") {
        const platform = destination.label === "ChatGPT" ? "chatgpt" : destination.label === "Claude" ? "claude" : "other";
        requestAnimationFrame(() => document.getElementById(`integration-tab-${platform}`)?.click());
      }
    }}
    secondaryAction={{ label: "Log in", href: `${appHome}auth/` }}
    primaryAction={{ label: "Start creating", href: page === "home" ? "#home" : `${publicAsset("/")}#home` }}
  />;
}
