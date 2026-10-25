/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, Check, Clapperboard, Film, Megaphone, Play, Sparkles, Users, Video } from "lucide-react";
import { asset } from "./assets";
import "./secondary-pages.css";

const logo = "/__l5e/assets-v1/dd7d1504-2633-4df7-b36e-be6076f0c090/tezu-white-knot-logo.png";
const audiences = [
  { title: "Creators", description: "Turn ideas into memorable recurring stories, animated characters, and short-form videos.", icon: Users },
  { title: "Brands", description: "Produce visually distinctive advertisements and product stories.", icon: Megaphone },
  { title: "Creative Agencies", description: "Explore AI-assisted production workflows for client campaigns.", icon: Sparkles },
  { title: "Media & Entertainment", description: "Develop animated concepts, pilots, and story-driven content.", icon: Film },
];

export function AboutPage() {
  return (
    <main className="tezu-secondary">
      <section className="secondary-hero about-hero">
        <div className="secondary-width secondary-hero-grid">
          <div>
            <p className="secondary-eyebrow">About TEZU</p>
            <h1>Built for stories<br /><span className="text-gradient">that move people.</span></h1>
            <p className="secondary-intro">TEZU is an AI video studio focused on cinematic storytelling, expressive animation, and content that captures attention.</p>
            <p className="secondary-intro secondary-muted">We combine creative direction, character design, and AI-powered production to help creators and brands turn ideas into unforgettable videos.</p>
            <div className="secondary-actions">
              <Link className="secondary-button primary" href="/#tools">Explore the Platform <ArrowUpRight size={17} /></Link>
              <Link className="secondary-button" href="/hire">Hire Our Studio</Link>
            </div>
          </div>
          <div className="about-reels" aria-label="TEZU animation examples">
            <img src={asset("/assets/reel-6-BMamkTHz.jpg")} alt="Cinematic character animation by TEZU" />
            <img src={asset("/assets/reel-3-C0HEv94t.jpg")} alt="TEZU animated storytelling example" />
            <img className="about-reel-logo" src={asset(logo)} alt="TEZU" />
          </div>
        </div>
      </section>
      <section className="secondary-audiences secondary-width">
        <p className="secondary-eyebrow">Who it&apos;s for</p>
        <h2>Made for the next generation<br className="secondary-desktop-break" /> of creators.</h2>
        <div className="secondary-audience-grid">
          {audiences.map(({ title, description, icon: Icon }) => <article className="secondary-panel audience-card" key={title}>
            <span className="audience-icon"><Icon size={20} /></span>
            <h3>{title}</h3><p>{description}</p>
          </article>)}
        </div>
        <div className="secondary-policy-links">
          {[["Commercial usage terms", "/terms"], ["Privacy", "/privacy"], ["Content ownership", "/terms"], ["Transparent credits", "/pricing"], ["Payments at launch", "/pricing"], ["Customer support", "/hire"]].map(([title, href]) => <Link key={title} href={href}>{title}<ArrowUpRight size={14} /></Link>)}
        </div>
      </section>
    </main>
  );
}

const services = ["Cinematic AI Reels", "Character-based storytelling", "AI advertising videos", "Creator content", "Brand campaigns", "Short-form animation"];
const serviceIcons = [Clapperboard, Users, Video, Play, Megaphone, Sparkles];

