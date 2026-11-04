"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { localPath } from "@/lib/local-path";
import { getAuthSession, postAuth, type AuthSession } from "./auth-api";
import { TurnstileChallenge } from "./TurnstileChallenge";

const verificationActions = ["verify_session"] as const;

export function SessionVerification() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [error, setError] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [challengeKey, setChallengeKey] = useState(0);
  const receiveTokens = useCallback((nextTokens: string[]) => setTokens(nextTokens), []);
  const failChallenge = useCallback(() => {
    setSession({ authenticated: false, verified: false });
    setError("Security check failed. Sign in again before continuing.");
    void postAuth("signout", {}).catch(() => undefined);
  }, []);
  const enabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    getAuthSession(controller.signal).then((nextSession) => {
      if (active) {
        if (nextSession.authenticated && nextSession.emailConfirmed && nextSession.verified) {
          window.location.replace(localPath("/blue"));
        }
        setSession(nextSession);
      }
    }).catch(() => {
      if (active) {
        setError("Your session could not be checked. Please sign in again.");
        setSession({ authenticated: false, verified: false });
      }
    }).finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [enabled]);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || tokens.length !== 1) return;
    setPending(true);
    setError("");
    try {
      await postAuth("verify", { token: tokens[0] });
      const nextSession = await getAuthSession();
      if (!nextSession.authenticated || !nextSession.emailConfirmed || !nextSession.verified) throw new Error("Verification did not finish.");
      window.location.replace(localPath("/blue"));
      setSession(nextSession);
    } catch {
      await postAuth("signout", {}).catch(() => undefined);
      setSession({ authenticated: false, verified: false });
      setError("Verification could not finish. Sign in again before continuing.");
    } finally {
      setPending(false);
      setTokens([]);
      setChallengeKey((value) => value + 1);
    }
  }

  async function signOut() {
    setPending(true);
    try {
      await postAuth("signout", {});
      window.location.assign(localPath("/auth"));
    } catch {
      setError("Sign out could not finish. Please try again.");
      setPending(false);
    }
  }

  if (session?.authenticated && session.emailConfirmed && session.verified) {
    return <p className="auth-copy" role="status">Opening Flashloop…</p>;
  }

  return (
    <section className="auth-card" aria-labelledby="auth-heading" aria-busy={pending}>
      <h1 id="auth-heading">Verify your account</h1>
      {!enabled ? <p className="auth-copy">Account verification is not available yet. Please try again later.</p>
        : !session ? <p className="auth-copy" role="status">Checking your session…</p>
        : !session.authenticated ? <>
          <p className="auth-copy">Sign in with your confirmed email to continue.</p>
          <a className="auth-primary" href={localPath("/auth")}>Sign in</a>
        </>
        : !session.emailConfirmed ? <>
          <p className="auth-copy">Confirm your email before continuing. Then sign in again.</p>
          <button className="auth-primary" type="button" disabled={pending} onClick={signOut}>Return to sign in</button>
        </>
        : <>
          <p className="auth-copy">Your email is confirmed. Complete one last security check to use your account.</p>
          <form className="auth-form" onSubmit={verify}>
            {!pending ? <TurnstileChallenge key={challengeKey} actions={verificationActions} onTokens={receiveTokens} onFailure={failChallenge} /> : null}
            <button className="auth-primary" type="submit" disabled={pending || tokens.length !== 1}>{pending ? "Verifying…" : "Verify account"}</button>
          </form>
          <button className="auth-text-button" type="button" onClick={signOut} disabled={pending}>Sign out</button>
        </>}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}
    </section>
  );
}
