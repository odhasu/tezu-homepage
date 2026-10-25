"use client";

export const privacyStorageKey = "tezu-privacy-v1";
const changeEvent = "tezu:privacy-change";
let fallback: string | null = null;

export function getPrivacySnapshot() {
  try { return localStorage.getItem(privacyStorageKey) ?? fallback; }
  catch { return fallback; }
}

export function subscribePrivacy(callback: () => void) {
  window.addEventListener(changeEvent, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(changeEvent, callback); window.removeEventListener("storage", callback); };
}

export function parsePrivacy(value: string | null): boolean {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    return typeof parsed === "object" && parsed !== null && "version" in parsed && parsed.version === 1 && "acknowledged" in parsed && parsed.acknowledged === true;
  } catch { return false; }
}

export function savePrivacy() {
  fallback = JSON.stringify({ version: 1, acknowledged: true });
  try { localStorage.setItem(privacyStorageKey, fallback); } catch { /* Keep the choice for this session if storage is blocked. */ }
  window.dispatchEvent(new Event(changeEvent));
}