export function HirePage() {
  const [review, setReview] = useState<{ name: string; email: string; description: string } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  function submitInquiry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDraft(Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)])));
    setReview({ name: String(form.get("name")), email: String(form.get("email")), description: String(form.get("description")) });
  }
  return <main className="tezu-secondary">
    <section className="secondary-hero hire-hero">
      <div className="secondary-width hire-hero-grid">
        <div><p className="secondary-eyebrow">Hire TEZU · Studio</p><h1>Your vision.<br />Our production.</h1><p className="secondary-intro secondary-muted">Let TEZU create your next cinematic AI video, branded animation, or viral campaign.</p><Link className="secondary-button primary" href="#inquiry">Request a Project Quote <ArrowUpRight size={16} /></Link></div>
        <div className="hire-reels" aria-hidden="true">{["reel-2-C5eo6XGx.jpg", "reel-1-C2AM4G4N.jpg", "reel-6-BMamkTHz.jpg"].map((image) => <img key={image} src={asset(`/assets/${image}`)} alt="" />)}</div>
      </div>
    </section>
    <section className="secondary-width hire-service-grid" aria-label="Studio services">{services.map((service, index) => { const Icon = serviceIcons[index]; return <div className="secondary-panel" key={service}><Icon size={21} /><span>{service}</span></div>; })}</section>
    <section className="hire-inquiry" id="inquiry">
      <div className="inquiry-heading"><h2>Tell us about your project.</h2><p>We&apos;ll review your request and reply by email.</p></div>
      <div className="secondary-panel inquiry-panel">
        {review ? <div className="inquiry-review" role="status">
          <span className="inquiry-check"><Check size={24} /></span><h3>Your project brief is ready.</h3><p>This local preview has not sent your details. Review your brief below, then contact <a href="https://instagram.com/nateassets" target="_blank" rel="noreferrer">@nateassets</a> to discuss your project.</p>
          <dl><dt>Name</dt><dd>{review.name}</dd><dt>Email</dt><dd>{review.email}</dd><dt>Project</dt><dd>{review.description}</dd></dl>
          <div className="secondary-actions"><button className="secondary-button primary" type="button" onClick={async () => { await navigator.clipboard.writeText(Object.entries(draft).filter(([key]) => key !== "consent").map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`).join("\n")); setCopied(true); }}>{copied ? "Copied" : "Copy project brief"}</button><button className="secondary-button" type="button" onClick={() => { setReview(null); setCopied(false); }}>Edit request</button></div>
        </div> : <form className="inquiry-form" onSubmit={submitInquiry}>
          <label>Name *<input name="name" autoComplete="name" defaultValue={draft.name} required /></label>
          <label>Email *<input name="email" type="email" autoComplete="email" defaultValue={draft.email} required /></label>
          <label>Instagram or company website<input name="website" placeholder="@handle or https://" defaultValue={draft.website} /></label>
          <label>Brand or creator name<input name="brand_name" defaultValue={draft.brand_name} /></label>
          <SelectField label="Content category" name="category" value={draft.category} options={["Storytelling", "Creator content", "Advertising", "Brand campaign", "Animation", "Other"]} />
          <SelectField label="Number of videos" name="video_count" value={draft.video_count} options={["1", "2–5", "6–10", "10+", "Ongoing"]} />
          <label className="inquiry-wide">Project description *<textarea name="description" rows={5} defaultValue={draft.description} placeholder="What story do you want to tell?" required /></label>
          <SelectField label="Desired timeline" name="timeline" value={draft.timeline} options={["Flexible", "Within a month", "1–3 months", "Not sure yet"]} />
          <SelectField label="Estimated budget" name="budget" value={draft.budget} options={["Under $500", "$500–$2,000", "$2,000–$5,000", "$5,000+", "Not sure yet"]} />
          <label className="inquiry-consent inquiry-wide"><input name="consent" type="checkbox" defaultChecked={draft.consent === "on"} required /><span>I agree that TEZU may store my details to respond to this request, as described in the <Link href="/privacy">Privacy Policy</Link>.</span></label>
          <div className="inquiry-wide"><button className="secondary-button primary" type="submit">Request a Project Quote <ArrowUpRight size={16} /></button></div>
        </form>}
      </div>
      <div className="hire-process">{["Tell us your vision", "We plan the project", "Production begins after scope and payment are agreed", "Review and delivery"].map((step, index) => <div key={step}><span>0{index + 1}</span><p>{step}</p></div>)}</div>
    </section>
  </main>;
}

function SelectField({ label, name, options, value }: { label: string; name: string; options: string[]; value?: string }) {
  return <label>{label}<select name={name} defaultValue={value ?? ""}><option value="">Select…</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

export function AuthPage({ mode = "login" }: { mode?: string }) {
  const isSignup = mode === "signup";
  const [emailStage, setEmailStage] = useState(false);
  const [agreement, setAgreement] = useState(false);
  const [resetPassword, setResetPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const nextErrors: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = "Enter a valid email address.";
    if (!resetPassword && !password) nextErrors.password = "Enter your password.";
    else if (!resetPassword && isSignup && password.length < 8) nextErrors.password = "Use at least 8 characters.";
    setErrors(nextErrors);
    setMessage("");
    if (Object.keys(nextErrors).length) {
      document.getElementById(nextErrors.email ? "auth-email" : "auth-password")?.focus();
      return;
    }
    setMessage(resetPassword ? "Password reset is unavailable in this local preview. No email was sent." : "This is the local TEZU preview. Your details have not been sent and no account has been created. Explore the studios from the home page.");
  }
  return <div className="tezu-auth">
    <main className="tezu-auth-form-side">
      <Link href="/" className="tezu-auth-back" aria-label="Back to TEZU"><ArrowLeft size={17} /></Link>
      <div className="tezu-auth-inner">
        <Link className="tezu-auth-brand" href="/" aria-label="TEZU home"><img src={asset(logo)} alt="TEZU" width={36} height={36} /></Link>
        <h1>{resetPassword ? "Reset your password" : isSignup ? "Create your TEZU account" : "Welcome back to TEZU"}</h1>
        <p className="tezu-auth-subtitle">{resetPassword ? "Enter your email to reset your password." : isSignup ? "Sign up with Google or email." : "Log in to keep creating."}</p>
        {isSignup && !resetPassword && <div className="tezu-auth-agreement"><label><input type="checkbox" checked={agreement} onChange={(event) => setAgreement(event.target.checked)} /><span>I confirm that I am at least 18 years old and agree to the <Link href="/terms">Terms of Service</Link> and <Link href="/privacy">Privacy Policy</Link>.</span></label><p>Account creation is not available in this preview.</p></div>}
        {!resetPassword && <><button className="tezu-auth-google" type="button" disabled={isSignup && !agreement} onClick={() => setMessage("Google sign-in is unavailable in this local preview. No account connection was made.")}><GoogleLogo />{isSignup ? "Sign up with Google" : "Continue with Google"}</button><div className="tezu-auth-divider"><span />or<span /></div></>}
        {isSignup && !emailStage && !resetPassword ? <button className="tezu-auth-google" type="button" onClick={() => setEmailStage(true)}>Continue with Email</button> : <form className="tezu-auth-form" onSubmit={submitAuth} noValidate>
          <label htmlFor="auth-email">Email<input id="auth-email" name="email" type="email" autoComplete="email" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "auth-email-error" : undefined} onChange={() => setErrors(current => ({ ...current, email: undefined }))} />{errors.email && <span className="auth-field-error" id="auth-email-error" role="alert">{errors.email}</span>}</label>
          {!resetPassword && <div><div className="tezu-auth-password-label"><label htmlFor="auth-password">Password</label>{!isSignup && <button type="button" onClick={() => { setResetPassword(true); setMessage(""); }}>Forgot password?</button>}</div><input id="auth-password" name="password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "auth-password-error" : undefined} onChange={() => setErrors(current => ({ ...current, password: undefined }))} type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 8 : undefined} required />{errors.password && <span className="auth-field-error" id="auth-password-error" role="alert">{errors.password}</span>}</div>}
          <button className="tezu-auth-submit" type="submit" disabled={isSignup && !agreement}>{resetPassword ? "Send reset link" : isSignup ? "Create account" : "Log in"}</button>
        </form>}
        {message && <p className="tezu-auth-feedback" role="status">{message}</p>}
        <p className="tezu-auth-switch">{resetPassword ? <button onClick={() => { setResetPassword(false); setMessage(""); }} type="button">Back to log in</button> : <>{isSignup ? "Already have an account?" : "New to TEZU?"} <Link href={isSignup ? "/auth" : "/auth?mode=signup"}>{isSignup ? "Log in" : "Create an account"}</Link></>}</p>
        <Link className="tezu-auth-home" href="/">Back to tezu.ai</Link>
      </div>
    </main>
    <aside className="tezu-auth-showcase" aria-label="TEZU animation"><video src={asset("/__l5e/assets-v1/41984129-19fb-4ff4-a671-1d7a0985105a/0808_174b-signup.webm")} poster={asset("/__l5e/assets-v1/6c2be909-1ad2-435d-a32d-9b4e8c1a9954/0808_174b-poster.jpg")} autoPlay muted loop playsInline preload="metadata" /><div className="tezu-auth-shade" /><div className="tezu-auth-caption"><h2>Seedance 2.5</h2><p>TEZU animation</p></div></aside>
  </div>;
}

function GoogleLogo() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.37Z" /><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.4l-3.24-2.52c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.6A10 10 0 0 0 12 22Z" /><path fill="#FBBC05" d="M6.4 13.92A6 6 0 0 1 6.08 12c0-.66.11-1.3.32-1.92v-2.6H3.05A10 10 0 0 0 2 12c0 1.62.39 3.15 1.05 4.52l3.35-2.6Z" /><path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.82 1.5l2.86-2.86A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.6C7.19 7.72 9.4 5.96 12 5.96Z" /></svg>;
}
