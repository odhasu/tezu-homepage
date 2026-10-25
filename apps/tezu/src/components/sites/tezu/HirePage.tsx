/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Film, MessageCircle, Play, Sparkles } from "lucide-react";
import { asset } from "./assets";
import { publicContact } from "@/lib/public-contact";
import mediaContent from "./media-content.json";
import "./hire.css";

const examples = [
  { media: mediaContent[0], category: "Character stories" },
  { media: mediaContent[12], category: "Creator content" },
  { media: mediaContent[15], category: "Animated shorts" },
  { media: mediaContent[17], category: "Brand storytelling" },
];

const services = ["Creative direction", "Character design", "AI animation", "Short-form video", "Brand campaigns", "Sound & editing"];

const steps = [
  { title: "One conversation.", text: "Tell us about your audience, your idea, and what you want your content to do. We find the story together.", icon: MessageCircle, note: "Start with the idea" },
  { title: "One clear brief.", text: "We shape the concept, visual direction, and production plan. Scope, timeline, and pricing are agreed before work begins.", icon: Sparkles, note: "Get on the same page" },
  { title: "Your story, ready to post.", text: "We handle production, animation, and editing. You review the work and receive the finished videos for your channels.", icon: Film, note: "Make it yours" },
];

const faqs = [
  { question: "Do I need to film anything?", answer: "For fully animated projects, you do not need to be on camera. We can work from your idea and visual references. If your project needs product images, existing footage, or brand assets, we will agree on those in the brief." },
  { question: "What can we create together?", answer: "Character-led stories, animated shorts, creator content, product stories, and AI-assisted campaigns. Share the style you have in mind, even if it is still an early idea, and we can work out the right approach." },
  { question: "How much does a project cost?", answer: "Studio work is quoted for the project. The number of videos, complexity, length, and production needs all affect the scope. Include an estimated budget in your brief if you have one; pricing is agreed before production starts." },
  { question: "How long does production take?", answer: "Timing depends on the creative direction, number of videos, and feedback rounds. Tell us about any deadline in your brief so we can discuss a realistic schedule before you commit." },
  { question: "What happens after I create my brief?", answer: "You can review, edit, and copy your brief here. This preview does not send an inquiry or upload your details. When you are happy with it, contact @nateassets on Instagram and share the copied brief to start a conversation." },
  { question: "Can I use the finished videos commercially?", answer: "Usage rights, deliverables, and any restrictions are agreed in the project terms before production. Let us know where you plan to publish or advertise so the scope can cover your intended use." },
];

interface InquiryDraft {
  name: string;
  email: string;
  handle: string;
  niche: string;
  phone: string;
  budget: string;
  timeline: string;
  description: string;
}

type InquiryKey = keyof InquiryDraft;
type InquiryErrors = Partial<Record<InquiryKey, string>>;

const emptyDraft: InquiryDraft = { name: "", email: "", handle: "", niche: "", phone: "", budget: "", timeline: "", description: "" };
const fieldNames: Record<InquiryKey, string> = { name: "Name", email: "Email", handle: "Instagram handle", niche: "Niche", phone: "Phone", budget: "Budget", timeline: "Timeline", description: "Project description" };

