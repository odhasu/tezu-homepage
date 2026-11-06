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
const preferenceKey = "flashloop.creation-kind.v1";
const lifetime = 30 * 60 * 1000;

/** Tool choice is display state only, never a return URL or authorization input. */
export function readCreationKind(value: unknown): CreationKind | undefined {
  return value === "image" || value === "video" ? value : undefined;
}

export function creationContinuationPath(path: "/auth" | "/auth/verify" | "/account", value: unknown): string {
  const kind = readCreationKind(value);
  return kind ? `${path}?kind=${kind}` : path;
}

/** Read only one allowlisted URL field. Prompt and return-URL parameters are ignored. */
export function browserCreationKind(): CreationKind | undefined {
  try {
    const values = new URL(window.location.href).searchParams.getAll("kind");
    return values.length === 1 ? readCreationKind(values[0]) : undefined;
  } catch { return undefined; }
}

/** Survives the fixed email callback in the same tab; contains no personal content. */
export function rememberCreationKind(value: unknown): void {
  const kind = readCreationKind(value);
  if (!kind) return;
  try { sessionStorage.setItem(preferenceKey, JSON.stringify({ kind, expires: Date.now() + lifetime })); } catch { /* URL choice still works without storage. */ }
}

function rememberedCreationKind(): CreationKind | undefined {
  try {
    const raw = sessionStorage.getItem(preferenceKey);
    if (!raw || raw.length > 200) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const preference = value as Record<string, unknown>;
    if (typeof preference.expires !== "number" || preference.expires < Date.now() || preference.expires > Date.now() + lifetime) return undefined;
    return readCreationKind(preference.kind);
  } catch { return undefined; }
}

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
  try { sessionStorage.removeItem(preferenceKey); } catch { /* Storage may be unavailable. */ }
}

/** Preserve only the allowlisted tool choice through email/session verification. */
export function pendingCreationKind(requestedKind?: unknown): CreationKind {
  const fallback = readCreationKind(requestedKind) ?? rememberedCreationKind() ?? "video";
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 16000) return fallback;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const draft = value as Record<string, unknown>;
    if (typeof draft.expires !== "number" || draft.expires < Date.now() || draft.expires > Date.now() + lifetime) return fallback;
    return readCreationKind(draft.kind) ?? fallback;
  } catch { return fallback; }
}
