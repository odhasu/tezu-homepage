"use client";

import { useSearchParams } from "next/navigation";
import { Studio, type StudioKind } from "@/components/sites/tezu/studio";

export function StudioWithQuery({ kind }: { kind: StudioKind }) {
  const query = useSearchParams();
  return <Studio key={`${kind}:${query.toString()}`} kind={kind} initialModel={query.get("model") ?? undefined} initialPrompt={query.get("prompt") ?? undefined} initialRatio={query.get("ratio") ?? undefined} initialDuration={query.get("duration") ?? undefined} />;
}
