export type CreationKind = "image" | "video";
export type CreationDraft = {
  kind: CreationKind;
  prompt: string;
  model: string;
  ratio: string;
  quality: string;
  count: string;
  duration: string;
};

const key = "flashloop.creation-draft.v1";
const lifetime = 30 * 60 * 1000;

/** Same-tab, short-lived handoff. Never put a prompt or file URL in navigation. */
export function saveCreationDraft(draft: CreationDraft): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...draft, prompt: draft.prompt.slice(0, 6000), expires: Date.now() + lifetime }));
    return true;
  } catch { return false; }
}

/** Consume once; no draft is sent to an API until the user explicitly submits. */
export function consumeCreationDraft(kind: CreationKind): CreationDraft | null {
  try {
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw || raw.length > 16000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const draft = value as Record<string, unknown>;
    if (draft.kind !== kind || typeof draft.expires !== "number" || draft.expires < Date.now() || draft.expires > Date.now() + lifetime) return null;
    for (const field of ["prompt", "model", "ratio", "quality", "count", "duration"] as const) {
      if (typeof draft[field] !== "string" || draft[field].includes("\u0000")) return null;
    }
    if ((draft.prompt as string).length > 6000 || (draft.model as string).length > 100) return null;
    return { kind, prompt: draft.prompt as string, model: draft.model as string, ratio: draft.ratio as string, quality: draft.quality as string, count: draft.count as string, duration: draft.duration as string };
  } catch { return null; }
}

export function clearCreationDraft() {
  try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

/** Preserve only the allowlisted tool choice through email/session verification. */
export function pendingCreationKind(): CreationKind {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 16000) return "video";
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "video";
    const draft = value as Record<string, unknown>;
    if (typeof draft.expires !== "number" || draft.expires < Date.now() || draft.expires > Date.now() + lifetime) return "video";
    return draft.kind === "image" ? "image" : "video";
  } catch { return "video"; }
}
