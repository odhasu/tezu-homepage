"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { localPath } from "@/lib/local-path";
import { authErrorMessage, postAuth } from "./auth-api";
import { TurnstileChallenge } from "./TurnstileChallenge";

const challengeActions = {
  signup: ["signup", "signup_auth"],
  signin: ["signin", "signin_auth"],
} as const;

export function AuthForm({ initialMode = "signin" }: { initialMode?: "signup" | "signin" }) {
  const [mode, setMode] = useState<"signup" | "signin">(initialMode);
  const [tokens, setTokens] = useState<string[]>([]);
  const [challengeKey, setChallengeKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const receiveTokens = useCallback((nextTokens: string[]) => setTokens(nextTokens), []);
  const enabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  function switchMode() {
    setMode((current) => current === "signin" ? "signup" : "signin");
    setError("");
    setTokens([]);
    setConfirmationRequired(false);
    setChallengeKey((value) => value + 1);
    form.current?.reset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || tokens.length !== 2) return;
    const data = new FormData(event.currentTarget);
    const email = data.get("email");
    const password = data.get("password");
    if (typeof email !== "string" || typeof password !== "string") return;
    setPending(true);
    setError("");
    try {
      const reply = await postAuth(mode, { email, password, token: tokens[0], captchaToken: tokens[1] });
      form.current?.reset();
      if (mode === "signup" && reply.confirmationRequired) {
        setConfirmationRequired(true);
      } else {
        window.location.assign(localPath("/auth/verify"));
      }
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setPending(false);
      setTokens([]);
      setChallengeKey((value) => value + 1);
    }
  }

  if (!enabled) {
    return (
      <section className="auth-card" aria-labelledby="auth-heading">
        <h1 id="auth-heading">Account access is coming soon</h1>
        <p className="auth-copy">Signups are not available yet. Check back soon.</p>
        <a className="auth-primary" href={localPath("/blue")}>Back to Flashloop</a>
      </section>
    );
  }

  if (confirmationRequired) {
    return (
      <section className="auth-card" aria-labelledby="auth-heading">
        <h1 id="auth-heading">Check your email</h1>
        <p className="auth-copy" role="status">Open the confirmation link in your inbox. Then sign in to finish verifying your account.</p>
        <p className="auth-helper">No confirmation email? Check spam or try signing up again later.</p>
        <button className="auth-primary" type="button" onClick={switchMode}>Continue to sign in</button>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby="auth-heading">
      <h1 id="auth-heading">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
      <p className="auth-copy">{mode === "signup"
        ? "Confirm your email and complete a security check before using your account."
        : "Sign in to your Flashloop account."}</p>
      <form ref={form} onSubmit={submit} className="auth-form" aria-busy={pending}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={pending} />
        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} maxLength={128} required disabled={pending} aria-describedby={mode === "signup" ? "auth-password-help" : undefined} />
        {mode === "signup" ? <p className="auth-helper" id="auth-password-help">Use at least 12 characters.</p> : null}
        {!pending ? <TurnstileChallenge key={`${mode}-${challengeKey}`} actions={challengeActions[mode]} onTokens={receiveTokens} /> : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button className="auth-primary" type="submit" disabled={pending || tokens.length !== 2}>
          {pending ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}
        </button>
      </form>
      <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to Flashloop?"}{" "}
        <button type="button" onClick={switchMode} disabled={pending}>{mode === "signup" ? "Sign in" : "Create account"}</button>
      </p>
    </section>
  );
}
