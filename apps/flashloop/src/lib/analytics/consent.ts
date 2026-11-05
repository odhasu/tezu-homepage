export const ANALYTICS_CONSENT_COOKIE = "flashloop_analytics_consent";
export const ANALYTICS_CONSENT_TTL_SECONDS = 30 * 24 * 60 * 60;
export type AnalyticsConsent = "granted" | "denied";

/** This cookie stores a privacy choice and time, never a visitor identifier. */
export function readAnalyticsConsent(cookie: string, policyVersion: string, now = Date.now()): AnalyticsConsent | null {
  const values = cookie.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${ANALYTICS_CONSENT_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0].slice(ANALYTICS_CONSENT_COOKIE.length + 1).split(":");
  if (value.length !== 3 || value[0] !== policyVersion || !["granted", "denied"].includes(value[1]) || !/^\d{10}$/.test(value[2])) return null;
  const age = now - Number(value[2]) * 1000;
  if (age < 0 || age >= ANALYTICS_CONSENT_TTL_SECONDS * 1000) return null;
  return value[1] as AnalyticsConsent;
}

export function analyticsConsentCookie(choice: AnalyticsConsent, policyVersion: string, secure: boolean, now = Date.now()): string {
  return `${ANALYTICS_CONSENT_COOKIE}=${policyVersion}:${choice}:${Math.floor(now / 1000)}; Path=/; Max-Age=${ANALYTICS_CONSENT_TTL_SECONDS}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function browserPrivacyEnabled(browser: { globalPrivacyControl?: boolean; doNotTrack?: string | null }): boolean {
  return browser.globalPrivacyControl === true || browser.doNotTrack === "1";
}

export const ANALYTICS_PAGES = ["home", "blue", "signin", "signup", "verification", "account"] as const;
export type AnalyticsPage = typeof ANALYTICS_PAGES[number];

/** Only fixed page names leave this helper; paths, queries and fragments never do. */
export function analyticsPage(pathname: string, basePath = ""): AnalyticsPage | null {
  const path = basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || "/" : pathname;
  const pages: Record<string, AnalyticsPage> = {
    "/": "home", "/blue": "blue", "/auth": "signin", "/auth/signup": "signup",
    "/auth/verify": "verification", "/account": "account",
  };
  return pages[path.replace(/\/$/, "") || "/"] ?? null;
}
