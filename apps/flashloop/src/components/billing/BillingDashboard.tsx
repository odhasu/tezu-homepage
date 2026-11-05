"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MONTHLY_PLANS, formatEuro, monthlyPlan, type BillingTier } from "@/lib/billing/catalog";
import { localPath } from "@/lib/local-path";
import { parseBillingSummary, subscriptionStatus, whopNavigationUrl, type BillingSummary } from "./billing-client";
import styles from "./billing.module.css";

type PendingAction = "refresh" | "link" | "checkout" | "manage";

export function BillingDashboard({ initialTier = "starter", linkStatus }: { initialTier?: BillingTier; linkStatus?: "success" | "failed" }) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [tier, setTier] = useState<BillingTier>(initialTier);
  const [pending, setPending] = useState<PendingAction | null>("refresh");
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const request = useRef<AbortController | null>(null);
  const activeAction = useRef<PendingAction | null>(null);
  const intentKeys = useRef<Partial<Record<BillingTier, string>>>({});
  const selectedPlan = monthlyPlan(tier)!;

  const refresh = useCallback(async () => {
    if (activeAction.current && activeAction.current !== "refresh") return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    activeAction.current = "refresh";
    setSummary(null);
    setPending("refresh");
    setError("");
    setSignInRequired(false);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(localPath("/api/billing"), {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          if (request.current === controller) setSignInRequired(true);
          throw new Error("session");
        }
        throw new Error("unavailable");
      }
      const nextSummary = parseBillingSummary(await response.json());
      if (!nextSummary) throw new Error("response");
      if (request.current === controller && document.visibilityState !== "hidden") setSummary(nextSummary);
    } catch {
      if (request.current === controller && document.visibilityState !== "hidden") {
        setError("Your billing status could not be checked. Refresh your status before continuing.");
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        activeAction.current = null;
        setPending(null);
      }
    }
  }, []);

  useEffect(() => {
    function pause() {
      request.current?.abort();
      request.current = null;
      activeAction.current = null;
      setSummary(null);
      setError("");
      setPending(null);
    }
    function visibility() {
      if (document.visibilityState === "hidden") pause();
      else void refresh();
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted) void refresh();
    }
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", restore);
    return () => {
      window.clearTimeout(initialRefresh);
      request.current?.abort();
      request.current = null;
      activeAction.current = null;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", restore);
    };
  }, [refresh]);

  async function navigate(action: "link" | "checkout" | "manage") {
    if (activeAction.current || !summary || (action !== "manage" && !summary.available)) return;
    if (action === "manage" && (!summary.linked || !summary.subscription)) return;
    if (action === "checkout" && (!summary.linked || summary.subscription)) return;
    const controller = new AbortController();
    request.current = controller;
    activeAction.current = action;
    setPending(action);
    setError("");
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (action === "checkout" && !intentKeys.current[tier]) intentKeys.current[tier] = crypto.randomUUID();
      const response = await fetch(localPath(action === "checkout" ? "/api/checkout" : `/api/billing/${action}`), {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-requested-with": "flashloop" },
        body: JSON.stringify(action === "checkout" ? { tier, intentKey: intentKeys.current[tier] } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setSignInRequired(true);
        throw new Error("unavailable");
      }
      const url = whopNavigationUrl(await response.json());
      if (!url) throw new Error("response");
      if (request.current === controller) window.location.assign(url);
    } catch {
      if (request.current === controller && document.visibilityState !== "hidden") {
        setError("Whop could not be opened. Refresh your billing status before trying again.");
      }
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        activeAction.current = null;
        setPending(null);
      }
    }
  }

  function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void navigate("checkout");
  }

  return (
    <div aria-busy={pending !== null}>
      {linkStatus === "success" && <p className={styles.notice} role="status">Returning from Whop. Check your account connection status below.</p>}
      {linkStatus === "failed" && <p className={styles.error} role="alert">Whop account connection did not complete. Try again from this page.</p>}
      {pending === "refresh" && <p className={styles.notice} role="status">Checking your billing status…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {signInRequired && <p className={styles.notice}>Your session must be verified again. <a className={styles.textLink} href={localPath("/auth")}>Sign in</a></p>}
      {summary && <>
        {!summary.available && <p className={styles.notice}>Subscriptions are not available yet. You cannot start a payment here.</p>}
        <section className={styles.section} aria-labelledby="billing-summary-heading">
          <h2 id="billing-summary-heading">Your subscription</h2>
          <dl className={styles.summary}>
            <div><dt>Available credits</dt><dd>{summary.credits.toLocaleString("en-GB")}</dd></div>
            <div><dt>Whop account</dt><dd>{summary.linked ? "Connected" : "Not connected"}</dd></div>
            <div><dt>Monthly plan</dt><dd>{summary.subscription ? monthlyPlan(summary.subscription.tier)?.name : "No subscription"}</dd></div>
            {summary.subscription && <>
              <div><dt>Status</dt><dd>{subscriptionStatus(summary.subscription.status)}</dd></div>
              <div><dt>{summary.subscription.cancelAtPeriodEnd ? "Paid period ends" : "Current period ends"}</dt><dd>{new Date(summary.subscription.periodEnd).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</dd></div>
            </>}
          </dl>
          {summary.subscription?.cancelAtPeriodEnd && <p>Your subscription will not renew. Any remaining subscription credits expire at the end of your paid period.</p>}
          {!summary.linked && <>
            <p>Connect the Whop account you will use to pay. This keeps your subscription attached to your Flashloop account.</p>
            <button className={styles.primary} type="button" disabled={pending !== null || !summary.available} onClick={() => void navigate("link")}>{pending === "link" ? "Opening Whop…" : "Connect Whop account"}</button>
          </>}
          {summary.subscription && <>
            <p>Manage your payment method and future renewals securely in Whop.</p>
            <button className={styles.secondary} type="button" disabled={pending !== null || !summary.linked} onClick={() => void navigate("manage")}>{pending === "manage" ? "Opening Whop…" : "Manage subscription in Whop"}</button>
          </>}
        </section>
        {!summary.subscription && <section className={styles.section} aria-labelledby="choose-plan-heading">
          <h2 id="choose-plan-heading">Choose a monthly plan</h2>
          <form className={styles.form} onSubmit={checkout}>
            <label htmlFor="billing-plan">Monthly credits</label>
            <select id="billing-plan" value={tier} disabled={pending !== null} onChange={(event) => {
              const plan = monthlyPlan(event.target.value);
              if (plan) setTier(plan.tier);
            }}>
              {MONTHLY_PLANS.map((plan) => <option value={plan.tier} key={plan.tier}>{plan.name} · {plan.credits.toLocaleString("en-GB")} credits</option>)}
            </select>
            <p><strong>{formatEuro(selectedPlan.initialPriceCents)}</strong> {selectedPlan.initialPriceCents === selectedPlan.renewalPriceCents ? "per month." : `for the first month, then ${formatEuro(selectedPlan.renewalPriceCents)} per month.`} Renews until canceled.</p>
            <p>Subscription credits do not roll over. Cancellation stops future renewals and keeps your paid period until its end. Whop shows the final total before you confirm.</p>
            {!summary.linked && <p>Connect your Whop account above before continuing.</p>}
            <button type="submit" className={styles.primary} disabled={pending !== null || !summary.available || !summary.linked}>{pending === "checkout" ? "Opening Whop…" : "Continue to Whop checkout"}</button>
          </form>
        </section>}
      </>}
      <div className={styles.actions}>
        <button className={styles.secondary} type="button" disabled={pending !== null} onClick={() => void refresh()}>Refresh billing status</button>
        <a className={styles.textLink} href={localPath("/pricing")}>Compare monthly plans</a>
      </div>
    </div>
  );
}
