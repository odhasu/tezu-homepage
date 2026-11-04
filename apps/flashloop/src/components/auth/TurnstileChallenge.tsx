"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "dark";
    size: "compact" | "flexible";
    "response-field": false;
    retry: "never";
    callback: (token: string) => void;
    "error-callback": () => void;
    "expired-callback": () => void;
    "timeout-callback": () => void;
  }) => string;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type TurnstileChallengeProps = {
  actions: readonly string[];
  onTokens: (tokens: string[]) => void;
  onFailure?: () => void;
};

export function TurnstileChallenge({ actions, onTokens, onFailure }: TurnstileChallengeProps) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const container = useRef<HTMLDivElement>(null);
  const tokens = useRef<string[]>([]);
  const expirationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  const resetChallenge = useCallback((message = "") => {
    if (expirationTimer.current) clearTimeout(expirationTimer.current);
    expirationTimer.current = null;
    tokens.current = [];
    onTokens([]);
    setComplete(false);
    setStep(0);
    setCycle((value) => value + 1);
    setError(message);
    if (message) onFailure?.();
  }, [onFailure, onTokens]);

  useEffect(() => {
    if (!scriptReady || !siteKey || !container.current || !window.turnstile || error) return;
    let active = true;
    const api = window.turnstile;
    let widgetId: string;
    try {
      widgetId = api.render(container.current, {
        sitekey: siteKey,
        action: actions[step],
        theme: "dark",
        size: window.matchMedia("(max-width: 390px)").matches ? "compact" : "flexible",
        "response-field": false,
        retry: "never",
        callback: (token) => {
          if (!active || tokens.current.length !== step || !token) return;
          tokens.current = [...tokens.current, token];
          onTokens([...tokens.current]);
          setError("");
          if (step === 0) {
            expirationTimer.current = setTimeout(() => {
              resetChallenge("Security check expired. Complete a new check to continue.");
            }, 240000);
          }
          if (step + 1 < actions.length) setStep(step + 1);
          else setComplete(true);
        },
        "error-callback": () => {
          if (active) resetChallenge("Security check failed. Please try again.");
        },
        "expired-callback": () => {
          if (active) resetChallenge("Security check expired. Please try again.");
        },
        "timeout-callback": () => {
          if (active) resetChallenge("Security check timed out. Please try again.");
        },
      });
    } catch {
      queueMicrotask(() => {
        if (active) resetChallenge("Security check could not start. Please try again.");
      });
      return () => { active = false; };
    }
    return () => {
      active = false;
      api.remove(widgetId);
    };
  }, [actions, cycle, error, onTokens, resetChallenge, scriptReady, siteKey, step]);

  useEffect(() => {
    const loadingTimer = setTimeout(() => {
      if (!window.turnstile) {
        resetChallenge("Security check could not load. Refresh this page to try again.");
      }
    }, 15000);
    return () => {
      clearTimeout(loadingTimer);
      if (expirationTimer.current) clearTimeout(expirationTimer.current);
    };
  }, [resetChallenge]);

  if (!siteKey) {
    return <p className="auth-message" role="status">Account access is not ready yet. Please try again later.</p>;
  }

  return (
    <div className="auth-security">
      <p className="auth-helper" aria-live="polite">
        {complete ? "Security checks complete." : actions.length > 1
          ? `Security check ${step + 1} of ${actions.length}`
          : "Complete the security check to continue."}
      </p>
      <div ref={container} className="auth-turnstile" />
      {error ? <>
        <p className="auth-error" role="alert">{error}</p>
        <button className="auth-text-button" type="button" onClick={() => {
          if (!window.turnstile) window.location.reload();
          else resetChallenge();
        }}>Retry security check</button>
      </> : null}
      <Script
        id="flashloop-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => resetChallenge("Security check could not load. Refresh this page to try again.")}
      />
    </div>
  );
}
