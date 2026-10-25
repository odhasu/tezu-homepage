"use client";

/* Reference thumbnails use local object URLs. Example art is existing TEZU media. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowRight, Check, Clapperboard, FileText, ImageIcon, Layers3, PencilLine, Sparkles, Upload, UserRound, X } from "lucide-react";
import { asset } from "./assets";
import "./creation-engine.css";

type EngineKind = "character" | "image" | "video";
type MediaKind = Exclude<EngineKind, "character">;
type Reference = { name: string; url: string; size: number };
type ModelOption = { id: string; name: string };

const modes: { id: EngineKind; label: string; icon: typeof UserRound }[] = [
  { id: "character", label: "Character", icon: UserRound },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Clapperboard },
];

// IDs match the available models in studio.tsx and the /create/[kind] query.
const modelOptions: Record<MediaKind, ModelOption[]> = {
  image: [
    { id: "nano-banana-2.1", name: "Nano Banana 2.1" },
    { id: "nano-banana-2", name: "Nano Banana 2" },
    { id: "nano-banana-pro", name: "Nano Banana Pro" },
    { id: "gpt-image-2.5", name: "GPT Image 2.5" },
    { id: "gpt-image-2", name: "GPT Image 2" },
    { id: "grok-imagine", name: "Grok Imagine" },
  ],
  video: [
    { id: "seedance-2.5", name: "Seedance 2.5" },
    { id: "seedance-2", name: "Seedance 2.0" },
    { id: "seedance-2-fast", name: "Seedance 2.0 Fast" },
    { id: "minimax-h3", name: "MiniMax H3" },
    { id: "wan-3", name: "Wan 3.0" },
    { id: "wan-3-prime", name: "Wan 3.0 Prime" },
  ],
};

const examples: Record<EngineKind, { poster: string; title: string; caption: string; alt: string }> = {
  character: { poster: "boy.png", title: "A character worth following.", caption: "Give your story someone to begin with.", alt: "Existing TEZU boy character reference sheet, shown as an example" },
  image: { poster: "0808_167-poster.jpg", title: "Every detail has a direction.", caption: "Find the light, the framing, the feeling.", alt: "Existing TEZU image studio composition, shown as an example" },
  video: { poster: "video-teaser-poster.jpg", title: "Think in scenes.", caption: "Start with a moment. Give it somewhere to go.", alt: "Existing TEZU video scene, shown as a still example" },
};

const promptLimits: Record<EngineKind, number> = { character: 400, image: 1400, video: 1900 };
const workflow = [
  { label: "Script", detail: "Put the idea into words", icon: FileText },
  { label: "Direction", detail: "Give it a point of view", icon: Layers3 },
  { label: "Review", detail: "Bring the brief together", icon: Check },
  { label: "Studio", detail: "Keep creating in TEZU", icon: Sparkles },
];

export function CreationEngine() {
  const [kind, setKind] = useState<EngineKind>("video");
  const [drafts, setDrafts] = useState<Record<EngineKind, string>>({ character: "", image: "", video: "" });
  const [selectedModels, setSelectedModels] = useState<Record<MediaKind, string>>({ image: "nano-banana-2.1", video: "seedance-2.5" });
  const [style, setStyle] = useState("Cinematic");
  const [ratios, setRatios] = useState<Record<MediaKind, string>>({ image: "4:5", video: "9:16" });
  const [duration, setDuration] = useState("8");
  const [reference, setReference] = useState<Reference | null>(null);
  const [referenceError, setReferenceError] = useState("");
  const [promptError, setPromptError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const objectUrl = useRef<string | null>(null);

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  useEffect(() => {
    if (reviewed) reviewHeading.current?.focus();
  }, [reviewed]);

  const prompt = drafts[kind];
  const currentMode = modes.find(mode => mode.id === kind) ?? modes[2];
  const example = examples[kind];
  const selectedModel = kind === "character" ? undefined : modelOptions[kind].find(model => model.id === selectedModels[kind]);
  const currentStep = reviewed ? 2 : prompt.trim() ? 1 : 0;
  const ratio = kind === "character" ? undefined : ratios[kind];
  const directionPrompt = [
    prompt.trim(),
    `Visual style: ${style}.`,
  ].join("\n\n");
  const query = new URLSearchParams({ prompt: directionPrompt });
  if (selectedModel) query.set("model", selectedModel.id);
  if (ratio) query.set("ratio", ratio);
  if (kind === "video") query.set("duration", duration);
  const studioHref = `/create/${kind}?${query.toString()}`;

  function chooseKind(next: EngineKind) {
    setKind(next);
    setPromptError("");
    setReviewed(false);
  }

  function addReference(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setReferenceError("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setReferenceError("This image is too large. Choose one under 20 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = url;
    setReference({ name: file.name, url, size: file.size });
    setReferenceError("");
    setReviewed(false);
  }

  function removeReference() {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setReference(null);
    setReferenceError("");
    setReviewed(false);
  }

  function reviewDirection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) {
      setPromptError("Add a few words about what you want to create.");
      textarea.current?.focus();
      return;
    }
    setPromptError("");
    setReviewed(true);
    reviewHeading.current?.focus();
  }

  function editDirection() {
    setReviewed(false);
    textarea.current?.focus();
  }

  return (
    <section className="creation-engine" id="tools" aria-labelledby="engine-title">
      <div className="engine-inner">
        <div className="engine-heading" data-reveal>
          <span className="eyebrow">Inside the engine</span>
          <h2 id="engine-title">A first line.<br className="engine-heading-break" /> A whole new world.</h2>
          <p>Write the idea. Find its look. Bring your direction into the studio. A little structure for whatever&apos;s next.</p>
        </div>

        <ol className="engine-workflow" aria-label="Your creative workflow" data-reveal>
          {workflow.map((step, index) => {
            const Icon = step.icon;
            return <li key={step.label} className={index === currentStep ? "is-current" : index < currentStep ? "is-complete" : ""} aria-current={index === currentStep ? "step" : undefined}><span className="engine-workflow-icon"><Icon size={16} aria-hidden="true" /></span><div><span className="engine-workflow-label"><small>0{index + 1}</small>{step.label}</span><p>{step.detail}</p></div></li>;
          })}
        </ol>

        <div className="engine-workspace" data-reveal>
          <form className="engine-form" onSubmit={reviewDirection} noValidate>
            <div className="engine-form-heading"><span><Sparkles size={15} aria-hidden="true" />Your creative brief</span><span>LOCAL PREVIEW</span></div>
            <div className="engine-mode-grid" role="group" aria-label="Choose what to create">
              {modes.map(mode => {
                const Icon = mode.icon;
                return <button key={mode.id} type="button" aria-pressed={kind === mode.id} onClick={() => chooseKind(mode.id)}><Icon size={16} aria-hidden="true" />{mode.label}</button>;
              })}
            </div>

            <div className="engine-prompt-label"><label htmlFor="engine-prompt">{currentMode.label} direction</label><span>{prompt.length.toLocaleString("en-US")} / {promptLimits[kind].toLocaleString("en-US")}</span></div>
            <textarea
              id="engine-prompt"
              ref={textarea}
              value={prompt}
              onChange={event => { setDrafts(current => ({ ...current, [kind]: event.target.value })); setPromptError(""); setReviewed(false); }}
              placeholder={kind === "video" ? "A quiet city after the rain. Our character steps into the neon light. The camera follows..." : kind === "image" ? "A sunlit room, an unexpected character, a detail that makes you look twice..." : "A character with messy hair, a well-worn jacket, and a story in their eyes..."}
              rows={5}
              maxLength={promptLimits[kind]}
              aria-invalid={!!promptError}
              aria-describedby={promptError ? "engine-prompt-error" : "engine-prompt-help"}
            />
            {promptError ? <p className="engine-error" id="engine-prompt-error" role="alert">{promptError}</p> : <p className="engine-field-help" id="engine-prompt-help">{kind === "video" ? "Think subject, action, atmosphere and camera movement." : kind === "image" ? "Think subject, setting, composition and light." : "Think appearance, personality, outfit and expression."}</p>}

            <div className={`engine-options${kind === "character" ? " engine-options-character" : ""}`}>
              {kind !== "character" && <label>Model<select value={selectedModels[kind]} onChange={event => { setSelectedModels(current => ({ ...current, [kind]: event.target.value })); setReviewed(false); }}>{modelOptions[kind].map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>}
              <label>Visual style<select value={style} onChange={event => { setStyle(event.target.value); setReviewed(false); }}>{["Cinematic", "3D Animation", "Photoreal", "Editorial", "Dreamlike"].map(value => <option key={value}>{value}</option>)}</select></label>
              {kind !== "character" && <label>Aspect ratio<select value={ratios[kind]} onChange={event => { setRatios(current => ({ ...current, [kind]: event.target.value })); setReviewed(false); }}>{(kind === "video" ? ["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"] : ["4:5", "9:16", "1:1", "3:2", "16:9"]).map(value => <option key={value}>{value}</option>)}</select></label>}
              {kind === "video" && <label>Scene length<select value={duration} onChange={event => { setDuration(event.target.value); setReviewed(false); }}>{["4", "8", "12"].map(value => <option key={value} value={value}>{value} seconds</option>)}</select></label>}
            </div>

            <div className="engine-reference-area">
              <button type="button" className="engine-reference-button" onClick={() => upload.current?.click()} aria-describedby="engine-reference-help"><Upload size={15} aria-hidden="true" />{reference ? "Replace reference" : "Add a reference"}<span>Optional</span></button>
              <input ref={upload} type="file" accept="image/jpeg,image/png,image/webp" onChange={addReference} aria-label="Choose a local reference image" hidden />
              <p className="engine-field-help" id="engine-reference-help">JPG, PNG or WebP · under 20 MB · stays in this page</p>
              {reference && <div className="engine-reference-preview"><img src={reference.url} alt={`Local reference: ${reference.name}`} onError={() => { removeReference(); setReferenceError("This image could not be opened. Try a different JPG, PNG or WebP."); }} /><div><strong>{reference.name}</strong><span>{(reference.size / 1024 / 1024).toFixed(1)} MB · local reference</span></div><button type="button" aria-label={`Remove reference ${reference.name}`} onClick={removeReference}><X size={16} aria-hidden="true" /></button></div>}
              {referenceError && <p className="engine-error" role="alert">{referenceError}</p>}
            </div>

            <button type="submit" className="engine-review-button">Review direction<ArrowRight size={17} aria-hidden="true" /></button>
            <p className="engine-local-note">Shape the brief here. Continue in Studio when you&apos;re ready.</p>
          </form>

          {reviewed ? (
            <section className="engine-review" aria-labelledby="engine-review-heading">
              <div className="engine-review-topline"><span><Check size={14} aria-hidden="true" />Direction, together.</span><span>03 / REVIEW</span></div>
              <div className="engine-review-body">
                <h3 id="engine-review-heading" tabIndex={-1} ref={reviewHeading}>Ready for the<br />next chapter.</h3>
                <p className="engine-review-description">Your idea, with a little more direction.</p>
                <blockquote tabIndex={0} aria-label="Your direction">{prompt.trim()}</blockquote>
                <dl className="engine-review-settings">
                  <div><dt>Canvas</dt><dd>{currentMode.label}</dd></div>
                  <div><dt>Style</dt><dd>{style}</dd></div>
                  {selectedModel && <div><dt>Model</dt><dd>{selectedModel.name}</dd></div>}
                  {ratio && <div><dt>Format</dt><dd>{ratio}{kind === "video" && ` · ${duration}s`}</dd></div>}
                </dl>
                {reference && <div className="engine-review-reference"><img src={reference.url} alt="Your local reference thumbnail" /><p>Reference stays in this page.<br /><span>Add it again when you open Studio.</span></p></div>}
                <p className="engine-review-notice">Your prompt, model and output settings carry into Studio. Add your reference there when you&apos;re ready.</p>
              </div>
              <div className="engine-review-actions"><button type="button" onClick={editDirection}><PencilLine size={15} aria-hidden="true" />Edit direction</button><Link href={studioHref} prefetch={false}>Open {currentMode.label} Studio<ArrowRight size={16} aria-hidden="true" /></Link></div>
            </section>
          ) : (
            <div className={`engine-inspiration engine-inspiration-${kind}`}>
              <div className="engine-inspiration-topline"><span><Layers3 size={15} aria-hidden="true" />Direction board</span><span>EXAMPLE ART</span></div>
              <div className="engine-example-image"><img src={asset(example.poster)} alt={example.alt} loading="lazy" /><span className="engine-example-label">TEZU / {currentMode.label.toUpperCase()}</span></div>
              <div className="engine-inspiration-copy"><span className="eyebrow">The possibility starts here</span><h3>{example.title}</h3><p>{example.caption}</p><div><span><ImageIcon size={12} aria-hidden="true" />Existing TEZU example</span><span>Your brief comes next<ArrowRight size={12} aria-hidden="true" /></span></div></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
