"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { localPath } from "@/lib/local-path";
import { browserCreationKind, creationContinuationPath, pendingCreationKind, rememberCreationKind } from "@/lib/creation-draft";
import { authErrorMessage, getAuthSession, postAuth } from "./auth-api";
import { TurnstileChallenge } from "./TurnstileChallenge";
import { useAuthRetry } from "./useAuthRetry";

const challengeActions = {
  signup: ["signup", "signup_auth"],
  signin: ["signin", "signin_auth"],
} as const;

export function AuthForm({ initialMode = "signin" }: { initialMode?: "signup" | "signin" }) {
  const [mode, setMode] = useState<"signup" | "signin">(initialMode);
  const [tokens, setTokens] = useState<string[]>([]);
  const [challengeKey, setChallengeKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState("");
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const { retrySeconds, retrying, startRetry } = useAuthRetry();
  const form = useRef<HTMLFormElement>(null);
  const sessionCheck = useRef<AbortController | null>(null);
  const receiveTokens = useCallback((nextTokens: string[]) => setTokens(nextTokens), []);
  const enabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const googleEnabled = enabled && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true";

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    sessionCheck.current = controller;
    let callbackFailed = false;
    try {
      const values = new URL(window.location.href).searchParams.getAll("authError");
      callbackFailed = values.length === 1 && values[0] === "callback";
    } catch { /* The form also renders without browser navigation state. */ }
    if (callbackFailed) {
      Promise.resolve().then(() => {
        if (active) setError("Sign-in could not finish. Try again, or create an account with email first.");
      });
    } else {
      void getAuthSession(controller.signal).then((session) => {
        if (!active || controller.signal.aborted || !session.authenticated) return;
        const destination = session.emailConfirmed && session.verified ? "/account" : "/auth/verify";
        window.location.replace(localPath(creationContinuationPath(destination, pendingCreationKind(browserCreationKind()))));
      }).catch(() => { /* Fresh credentials can still be submitted after a failed session check. */ });
    }
    return () => { active = false; controller.abort(); };
  }, [enabled]);

  function switchMode() {
    if (pending || googlePending || retrying) return;
    setMode((current) => current === "signin" ? "signup" : "signin");
    setError("");
    setTokens([]);
    setConfirmationRequired(false);
    setChallengeKey((value) => value + 1);
    form.current?.reset();
  }

  function continueWithGoogle() {
    if (!googleEnabled || pending || googlePending || retrying) return;
    sessionCheck.current?.abort();
    const kind = pendingCreationKind(browserCreationKind());
    rememberCreationKind(kind);
    setGooglePending(true);
    window.location.assign(localPath(`/api/auth/google?kind=${kind}`));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || googlePending || retrying || tokens.length !== 2) return;
    sessionCheck.current?.abort();
    const data = new FormData(event.currentTarget);
    const email = data.get("email");
    const password = data.get("password");
    if (typeof email !== "string" || typeof password !== "string") return;
    setPending(true);
    setError("");
    rememberCreationKind(pendingCreationKind(browserCreationKind()));
    try {
      const reply = await postAuth(mode, { email, password, token: tokens[0], captchaToken: tokens[1] });
      form.current?.reset();
      if (mode === "signup" && reply.confirmationRequired) {
        setConfirmationRequired(true);
      } else {
        window.location.assign(localPath(creationContinuationPath("/auth/verify", pendingCreationKind(browserCreationKind()))));
      }
    } catch (reason) {
      startRetry(reason);
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
        <h1 id="auth-heading">Your next idea starts here</h1>
        <p className="auth-copy">Account access is not available in this website preview. You can explore the image and video workspaces without signing in.</p>
        <a className="auth-primary" href={localPath("/create/video/")} onClick={(event) => {
          event.preventDefault();
          window.location.assign(localPath(`/create/${pendingCreationKind(browserCreationKind())}/`));
        }}>Explore the workspace</a>
        <a className="auth-text-button" href={localPath("/blue/")}>Back to Flashloop</a>
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
      {googleEnabled && mode === "signin" ? <>
        <button className="auth-google" type="button" onClick={continueWithGoogle} disabled={pending || googlePending || retrying}>
          {googlePending ? "Opening Google…" : "Continue with Google"}
        </button>
        <p className="auth-helper">Use your existing Flashloop account. New here? Create your account with email first.</p>
        <div className="auth-divider" aria-hidden="true"><span>or</span></div>
      </> : null}
      <form ref={form} onSubmit={submit} className="auth-form" aria-busy={pending || googlePending}>
        <label htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required disabled={pending || googlePending} />
        <label htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={mode === "signup" ? 12 : 1} maxLength={128} required disabled={pending || googlePending} aria-describedby={mode === "signup" ? "auth-password-help" : undefined} />
        {mode === "signup" ? <p className="auth-helper" id="auth-password-help">Use at least 12 characters.</p> : null}
        {!pending && !googlePending && !retrying ? <TurnstileChallenge key={`${mode}-${challengeKey}`} actions={challengeActions[mode]} onTokens={receiveTokens} /> : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {retrying ? <p className="auth-helper">Try again in {retrySeconds} {retrySeconds === 1 ? "second" : "seconds"}.</p> : null}
        <button className="auth-primary" type="submit" disabled={pending || googlePending || retrying || tokens.length !== 2}>
          {pending ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create account" : "Sign in")}
        </button>
      </form>
      <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to Flashloop?"}{" "}
        <button type="button" onClick={switchMode} disabled={pending || googlePending || retrying}>{mode === "signup" ? "Sign in" : "Create account"}</button>
      </p>
    </section>
  );
}
