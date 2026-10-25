import { pageMetadata } from "@/lib/site-metadata";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { StudioKind } from "@/components/sites/tezu/studio";
import { StudioWithQuery } from "./StudioWithQuery";

export function generateStaticParams() {
  return ["character", "image", "video"].map((kind) => ({ kind }));
}

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const names: Record<string, string> = { character: "Character Creator", image: "Image Generator", video: "Video Generator" };
  const descriptions: Record<string, string> = {
    character: "Build the cast for your next cartoon story with the TEZU Character Creator. Explore references, styles, and creative direction.",
    image: "Shape your next scene in TEZU Image Studio. Explore image models, add reference pictures, and refine your creative direction.",
    video: "Bring your scenes to life in TEZU Video Studio. Choose a model, plan camera movement, and prepare your next cinematic clip.",
  };
  return pageMetadata(`${names[kind] ?? "Studio"} · TEZU`, descriptions[kind] ?? "Explore the TEZU creative studio.", `/create/${kind}`, false);
}

export default async function StudioPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!["character", "image", "video"].includes(kind)) notFound();
  return <Suspense fallback={<p role="status">Loading studio…</p>}><StudioWithQuery kind={kind as StudioKind} /></Suspense>;
}
