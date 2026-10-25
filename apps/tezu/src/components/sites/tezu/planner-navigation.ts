import type { MouseEvent } from "react";

/** Keep keyboard focus in the form while scrolling past a pinned gallery. */
export function focusCharacterPlanner(event: MouseEvent<HTMLAnchorElement>) {
  const prompt = document.getElementById("engine-prompt");
  const planner = document.getElementById("tools");
  if (!prompt || !planner) return;
  event.preventDefault();
  window.history.replaceState(null, "", `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/#tools`);
  prompt.focus({ preventScroll: true });
  planner.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
}
