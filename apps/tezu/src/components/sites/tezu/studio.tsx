"use client";

/* Source media is rendered directly: these are previews, never generated results. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Check, ChevronDown, Clapperboard, Expand, ImagePlus, Info, Plus, RotateCcw, Search, Sparkles, UserRound, X } from "lucide-react";
import { asset } from "./assets";
import "./studio.css";

export type StudioKind = "character" | "image" | "video";
type Model = { name: string; id: string; detail: string; brand: string; tags: string[]; soon?: boolean };
const imageModels: Model[] = [
  { name: "Nano Banana 2", id: "nano-banana-2", detail: "Rich detail", brand: "Google", tags: ["High Quality"] },
  { name: "Nano Banana Pro", id: "nano-banana-pro", detail: "Max fidelity", brand: "Google", tags: ["High Quality"] },
  { name: "Nano Banana 2.1", id: "nano-banana-2.1", detail: "Crisper text · steadier characters", brand: "Google", tags: ["Fast", "High Quality"] },
  { name: "GPT Image 2.5", id: "gpt-image-2.5", detail: "OpenAI · sharp prompts", brand: "OpenAI", tags: ["High Quality"] },
  { name: "GPT Image 2", id: "gpt-image-2", detail: "OpenAI · previous gen", brand: "OpenAI", tags: ["Budget"] },
  { name: "Grok Imagine", id: "grok-imagine", detail: "xAI · text-to-image + edit", brand: "xAI", tags: ["Fast", "Budget"] },
  { name: "Midjourney", id: "midjourney", detail: "Signature MJ aesthetic", brand: "Midjourney", tags: ["High Quality"], soon: true },
  { name: "Grok 2 Image", id: "grok-2-image", detail: "xAI Grok 2 · text-to-image", brand: "xAI", tags: [], soon: true },
  { name: "Seedream 4.0", id: "seedream-4", detail: "Posters & layout", brand: "ByteDance", tags: [], soon: true },
  { name: "Seedream 4.5", id: "seedream-4.5", detail: "Crisp type & key visuals", brand: "ByteDance", tags: [], soon: true },
  { name: "Seedream 5.0 Lite", id: "seedream-5-lite", detail: "Fast · 4K lite", brand: "ByteDance", tags: ["Fast"], soon: true },
  { name: "Wan 2.6", id: "wan-2.6", detail: "T2I + edit · max 3 refs", brand: "Wan", tags: [], soon: true },
];
const videoModels: Model[] = [
  { name: "Seedance 2.5", id: "seedance-2.5", detail: "References · 4–30s · up to 1080p", brand: "ByteDance", tags: ["Cinematic", "High Quality"] },
  { name: "Seedance 2.0", id: "seedance-2", detail: "References · 4–15s · up to 4K", brand: "ByteDance", tags: ["High Quality"] },
  { name: "Seedance 2.0 Fast", id: "seedance-2-fast", detail: "Quickest turnaround · 4–15s", brand: "ByteDance", tags: ["Fast", "Budget"] },
  { name: "MiniMax H3", id: "minimax-h3", detail: "T2V · I2V · refs · soundtrack", brand: "MiniMax", tags: ["Cinematic"] },
  { name: "Wan 3.0", id: "wan-3", detail: "T2V · I2V · refs · 2–30s", brand: "Wan", tags: ["High Quality"] },
  { name: "Wan 3.0 Prime", id: "wan-3-prime", detail: "Faster Wan · 4–30s · soundtrack", brand: "Wan", tags: ["Fast", "Budget"] },
  ...[
    ["Kling O3", "Start/end frames · up to 7 refs", "Kling"], ["Kling 3.0", "Optional start + end frames", "Kling"],
    ["Kling 3.0 4K", "Native 4K · start/end", "Kling"], ["Kling 2.6", "Start frame · 5s or 10s", "Kling"],
    ["Seedance 1.5 Pro", "Start frame · 480p–1080p", "ByteDance"], ["Gemini Omni Flash", "T2V · I2V · refs", "Google"],
    ["Google Veo 3.1", "Start/end · up to 4K", "Google"], ["Google Veo 3.1 Lite", "Start frame · 720p/1080p", "Google"],
    ["OpenAI Sora 2", "Start frame · 4–20s", "OpenAI"], ["Midjourney Video", "I2V · start frame", "Midjourney"],
    ["Vidu Q3", "Start frame · up to 1080p", "Vidu"], ["Wan 2.6", "T2V or refs · 5 max", "Wan"], ["Wan 2.2 I2V", "480p · 5s · 1 image", "Wan"],
  ].map(([name, detail, brand]) => ({ name, id: name.toLowerCase().replaceAll(" ", "-"), detail, brand, tags: [], soon: true })),
];
const boySource = "/__l5e/assets-v1/e4af0ae7-85f0-424b-aec7-9c2770adb268/boy.png";
const girlSource = "/__l5e/assets-v1/dbe53ade-cb32-451d-88d6-ce0ad04c1888/girl.png";
const bannerMedia = {
  character: { poster: "character-teaser-poster.jpg", video: "character-teaser-fixed.webm", label: "TEZU CHARACTER CREATION" },
  image: { poster: "0808_167-poster.jpg", video: "0808_167-compatible.webm", label: "TEZU IMAGE GENERATION" },
  video: { poster: "video-teaser-poster.jpg", video: "video-teaser.mp4", label: "TEZU VIDEO GENERATION" },
};

function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, textarea, select, a[href]");
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); active?.focus(); };
  }, [close]);
  return <div className="tzs-modal-backdrop" onClick={close}><div className={`tzs-modal ${wide ? "tzs-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panel} onClick={event => event.stopPropagation()}><div className="tzs-modal-heading"><h2>{title}</h2><button type="button" className="tzs-icon-button" aria-label={`Close ${title}`} onClick={close}><X size={19} /></button></div>{children}</div></div>;
}

function SelectField({ label, options }: { label: string; options: string[] }) {
  return <label className="tzs-option-label">{label}<select defaultValue={options[0]}>{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

function Segments({ label, values, value, onChange }: { label: string; values: string[]; value: string; onChange: (value: string) => void }) {
  return <fieldset className="tzs-field"><legend>{label}</legend><div className="tzs-segments" role="radiogroup" aria-label={label}>{values.map(item => <button type="button" role="radio" aria-checked={value === item} className={value === item ? "selected" : ""} onClick={() => onChange(item)} key={item}>{item}</button>)}</div></fieldset>;
}

function ModelIcon({ model }: { model: Model }) {
  const filename = model.brand === "Google" ? "model-gemini.svg" : model.brand === "ByteDance" ? "model-bytedance.svg" : model.brand === "OpenAI" ? "model-openai.svg" : model.brand === "MiniMax" ? "model-minimax.svg" : model.brand === "Wan" ? "model-qwen.svg" : "model-grok.svg";
  return <img src={asset(filename)} alt="" width={22} height={22} />;
}

export function Studio({ kind, initialModel, initialPrompt = "", initialRatio, initialDuration }: { kind: StudioKind; initialModel?: string; initialPrompt?: string; initialRatio?: string; initialDuration?: string }) {
  const isCharacter = kind === "character";
  const isVideo = kind === "video";
  const models = isVideo ? videoModels : imageModels;
  const [selectedModel, setSelectedModel] = useState(models.find(model => model.id === initialModel) ?? models[isVideo ? 0 : 2]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [character, setCharacter] = useState("Boy");
  const [advanced, setAdvanced] = useState(false);
  const [workspace, setWorkspace] = useState(isCharacter ? "Preview" : "History");
  const [size, setSize] = useState(55);
  const aspectRatios = isVideo ? ["9:16", "1:1", "16:9", "4:3", "3:4", "21:9"] : ["9:16", "4:5", "1:1", "3:2", "16:9"];
  const [ratio, setRatio] = useState(initialRatio && aspectRatios.includes(initialRatio) ? initialRatio : isVideo ? "9:16" : "4:5");
  const [resolution, setResolution] = useState(isVideo ? "480p" : "2K");
  const [duration, setDuration] = useState(() => {
    const requested = Number(initialDuration);
    const maximum = selectedModel.id.includes("seedance-2") && !selectedModel.id.includes("2.5") ? 15 : 30;
    return isVideo && Number.isFinite(requested) ? Math.max(4, Math.min(maximum, Math.round(requested))) : 4;
  });
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("All");
  const [expanded, setExpanded] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantIdea, setAssistantIdea] = useState("");
  const [assistantStyle, setAssistantStyle] = useState("Cinematic");
  const [assistantFraming, setAssistantFraming] = useState("Auto");
  const [savedOpen, setSavedOpen] = useState(false);
  const [references, setReferences] = useState<{ name: string; url: string }[]>([]);
  const [uploadError, setUploadError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);
  const closeModel = useCallback(() => setModelOpen(false), []);
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  const closeSaved = useCallback(() => setSavedOpen(false), []);
  useEffect(() => () => objectUrls.current.forEach(url => URL.revokeObjectURL(url)), []);
  const title = isCharacter ? "Character" : isVideo ? "Video" : "Image";
  const limit = isCharacter ? 500 : isVideo ? 2000 : 1500;
  const banner = bannerMedia[kind];
  const characterSource = character === "Boy" ? boySource : girlSource;
  const filteredModels = models.filter(model => (modelFilter === "All" || model.brand === modelFilter || model.tags.includes(modelFilter)) && `${model.name} ${model.detail}`.toLowerCase().includes(modelSearch.toLowerCase()));
  const focusPrompt = () => { textarea.current?.focus(); textarea.current?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  function addReferences(files: FileList | File[]) {
    setUploadError("");
    const available = 4 - references.length;
    const list = Array.from(files);
    const valid = list.filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 20 * 1024 * 1024);
    if (valid.length !== list.length) setUploadError("Choose PNG, JPG or WebP images under 20 MB each.");
    if (valid.length > available) setUploadError("You can add up to 4 reference images.");
    const next = valid.slice(0, available).map(file => { const url = URL.createObjectURL(file); objectUrls.current.push(url); return { name: file.name, url }; });
    setReferences(current => [...current, ...next]);
  }
  function removeReference(index: number) {
    const removed = references[index];
    if (removed) {
      URL.revokeObjectURL(removed.url);
      objectUrls.current = objectUrls.current.filter(url => url !== removed.url);
      setReferences(current => current.filter((_, i) => i !== index));
    }
  }
  function chooseModel(model: Model) {
    setSelectedModel(model);
    setModelOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("model", model.id);
    window.history.replaceState(null, "", url);
    if (isVideo && model.id.includes("seedance-2") && !model.id.includes("2.5")) setDuration(current => Math.min(15, current));
  }
  function applyAssistant() {
    const idea = assistantIdea.trim() || prompt.trim();
    if (!idea) return;
    const framing = assistantFraming === "Auto" ? "" : ` ${assistantFraming} framing.`;
    const enhancement = isVideo ? `${idea}. ${assistantStyle} lighting, fluid natural movement, expressive details, and a smooth tracking camera. Keep the character consistent throughout the scene.` : `${idea}. ${assistantStyle} lighting, thoughtful composition, rich detail, balanced colors, and a polished finish.`;
    setPrompt((enhancement + framing).slice(0, limit)); setAssistantOpen(false); focusPrompt();
  }

  return <main className={`tzs-page tzs-${kind}`}>
    <h1 className="tzs-sr-only">{title} Studio</h1>
    <div className="tzs-shell">
      <aside className="tzs-panel" aria-label={`${title} settings`}>
        <div className="tzs-banner"><video autoPlay muted loop playsInline poster={asset(banner.poster)} src={asset(banner.video)} aria-hidden="true" /><span>{banner.label}</span></div>
        <div className="tzs-panel-scroll">
          {isCharacter ? <>
            <fieldset className="tzs-field"><legend>Choose your character</legend><div className="tzs-character-choices" role="radiogroup" aria-label="Character type">{["Boy", "Girl"].map(value => <button key={value} type="button" role="radio" aria-label={value} aria-checked={character === value} onClick={() => setCharacter(value)}><img src={asset(value === "Boy" ? boySource : girlSource)} alt="" /><span>{value}<i>{character === value && <Check size={12} />}</i></span></button>)}</div><p className="tzs-help">Visual reference</p></fieldset>
          </> : <div className="tzs-field"><label>Model</label><button type="button" className="tzs-model-trigger" aria-label={`Model: ${selectedModel.name}. Change model`} aria-expanded={modelOpen} onClick={() => setModelOpen(true)}><ModelIcon model={selectedModel} /><span><strong>{selectedModel.name}</strong><small>{selectedModel.detail}</small></span><ChevronDown size={15} /></button></div>}
          <div className="tzs-field"><label className="tzs-label-count" htmlFor="tzs-prompt">{isCharacter ? "Describe your character" : "Prompt"}{!isCharacter && <small>{prompt.length.toLocaleString()} / {limit.toLocaleString()}</small>}</label><textarea id="tzs-prompt" ref={textarea} value={prompt} maxLength={limit} onChange={event => setPrompt(event.target.value)} rows={5} placeholder={isCharacter ? "Messy black hair, oversized hoodie, blue jeans and a confident smile..." : isVideo ? "Describe your scene, movement, and camera action..." : "Describe the image you want to create..."} />{isCharacter ? <p className="tzs-count">{prompt.length}/500</p> : <>{isVideo && <p className="tzs-help">Who&apos;s in it, what happens, how the camera moves.</p>}<button type="button" className="tzs-small-button" onClick={() => { setAssistantIdea(prompt); setAssistantOpen(true); }}><Sparkles size={14} />Prompt Assistant</button></>}</div>
          {isCharacter ? <>
            <button type="button" className="tzs-more" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>More options<ChevronDown size={15} className={advanced ? "tzs-rotated" : ""} /></button>
            {advanced && <div className="tzs-options"><SelectField label="Age range" options={["Auto", "Child", "Teen", "Young adult", "Adult", "Older adult"]} /><label className="tzs-option-label">Clothing<input placeholder="Optional outfit details" maxLength={160} /></label><SelectField label="Pose" options={["Neutral", "Confident", "Relaxed", "Custom"]} /><SelectField label="Background" options={["Neutral studio", "Warm studio", "Cool studio", "White studio", "Custom"]} /><div className="tzs-options-grid">{["Hair color", "Expression", "Accessories", "Shirt color", "Pants color", "Shoe color"].map(label => <label key={label} className="tzs-option-label">{label}<input placeholder="As described" maxLength={160} /></label>)}</div></div>}
            <p className="tzs-help">Private original · saved after generation</p>
          </> : <>
            <div className="tzs-field"><label className="tzs-label-count">Reference images<small>Optional</small></label><button type="button" className="tzs-drop" onClick={() => upload.current?.click()} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addReferences(event.dataTransfer.files); }}><ImagePlus size={19} /><span>Drop images or click to upload</span><small>PNG, JPG or WebP · up to 20 MB each</small></button><input ref={upload} className="tzs-sr-only" type="file" aria-label="Choose reference images" accept="image/png,image/jpeg,image/webp" multiple onChange={(event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addReferences(event.target.files); event.target.value = ""; }} />{references.length > 0 && <div className="tzs-reference-list">{references.map((reference, index) => <div key={reference.url}><img src={reference.url} alt={reference.name} /><button type="button" aria-label={`Remove ${reference.name}`} onClick={() => removeReference(index)}><X size={12} /></button><small>@Image {index + 1}</small></div>)}</div>}{uploadError && <p className="tzs-upload-error" role="alert">{uploadError}</p>}<div className="tzs-saved-row"><button type="button" className="tzs-small-button" onClick={() => setSavedOpen(true)}><UserRound size={14} />Use saved character</button><small>{references.length}/4</small></div><p className="tzs-help">{isVideo ? "Mention them in your scene, e.g. “the man from @Image 1”. References guide the look — exact likeness isn't guaranteed." : "Say what to keep from each reference, e.g. “the character from my reference, now at a beach café”."}</p></div>
            <Segments label="Aspect ratio" values={aspectRatios} value={ratio} onChange={setRatio} />
            {isVideo && <div className="tzs-field"><label className="tzs-label-count" htmlFor="tzs-duration">Duration<strong>{duration}s</strong></label><input id="tzs-duration" type="range" aria-label="Duration in seconds" min={4} max={selectedModel.id.includes("seedance-2") && !selectedModel.id.includes("2.5") ? 15 : 30} value={duration} onChange={event => setDuration(Number(event.target.value))} /><div className="tzs-range-limits"><span>4s</span><span>{selectedModel.id.includes("seedance-2") && !selectedModel.id.includes("2.5") ? 15 : 30}s</span></div></div>}
            <Segments label="Resolution" values={isVideo ? ["480p", "720p", "1080p"] : ["1K", "2K", "4K"]} value={resolution} onChange={setResolution} />
            <p className="tzs-help">{isVideo ? "Videos include a generated soundtrack. Rendering takes a few minutes — you can leave this page and come back." : "Every finished image is saved privately in My Creations."}</p>
          </>}
        </div>
        <div className="tzs-generate-footer"><button disabled className="tzs-generate" title={`Total cost: ${isCharacter ? 4 : isVideo ? duration * 11 : resolution === "4K" ? 4 : 3} credits`} aria-label={`Generate ${title} — costs ${isCharacter ? 4 : isVideo ? duration * 11 : resolution === "4K" ? 4 : 3} credits`}>{isVideo ? <Clapperboard size={17} /> : <Sparkles size={17} />}<span>Generate {title}</span><small><Sparkles size={12} />{isCharacter ? 4 : isVideo ? duration * 11 : resolution === "4K" ? 4 : 3}</small></button><p>{isCharacter ? "Generation is off pending provider validation and an approved paid test. No credits will be used." : isVideo ? "Video generation opens after our final checks" : "Generation opens shortly"}</p></div>
      </aside>
      <section className="tzs-canvas" aria-label={isCharacter ? "Character results" : "Results"}>
        <div className="tzs-canvas-bar"><div role="tablist" aria-label={isCharacter ? "Character workspace views" : "Workspace views"}>{(isCharacter ? ["Preview", "History"] : ["History", "Gallery"]).map(view => <button role="tab" aria-selected={workspace === view} className={workspace === view ? "selected" : ""} key={view} onClick={() => setWorkspace(view)}>{view}</button>)}</div><Link href={isCharacter ? "/characters" : "/creations"}>{isCharacter ? "My Characters" : "My Creations"}</Link></div>
        {isCharacter && workspace === "Preview" ? <div className="tzs-character-preview"><div className="tzs-preview-toolbar" role="toolbar" aria-label="Character preview controls"><label htmlFor="tzs-preview-size">Size</label><input id="tzs-preview-size" type="range" aria-label="Preview size" value={size} min={30} max={100} onChange={event => setSize(Number(event.target.value))} /><span>{size}%</span><button type="button" className="tzs-icon-button" aria-label="Reset preview size" onClick={() => setSize(55)}><RotateCcw size={16} /></button></div><div className="tzs-sample"><div className="tzs-sample-art"><img src={asset(characterSource)} alt={`TEZU ${character.toLowerCase()} sample turnaround sheet — illustrative preview, not your generated result`} style={{ height: `${size * 8}px` }} /><button type="button" className="tzs-expand" aria-label="Expand sample sheet" onClick={() => setExpanded(true)}><Expand size={16} /></button></div><div className="tzs-sample-details"><div><h2>{character} reference</h2><span>Example</span></div><p>Character reference sheet</p><dl>{[["Style", "Cinematic 3D"], ["Format", "9:16"], ["Views", "5 angles"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><small>Example sheet · not saved to your library</small></div></div></div> : <div className="tzs-results-body">{!isCharacter && workspace !== "Gallery" && <div className="tzs-notice"><Info size={16} /><p><strong>Generation opens shortly.</strong> We&apos;re running final quality and cost checks on our image service. You can explore everything now — no credits are used until it&apos;s on.</p></div>}{workspace === "Gallery" ? <div className="tzs-gallery-empty">Finished {isVideo ? "videos" : "images"} will collect here.</div> : <div className="tzs-empty"><span className="tzs-empty-glow" /><h2>{isCharacter ? "Your characters will appear here." : workspace === "Gallery" ? "Explore what's possible." : isVideo ? "Your next scene starts here." : "Your next creation starts here."}</h2><p>{isCharacter ? "Generated character sheets are saved privately in your history." : workspace === "Gallery" ? "Find inspiration in creations made with TEZU." : isVideo ? "Describe a scene or add a reference to begin." : "Describe your idea to generate an image."}</p>{workspace === "Gallery" ? <Link className="tzs-small-button" href="/#explore"><ImagePlus size={15} />Explore Creations</Link> : <button type="button" className="tzs-small-button" onClick={focusPrompt}><Sparkles size={15} />{isCharacter ? "Describe a character" : "Start describing"}</button>}</div>}</div>}
      </section>
    </div>
    {modelOpen && <Modal title="Choose model" close={closeModel}><div className="tzs-model-search"><Search size={17} /><input aria-label="Search models" placeholder="Search models" value={modelSearch} onChange={event => setModelSearch(event.target.value)} /></div><div className="tzs-model-filters">{["All", "Fast", ...(isVideo ? ["Cinematic"] : []), "High Quality", "Budget", ...Array.from(new Set(models.map(model => model.brand)))].map(filter => <button type="button" key={filter} aria-pressed={modelFilter === filter} className={modelFilter === filter ? "selected" : ""} onClick={() => setModelFilter(filter)}>{filter}</button>)}</div><div className="tzs-model-list" role="listbox" aria-label="Models">{[false, true].map(soon => <div key={String(soon)}><p className="tzs-model-caption">{soon ? "COMING SOON" : "CHOOSE MODEL"}</p>{filteredModels.filter(model => !!model.soon === soon).map(model => <button type="button" key={model.id} role="option" aria-selected={model.id === selectedModel.id} disabled={model.soon} onClick={() => chooseModel(model)}><ModelIcon model={model} /><span><strong>{model.name}{["nano-banana-2.1", "seedance-2.5"].includes(model.id) && <em>Recommended</em>}</strong><small>{model.detail}</small></span>{model.soon ? <b>Soon</b> : selectedModel.id === model.id ? <Check size={17} /> : null}</button>)}</div>)}{filteredModels.length === 0 && <p className="tzs-no-models">No models match your search.</p>}</div></Modal>}
    {expanded && <Modal title={`${character} reference sheet`} wide close={closeExpanded}><img className="tzs-expanded-sheet" src={asset(characterSource)} alt={`${character} sample reference sheet`} /></Modal>}
    {assistantOpen && <Modal title="Prompt Assistant" close={closeAssistant}><div className="tzs-assistant"><div className="tzs-assistant-meta">TEZU · {selectedModel.name}<p>0 generation credits · {title}</p></div><label>Your idea<textarea value={assistantIdea} onChange={event => setAssistantIdea(event.target.value)} placeholder="A simple idea, in your own words…" rows={4} /></label><Segments label="Creative direction" values={["Cinematic", "Realistic", "Animated 3D", "Funny", "Product Commercial"]} value={assistantStyle} onChange={setAssistantStyle} /><details><summary>Advanced direction</summary><label className="tzs-option-label">Framing<select value={assistantFraming} onChange={event => setAssistantFraming(event.target.value)}>{["Auto", "Wide", "Medium", "Close-up"].map(value => <option key={value}>{value}</option>)}</select></label></details><button type="button" className="tzs-primary-button" disabled={!assistantIdea.trim() && !prompt.trim()} onClick={applyAssistant}><Sparkles size={16} />Enhance prompt</button></div></Modal>}
    {savedOpen && <Modal title="Use saved character" close={closeSaved}><div className="tzs-saved-empty"><UserRound size={30} /><h3>No saved characters yet</h3><p>Create a character first, then use it as a reference in your images and videos.</p><Link href="/create/character" className="tzs-primary-button"><Plus size={16} />Create character</Link></div></Modal>}
  </main>;
}
