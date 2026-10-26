"use client";

/* eslint-disable @next/next/no-img-element -- Supplied transparent logo is served from local assets. */

import { Clapperboard, ImagePlay, MessageCircle, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { SiteHeader, type SiteHeaderItem } from "./SiteHeader";
import { publicAsset, tezuMedia } from "./assets";
import styles from "./SiteHeader.module.css";

const appHome = process.env.NODE_ENV === "development"
  ? "http://127.0.0.1:3000/"
  : publicAsset("/tezu/");
const iconProps = { size: 18, strokeWidth: 1.5, "aria-hidden": true } as const;
const artwork = tezuMedia.find(item => item.id === "tezu-07-preview");
const items: SiteHeaderItem[] = [
  { value: "home", label: "Home", href: "#home" },
  {
    value: "create", label: "Create",
    links: [
      { label: "Cartoon Maker", description: "Bring your stories to life", icon: <Clapperboard {...iconProps} />, href: `${appHome}#mcp` },
      { label: "Character Swap", description: "Make every character your own", icon: <Users {...iconProps} />, href: `${appHome}templates/` },
      { label: "Video studio", description: "Turn an idea into a video", icon: <ImagePlay {...iconProps} />, href: `${appHome}create/video/` },
      { label: "Explore tools", description: "Find your next creative starting point", icon: <Sparkles {...iconProps} />, href: "#create" },
    ],
    feature: {
      title: "Made with Tezu", description: "A little inspiration for your next idea.", href: "#results",
      image: artwork ? { src: artwork.poster, alt: "A cartoon created with Tezu" } : undefined,
    },
  },
  {
    value: "mcp", label: "Apps",
    links: [
      { label: "ChatGPT", description: "Create with Tezu in ChatGPT", icon: <MessageCircle {...iconProps} />, href: "#mcp" },
      { label: "Claude", description: "Create with Tezu in Claude", icon: <Sparkles {...iconProps} />, href: "#mcp" },
      { label: "Claude Code", description: "Add Tezu to your workflow", icon: <Clapperboard {...iconProps} />, href: "#mcp" },
    ],
  },
  { value: "results", label: "Cartoon Maker", href: "#results" },
];

export function TezuSiteHeader() {
  const [current, setCurrent] = useState("home");

  useEffect(() => {
    const update = () => {
      const sections = ["home", "create", "mcp", "results"];
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
  }, []);

  return <SiteHeader
    variant="mega"
    brand={{ name: "Tezu", href: "#home", mark: <img className={styles.brandMark} src={publicAsset("/sites/tezu/tezu-knot-logo.png")} width={36} height={36} alt="" /> }}
    items={items}
    current={current}
    onCurrentChange={setCurrent}
    onNavigate={destination => {
      if (destination.label === "ChatGPT" || destination.label === "Claude" || destination.label === "Claude Code") {
        const platform = destination.label === "ChatGPT" ? "chatgpt" : destination.label === "Claude" ? "claude" : "claude-code";
        document.getElementById(`integration-tab-${platform}`)?.click();
      }
    }}
    secondaryAction={{ label: "Log in", href: `${appHome}auth/` }}
    primaryAction={{ label: "Start creating", href: `${appHome}#mcp` }}
  />;
}
