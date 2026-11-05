"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AnalyticsConsent as Choice } from "@/lib/analytics/consent";
import { captureBrowserPageview, monitorAnalyticsConsent } from "@/lib/analytics/browser";
import "./analytics.css";

export function AnalyticsConsent({ policyVersion }: { policyVersion: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [open, setOpen] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const monitor = useRef<ReturnType<typeof monitorAnalyticsConsent> | null>(null);

  useEffect(() => {
    const current = monitorAnalyticsConsent(policyVersion, (state) => {
      if (state.blocked || state.choice !== "granted") pending.current?.abort();
      setBlocked(state.blocked);
      setChoice(state.choice);
      setReady(true);
    });
    monitor.current = current;
    return () => {
      current.stop();
      monitor.current = null;
      pending.current?.abort();
    };
  }, [policyVersion]);

  useEffect(() => {
    if (!ready || choice !== "granted" || blocked) return;
    const controller = new AbortController();
    pending.current = controller;
    void captureBrowserPageview(pathname, policyVersion, controller.signal);
    return () => controller.abort();
  }, [pathname, choice, ready, blocked, policyVersion]);

  function choose(value: Choice) {
    pending.current?.abort();
    monitor.current?.choose(value);
    setOpen(false);
  }

  if (!ready) return null;
  if (!open && choice !== null) {
    return <button type="button" className="analytics-preferences" onClick={() => setOpen(true)}>Analytics preferences</button>;
  }
  return (
    <section className="analytics-consent" aria-labelledby="analytics-consent-title">
      <h2 id="analytics-consent-title">Optional analytics</h2>
      <p>{blocked ? "Your browser privacy choice disables optional analytics." :
        "Allow limited visit and service-outcome counts? Form text, media and account details are excluded. Your choice lasts 30 days and can be changed here."}</p>
      <div className="analytics-consent-actions">
        {!blocked && <button type="button" onClick={() => choose("granted")}>Allow analytics</button>}
        <button type="button" onClick={() => choose("denied")}>{choice === "granted" ? "Revoke analytics" : "Reject analytics"}</button>
      </div>
    </section>
  );
}
