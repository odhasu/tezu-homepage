import { localPath } from "@/lib/local-path";
import { analyticsConsentCookie, analyticsPage, browserPrivacyEnabled, readAnalyticsConsent, type AnalyticsConsent } from "./consent";

export type AnalyticsPrivacyState = { choice: AnalyticsConsent | null; blocked: boolean };

function browserBlocked(): boolean {
  return browserPrivacyEnabled(navigator as Navigator & { globalPrivacyControl?: boolean }) ||
    (window as Window & { doNotTrack?: string }).doNotTrack === "1";
}

/** Notify other same-origin tabs without broadcasting an identity or analytics data. */
export function monitorAnalyticsConsent(policyVersion: string, onChange: (state: AnalyticsPrivacyState) => void) {
  let channel: BroadcastChannel | undefined;
  function refresh() {
    onChange({ choice: readAnalyticsConsent(document.cookie, policyVersion), blocked: browserBlocked() });
  }
  try {
    channel = new BroadcastChannel("flashloop-analytics-consent");
    channel.addEventListener("message", refresh);
  } catch { /* Focus/navigation checks remain available when channels are unsupported. */ }
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
  refresh();
  return {
    choose(choice: AnalyticsConsent) {
      document.cookie = analyticsConsentCookie(choice, policyVersion, location.protocol === "https:");
      refresh();
      try { channel?.postMessage("privacy-choice-changed"); }
      catch { /* The current tab's choice is already applied. */ }
    },
    stop() {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      channel?.close();
    },
  };
}

export async function captureBrowserPageview(pathname: string, policyVersion: string, signal: AbortSignal): Promise<void> {
  const page = analyticsPage(pathname, process.env.NEXT_PUBLIC_BASE_PATH ?? "");
  if (!page || signal.aborted || browserBlocked() || readAnalyticsConsent(document.cookie, policyVersion) !== "granted") return;
  try {
    await fetch(localPath("/api/analytics"), {
      method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json", "X-Requested-With": "flashloop" },
      body: JSON.stringify({ page }), signal,
    });
  } catch { /* Optional analytics never affects navigation or account operations. */ }
}