export function HirePage() {
  const [activeExample, setActiveExample] = useState<number | null>(null);
  const [draft, setDraft] = useState<InquiryDraft>(emptyDraft);
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [reviewing, setReviewing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const errorRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  const briefText = `TEZU project brief\n\n${(Object.keys(fieldNames) as InquiryKey[]).map((key) => `${fieldNames[key]}: ${draft[key].trim() || "Not specified"}`).join("\n")}`;

  useEffect(() => {
    if (reviewing) reviewRef.current?.focus();
  }, [reviewing]);

  useEffect(() => {
    if (copyStatus === "error") {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }
  }, [copyStatus]);

  function updateField(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const key = event.currentTarget.name as InquiryKey;
    const value = event.currentTarget.value;
    setDraft((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    setCopyStatus("idle");
  }

  function reviewBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: InquiryErrors = {};
    if (!draft.name.trim()) nextErrors.name = "Enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) nextErrors.email = "Enter a valid email address.";
    if (!draft.handle.trim()) nextErrors.handle = "Add your Instagram handle, or write ‘no Instagram’.";
    if (!draft.niche.trim()) nextErrors.niche = "Tell us your niche or industry.";
    if (!draft.description.trim()) nextErrors.description = "Tell us a little about the project you have in mind.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setReviewing(true);
    setCopyStatus("idle");
  }

  async function copyBrief() {
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(briefText);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  function editBrief() {
    setReviewing(false);
    setCopyStatus("idle");
    requestAnimationFrame(() => document.getElementById("hire-name")?.focus());
  }

  return (
    <main className="hire-studio">
      <section className="hire-studio-hero hire-studio-width" aria-labelledby="hire-title">
        <div className="hire-studio-hero-copy" data-reveal>
          <span className="hire-studio-eyebrow"><img src={asset("tezu-white-knot-logo.png")} alt="" width="20" height="20" /> THE TEZU STUDIO</span>
          <h1 id="hire-title">Big ideas.<br />Zero filming.<br /><span>All you.</span></h1>
          <p>Short-form stories made for your world. We bring the creative direction, animation, and production. You bring the idea.</p>
          <div className="hire-studio-actions">
            <a className="hire-studio-button hire-studio-primary" href="#inquiry">Let&apos;s make something <ArrowUpRight size={18} aria-hidden="true" /></a>
            <a className="hire-studio-work-link" href="#studio-work">See what&apos;s possible <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <div className="hire-studio-hero-note"><span /> For creators, brands, and the stories in between.</div>
        </div>
        <div className="hire-studio-hero-art" aria-hidden="true" data-reveal>
          <div className="hire-studio-art-label"><span className="hire-studio-art-dot" /> FROM IDEA TO PLAY</div>
          <div className="hire-studio-art-frame hire-studio-art-back"><img src={asset(examples[1].media.poster)} alt="" /></div>
          <div className="hire-studio-art-frame hire-studio-art-front"><img src={asset(examples[0].media.poster)} alt="" /><span><Play size={15} fill="currentColor" /> A story worth stopping for.</span></div>
          <div className="hire-studio-art-stamp"><img src={asset("tezu-white-knot-logo.png")} alt="" width="28" height="28" /><span>YOUR VISION.<br /><strong>OUR PRODUCTION.</strong></span><ArrowUpRight size={18} /></div>
        </div>
      </section>

      <section className="hire-studio-services" aria-label="Studio services"><div className="hire-studio-width"><span>Made with TEZU</span><div>{services.map((service) => <span key={service}><span aria-hidden="true">✦</span>{service}</span>)}</div></div></section>

      <section className="hire-studio-work hire-studio-width" id="studio-work" aria-labelledby="hire-work-title">
        <div className="hire-studio-section-top" data-reveal>
          <div><p className="hire-studio-eyebrow">A LITTLE OF WHAT&apos;S POSSIBLE</p><h2 id="hire-work-title">Stories with<br /><span>a life of their own.</span></h2></div>
          <p>Different worlds. The same attention to every frame.<br />Explore a few TEZU examples.</p>
        </div>
        <div className="hire-studio-example-grid" data-reveal>
          {examples.map(({ media, category }, index) => <ExampleCard key={media.video} media={media} category={category} index={index} active={activeExample === index} onPlay={() => setActiveExample(index)} onStop={() => setActiveExample(null)} />)}
        </div>
        <div className="hire-studio-work-foot"><span>TEZU examples · Click to watch</span><Link href="/creations">Explore more work <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
      </section>

      <section className="hire-studio-process" aria-labelledby="hire-process-title">
        <div className="hire-studio-width">
          <div className="hire-studio-process-heading" data-reveal><p className="hire-studio-eyebrow">LESS BACK-AND-FORTH. MORE CREATING.</p><h2 id="hire-process-title">You have a story.<br /><span>We make it happen.</span></h2></div>
          <div className="hire-studio-step-grid">{steps.map(({ title, text, icon: Icon, note }, index) => <article className="hire-studio-step" key={title} data-reveal><div className="hire-studio-step-top"><span className="hire-studio-step-icon"><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></span><span>0{index + 1}</span></div><h3>{title}</h3><p>{text}</p><span className="hire-studio-step-note">{note}<ArrowRight size={15} aria-hidden="true" /></span></article>)}</div>
        </div>
      </section>

      <section className="hire-studio-inquiry hire-studio-width" id="inquiry" aria-labelledby="hire-inquiry-title">
        <div className="hire-studio-inquiry-copy" data-reveal>
          <p className="hire-studio-eyebrow">YOUR NEXT STORY STARTS HERE</p>
          <h2 id="hire-inquiry-title">Let&apos;s make<br /><span>something move.</span></h2>
          <p>A character you can&apos;t stop thinking about. A new way to tell your brand&apos;s story. That idea sitting in your notes app.</p>
          <p>Tell us what you&apos;re imagining. We&apos;ll help you shape the next step.</p>
          <div className="hire-studio-inquiry-note"><span><img src={asset("tezu-white-knot-logo.png")} alt="" width="30" height="30" /></span><div><strong>Your idea. A dedicated creative team.</strong><p>Direction, animation, and finishing touches, all in one place.</p></div></div>
          <a className="hire-studio-contact" href={publicContact.instagram} target="_blank" rel="noreferrer">Prefer a conversation? Find us on Instagram <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
        <div className="hire-studio-form-panel" data-reveal>
          <div className="hire-studio-form-top"><span>{reviewing ? "02 / YOUR BRIEF" : "01 / THE INTRODUCTION"}</span><span>TEZU STUDIO <span aria-hidden="true">↗</span></span></div>
          {reviewing ? <div className="hire-studio-review">
            <span className="hire-studio-review-check"><Check size={22} aria-hidden="true" /></span>
            <h3 ref={reviewRef} tabIndex={-1}>Your brief is ready.<br />Nothing has been sent.</h3>
            <p>Take a look, make it yours, then copy your brief to share with <a href={publicContact.instagram} target="_blank" rel="noreferrer">@nateassets <ArrowUpRight size={13} aria-hidden="true" /></a> on Instagram.</p>
            <dl>{(Object.keys(fieldNames) as InquiryKey[]).filter((key) => draft[key].trim()).map((key) => <div key={key}><dt>{fieldNames[key]}</dt><dd>{draft[key]}</dd></div>)}</dl>
            <div className="hire-studio-review-actions"><button type="button" className="hire-studio-button hire-studio-primary" onClick={copyBrief} disabled={copyStatus === "copying"} aria-busy={copyStatus === "copying"}>{copyStatus === "copied" ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}{copyStatus === "copying" ? "Copying…" : copyStatus === "copied" ? "Brief copied" : "Copy my brief"}</button><button type="button" className="hire-studio-edit" onClick={editBrief}>Edit my details <ArrowUpRight size={15} aria-hidden="true" /></button></div>
            <p className="hire-studio-copy-status" role="status">{copyStatus === "copied" ? "Copied. You can now paste your brief into a conversation." : copyStatus === "error" ? "Your browser could not copy the brief. Select and copy the text below." : "Your details stay in this page until you choose to share them."}</p>
            {copyStatus === "copied" && <Link className="hire-studio-finish" href="/thank-you">Next steps for your story <ArrowUpRight size={14} aria-hidden="true" /></Link>}
            {copyStatus === "error" && <textarea className="hire-studio-manual-copy" ref={manualCopyRef} value={briefText} readOnly rows={10} aria-label="Project brief to copy manually" />}
          </div> : <form className="hire-studio-form" onSubmit={reviewBrief} noValidate>
            <div className="hire-studio-form-intro"><h3>Tell us a little about you.</h3><p>No perfect pitch needed. A few details is a great start.</p></div>
            {Object.values(errors).some(Boolean) && <div className="hire-studio-error-summary hire-studio-full" ref={errorRef} tabIndex={-1} role="alert"><strong>A few details need a second look.</strong><ul>{(Object.keys(errors) as InquiryKey[]).filter((key) => errors[key]).map((key) => <li key={key}><a href={`#hire-${key}`}>{errors[key]}</a></li>)}</ul></div>}
            <InquiryField name="name" label="Your name" autoComplete="name" placeholder="Alex" draft={draft} errors={errors} onChange={updateField} required />
            <InquiryField name="email" label="Email address" type="email" autoComplete="email" placeholder="alex@yourbrand.com" draft={draft} errors={errors} onChange={updateField} required />
            <InquiryField name="handle" label="Instagram handle" autoComplete="off" placeholder="@yourhandle" draft={draft} errors={errors} onChange={updateField} required />
            <InquiryField name="niche" label="Your niche" placeholder="Fashion, gaming, fitness…" draft={draft} errors={errors} onChange={updateField} required />
            <InquiryField name="phone" label="Phone number" type="tel" autoComplete="tel" placeholder="Include your country code" draft={draft} errors={errors} onChange={updateField} />
            <label className="hire-studio-field" htmlFor="hire-budget"><span>Estimated budget <span className="hire-studio-optional">optional</span></span><select id="hire-budget" name="budget" value={draft.budget} onChange={updateField}><option value="">Select a range</option>{["Under $500", "$500–$2,000", "$2,000–$5,000", "$5,000+", "Let's discuss"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="hire-studio-field hire-studio-full" htmlFor="hire-description"><span>What do you have in mind? <span className="hire-studio-required" aria-hidden="true">*</span></span><textarea id="hire-description" name="description" rows={4} placeholder="The idea, the audience, the feeling. Share anything that helps us picture it." value={draft.description} onChange={updateField} required aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "hire-description-error" : undefined} />{errors.description && <span id="hire-description-error" className="hire-studio-field-error">{errors.description}</span>}</label>
            <label className="hire-studio-field hire-studio-full" htmlFor="hire-timeline"><span>When do you need it? <span className="hire-studio-optional">optional</span></span><select id="hire-timeline" name="timeline" value={draft.timeline} onChange={updateField}><option value="">Choose a timeline</option>{["I'm flexible", "Within a month", "1–3 months", "Let's work it out"].map((value) => <option key={value}>{value}</option>)}</select></label>
            <div className="hire-studio-submit hire-studio-full"><button type="submit" className="hire-studio-button hire-studio-primary">Review my project brief <ArrowUpRight size={18} aria-hidden="true" /></button><p>This creates a local brief. Your details are not sent or saved to a server. <Link href="/privacy">Privacy policy</Link></p></div>
          </form>}
        </div>
      </section>

      <section className="hire-studio-faq hire-studio-width" aria-labelledby="hire-faq-title">
        <div data-reveal><p className="hire-studio-eyebrow">A FEW GOOD QUESTIONS</p><h2 id="hire-faq-title">Before we<br /><span>press play.</span></h2><p>Something else on your mind?<br /><a href="#inquiry">Put it in your brief <ArrowUpRight size={14} aria-hidden="true" /></a></p></div>
        <div className="hire-studio-faq-list" data-reveal>{faqs.map(({ question, answer }) => <details key={question}><summary><span>{question}</span><ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div>
      </section>
    </main>
  );
}

interface InquiryFieldProps {
  name: InquiryKey;
  label: string;
  draft: InquiryDraft;
  errors: InquiryErrors;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}

function InquiryField({ name, label, draft, errors, onChange, type = "text", autoComplete, placeholder, required = false }: InquiryFieldProps) {
  return <label className="hire-studio-field" htmlFor={`hire-${name}`}><span>{label} {required ? <span className="hire-studio-required" aria-hidden="true">*</span> : <span className="hire-studio-optional">optional</span>}</span><input id={`hire-${name}`} name={name} type={type} autoComplete={autoComplete} placeholder={placeholder} value={draft[name]} onChange={onChange} required={required} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `hire-${name}-error` : undefined} />{errors[name] && <span className="hire-studio-field-error" id={`hire-${name}-error`}>{errors[name]}</span>}</label>;
}

function ExampleCard({ media, category, index, active, onPlay, onStop }: { media: (typeof mediaContent)[number]; category: string; index: number; active: boolean; onPlay: () => void; onStop: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);

  useEffect(() => {
    if (!active) videoRef.current?.pause();
  }, [active]);

  async function play() {
    setPlaybackError(false);
    onPlay();
    try {
      await videoRef.current?.play();
    } catch {
      onStop();
      setPlaybackError(true);
    }
  }

  return <article className="hire-studio-example"><div className={`hire-studio-example-media${active ? " is-playing" : ""}`}><video ref={videoRef} src={asset(media.video)} poster={asset(media.poster)} controls={active} playsInline preload="none" aria-label={`TEZU example: ${media.title.trim()}`} onEnded={onStop} onError={() => { if (active) onStop(); setPlaybackError(true); }} />{!active && <button type="button" className="hire-studio-example-play" onClick={play} aria-label={`Play TEZU example ${index + 1}: ${media.title.trim()}`}><span><Play size={20} fill="currentColor" aria-hidden="true" /></span></button>}<span className="hire-studio-example-number">TEZU / 0{index + 1}</span>{playbackError && <p className="hire-studio-playback-error" role="status">The preview couldn&apos;t play. Try again.</p>}</div><div className="hire-studio-example-caption"><h3>{category}</h3><ArrowUpRight size={17} aria-hidden="true" /></div></article>;
}
