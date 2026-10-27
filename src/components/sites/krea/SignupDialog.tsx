"use client";

/* eslint-disable @next/next/no-img-element -- The reference is a local preview or existing Tezu artwork. */

import { X } from "lucide-react";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { tezuAppHome } from "./app-links";
import { validateAuthFields, type AuthErrors, type AuthMode } from "./creation-form";
import "./signup-dialog.css";

type SignupDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  prompt: string;
  reference: string | null;
  resolution: string;
  batchSize: number;
};

export function SignupDialog({ dialogRef, returnFocusRef, prompt, reference, resolution, batchSize }: SignupDialogProps) {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [errors, setErrors] = useState<AuthErrors>({});
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const isSignup = mode === "signup";

  function close() {
    formRef.current?.reset();
    setErrors({});
    setMessage("");
    setMode("signup");
    returnFocusRef.current?.focus({ preventScroll: true });
  }

  function changeMode() {
    formRef.current?.reset();
    setErrors({});
    setMessage("");
    setMode(isSignup ? "login" : "signup");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const nextErrors = validateAuthFields({ mode, email: String(data.get("email") ?? ""), password: String(data.get("password") ?? ""), agreement: data.get("agreement") === "on" });
    setErrors(nextErrors);
    setMessage("");
    const firstError = nextErrors.email ? "email" : nextErrors.password ? "password" : nextErrors.agreement ? "agreement" : null;
    if (firstError) {
      form.querySelector<HTMLInputElement>(`[name="${firstError}"]`)?.focus();
      return;
    }
    form.querySelector<HTMLInputElement>('[name="password"]')!.value = "";
    setMessage("This form is a preview. No details were sent, no account was connected, and generation has not started. Your idea is still here.");
  }

  function continueWithGoogle() {
    if (isSignup && !formRef.current?.querySelector<HTMLInputElement>('[name="agreement"]')?.checked) {
      setErrors({ agreement: "Confirm your age and agreement to continue." });
      setMessage("");
      formRef.current?.querySelector<HTMLInputElement>('[name="agreement"]')?.focus();
      return;
    }
    setErrors({});
    setMessage("Google sign-in is not connected in this preview. Your idea stays here; generation has not started.");
  }

  return <dialog ref={dialogRef} id="tezu-signup-dialog" className="tezu-signup-dialog" aria-labelledby="tezu-signup-heading" aria-describedby="tezu-signup-notice" onClose={close}>
    <button type="button" className="tezu-signup-close" aria-label="Close signup and return to your idea" onClick={() => dialogRef.current?.close()}><X size={20} /></button>
    <div className="tezu-signup-heading"><span>TEZU</span><h2 id="tezu-signup-heading">{isSignup ? "Create your account" : "Welcome back"}</h2><p>Your next story starts with this idea.</p></div>
    <div className="tezu-signup-draft" aria-label="Your video idea">
      {reference && <img src={reference} alt="Your selected reference" width={48} height={48} />}
      <div><p>{prompt}</p><span>Seedance 2.5 · {resolution} · {batchSize} {batchSize === 1 ? "video" : "videos"}</span></div>
    </div>
    <p id="tezu-signup-notice" className="tezu-signup-notice">Frontend preview. Accounts and generation aren&apos;t connected yet. Your idea stays on this page.</p>
    <button type="button" className="tezu-signup-google" onClick={continueWithGoogle}><span aria-hidden="true">G</span>{isSignup ? "Sign up with Google" : "Continue with Google"}</button>
    <div className="tezu-signup-divider"><span />or continue with email<span /></div>
    <form ref={formRef} method="dialog" className="tezu-signup-form" onSubmit={submit} onChange={() => { setErrors({}); setMessage(""); }} noValidate>
      <label htmlFor="tezu-signup-email">Email<input id="tezu-signup-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "tezu-signup-email-error" : undefined} /></label>
      {errors.email && <p className="tezu-signup-error" id="tezu-signup-email-error" role="alert">{errors.email}</p>}
      <label htmlFor="tezu-signup-password">Password<input id="tezu-signup-password" name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} required aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "tezu-signup-password-error" : isSignup ? "tezu-signup-password-help" : undefined} /></label>
      {errors.password ? <p className="tezu-signup-error" id="tezu-signup-password-error" role="alert">{errors.password}</p> : isSignup && <p className="tezu-signup-help" id="tezu-signup-password-help">At least 8 characters.</p>}
      {isSignup && <div><label className="tezu-signup-agreement" htmlFor="tezu-signup-agreement"><input id="tezu-signup-agreement" name="agreement" type="checkbox" required aria-invalid={Boolean(errors.agreement)} aria-describedby={errors.agreement ? "tezu-signup-agreement-error" : undefined} /><span>I am 18 or older and agree to the <a href={`${tezuAppHome}terms/`} target="_blank" rel="noreferrer">Terms</a> and <a href={`${tezuAppHome}privacy/`} target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>{errors.agreement && <p className="tezu-signup-error" id="tezu-signup-agreement-error" role="alert">{errors.agreement}</p>}</div>}
      <button className="tezu-signup-submit" type="submit">{isSignup ? "Create account" : "Log in"}</button>
    </form>
    {message && <p className="tezu-signup-feedback" role="status">{message}</p>}
    <p className="tezu-signup-switch">{isSignup ? "Already have an account?" : "New to Tezu?"} <button type="button" onClick={changeMode}>{isSignup ? "Log in" : "Sign up"}</button></p>
  </dialog>;
}
