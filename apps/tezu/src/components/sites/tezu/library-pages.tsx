/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, Copy, Crown, Gift, Globe, ImageIcon, Info, LockKeyhole, LogOut, Mars, Palette, Plus, Search, Shuffle, Sparkles, TriangleAlert, Upload, UserRound, Users, Venus, WandSparkles, X } from "lucide-react";
import mediaContent from "./media-content.json";
import { asset } from "./assets";
import "./library-pages.css";

export const templateDefinitions = mediaContent.filter((item) => item.kind === "template").map((item) => ({
  ...item,
  slug: item.title.toLowerCase().replaceAll(" ", "-"),
  people: Number.parseInt(item.text, 10),
}));

type TemplateDefinition = typeof templateDefinitions[number];

function TemplateCard({ template, index }: { template: TemplateDefinition; index: number }) {
  return <Link className={`library-template-card ${index % 3 === 1 ? "short-card" : ""}`} href={`/templates/${template.slug}`} aria-label={`${template.title}, ${template.people} ${template.people === 1 ? "person" : "people"}`}>
    <video src={asset(template.video)} poster={asset(template.poster)} muted autoPlay loop playsInline preload="metadata" />
    <span className="template-people"><Users size={12} /> {template.people}</span>
    <span className="template-card-caption"><strong>{template.title}</strong><small>1 SHOT</small></span>
  </Link>;
}

export function TemplatesPage() {
  return <main className="tezu-library templates-page">
    <header className="library-page-heading"><h1>Explore <em>Templates</em></h1><p>Browse template previews. Character uploads and video generation are coming soon.</p></header>
    <section className="living-worlds-banner"><div><p>COZY ANIMATIONS · STORYBOOK SCENES · RELAXING WORLDS</p><h2>Living Worlds</h2><span>Original illustrated worlds · Coming soon.</span></div><Link className="library-primary-button" href="/create/worlds"><Sparkles size={16} />Explore Living Worlds <ArrowRight size={16} /></Link></section>
    <div className="library-template-masonry">{templateDefinitions.map((template, index) => <TemplateCard template={template} index={index} key={template.slug} />)}</div>
  </main>;
}

export function TemplateDetailPage({ slug }: { slug: string }) {
  const template = templateDefinitions.find((item) => item.slug === slug);
  if (!template) return null;
  return <main className="tezu-library template-detail-page">
    <p className="template-detail-note"><strong>Template preview · Coming soon.</strong> These clips are supplied examples, not verified TEZU-generated results. Generation and photo uploads are unavailable.</p>
    <div className="template-detail-grid">
      <aside className="template-detail-controls">
        <div className="template-setting-preview"><video src={asset(template.video)} poster={asset(template.poster)} autoPlay muted loop playsInline preload="metadata" /><strong>{template.title}</strong></div>
        <div className="template-photos-label"><h2>Photos</h2><span>0/{template.people}</span></div>
        <div className="template-upload-grid">{Array.from({ length: template.people }, (_, index) => <div className={`template-upload-card person-${index + 1}`} key={index}><ImageIcon size={21} /><strong>Person {index + 1}</strong><span>Replaces the {["purple", "blue", "yellow"][index]} person</span><small><Upload size={10} /> Coming soon</small></div>)}</div>
        <p className="template-setting-label">Resolution</p><div className="template-resolution">{["480p", "720p", "1080p"].map((resolution) => <button key={resolution} type="button" disabled className={resolution === "720p" ? "selected" : ""}>{resolution}</button>)}</div><p className="template-planned-model">Planned model: Seedance 2.5 · not connected.</p>
        <p className="template-disabled-notice"><TriangleAlert size={13} /> Template generation is unavailable. No credits are charged for previews.</p><label className="template-understand"><input type="checkbox" disabled /> I understand, results may vary</label><button className="library-primary-button" type="button" disabled>Generate</button><p className="template-preview-disclaimer">Preview only · Template generation is coming soon. No credits will be charged.</p>
      </aside>
      <section className="template-preview-area"><div className="template-preview-bar"><div><span className="selected">History</span><span>How it works</span></div><strong>{template.title}</strong></div><div className="template-preview-empty"><h1>Preview<br /><em>{template.title}</em></h1><p>Template generation is coming soon. Your existing creations are unchanged.</p></div></section>
      <aside className="template-suggestions"><h2>Templates</h2><div>{templateDefinitions.map((item, index) => <div className={item.slug === slug ? "selected-template" : ""} key={item.slug}>{item.slug === slug && <span className="template-selected-label">Selected</span>}<TemplateCard template={item} index={index - index % 3 + 2} /></div>)}</div></aside>
    </div>
  </main>;
}

const worldThemes = ["Surprise me", "Cozy forest campfire", "Giant fantasy treehouse", "Magical library", "Rainy nighttime cabin", "Floating pirate village", "Enchanted castle", "Underground glowing cave", "Lakeside camping village", "Magical nighttime market", "Cozy fantasy inn", "Snowy mountain lodge", "Hidden woodland village"];

export function WorldsPage() {
  const [ownWorld, setOwnWorld] = useState(false);
  const [theme, setTheme] = useState(worldThemes[0]);
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(4);
  return <main className="tezu-library library-worlds-page">
    <div className="world-stage">
      <header className="world-heading"><p>Viral Cartoons</p><h1>Create your next world.</h1><span>Generate an image. Pick your favorite. Make it yours.</span></header>
      <div className="world-workspace">
        <section className="world-settings"><h2>1. Create an image</h2><div className="world-mode"><button type="button" className={!ownWorld ? "selected" : ""} onClick={() => setOwnWorld(false)}><Shuffle size={16} />Surprise Me</button><button type="button" className={ownWorld ? "selected" : ""} onClick={() => setOwnWorld(true)}>My Own World</button></div><label>Theme<select value={theme} onChange={(event) => setTheme(event.target.value)}>{worldThemes.map((item) => <option key={item}>{item}</option>)}</select></label>{ownWorld && <label>Describe your world<textarea rows={4} maxLength={500} placeholder="A cozy world with…" /></label>}<label>Aspect ratio</label><div className="world-aspects">{["9:16", "1:1", "16:9"].map((item) => <button key={item} type="button" aria-pressed={aspect === item} onClick={() => setAspect(item)}>{item}{item === "9:16" && <small>Recommended</small>}</button>)}</div><label>Image generations</label><div className="world-counts">{[1,2,3,4].map((item) => <button key={item} type="button" aria-pressed={count === item} onClick={() => setCount(item)}>{item}{item === 4 && <small>Best odds</small>}</button>)}</div><p className="world-helper">Roughly half of attempts fail, so 4 gives you the best odds of a keeper.</p><p className="world-helper">Nano Banana 2.1 · 2K · {count} {count === 1 ? "image" : "images"}</p><button className="library-primary-button world-generate" disabled><span><Sparkles size={16} />Generate {count === 1 ? "Image" : "Images"}</span><span>✦ {count * 3}</span></button><p className="world-helper">Image generation is available only to approved testing accounts.</p></section>
        <section className="world-favorites"><h2>2. Choose your favorite</h2><div><ImageIcon size={28} /><h3>Your next favorite starts here.</h3><p>Your images will appear here.</p></div></section>
      </div>
      <div className="world-soon-overlay" aria-hidden="true"><strong>Coming Soon</strong><span>Final polish underway</span></div>
    </div>
    <section className="world-proof"><p>PROOF</p><h2>Worlds no one can stop watching.<br />Millions of views every video.</h2><div className="world-proof-grid"><div className="world-proof-collage">{[87,85,86,88,89].map((number, index) => <img src={`/sites/tezu/library/world-proof-${number}.webp`} alt={["Illustrated world in a treehouse — 5.9M views", "Illustrated world in a nighttime tree — 12.1M views", "Illustrated world at a campsite — 5.3M views", "Illustrated world in a library — 4.4M views", "Illustrated world in a cabin — 4.1M views"][index]} key={number} loading="lazy" />)}</div><div><div className="world-proof-stats"><div><strong>30M+</strong><p>views across these five videos</p></div><div><strong>61K+</strong><p>followers gained in one month</p></div></div><img className="world-proof-profile" src="/sites/tezu/library/world-proof-90.webp" alt="Profile @whenlifefeltreal showing 61.3K followers" loading="lazy" /><p className="world-proof-credit">@whenlifefeltreal · made with TEZU</p></div></div></section>
  </main>;
}

const origins = ["African", "Asian", "European", "Indian", "Middle Eastern", "Mixed"];
const femaleOrigins = ["origin-african-DiK8Q0bS.jpg", "origin-asian-VC3aF7St.jpg", "origin-european-CsSqSEhH.jpg", "origin-indian-DUrdZYVC.jpg", "origin-middle-eastern-BeSe_yD2.jpg", "origin-mixed-CafTSApE.jpg"];
const maleOrigins = ["origin-male-african-B_nEh-Y2.jpg", "origin-male-asian-C-rbqlUD.jpg", "origin-male-european-DTVX5tn-.jpg", "origin-male-indian-mNGnI1Q1.jpg", "origin-male-middle-eastern--GYi0oGf.jpg", "origin-male-mixed-CbfkVH5I.jpg"];
const eyes = ["Black", "Purple", "Green", "White", "Brown", "Solid Black", "Cloudy White", "Deep Brown", "Blue", "Amber", "Red", "Grey"];
const eyeImages = ["eye-black-DWy1vq5w.jpg", "eye-purple-BkORFeAX.jpg", "eye-green-CHjqYRrY.jpg", "eye-white-BOVJB0Pb.jpg", "eye-brown-CuPw_DGZ.jpg", "eye-solid-black-D8AYoybJ.jpg", "eye-cloudy-white-CzyFry3x.jpg", "eye-deep-brown-DzN7jQGY.jpg", "eye-blue-CFxmAL4R.jpg", "eye-amber-0CwOovch.jpg", "eye-red-BSoPl2tW.jpg", "eye-grey-CYjx3snb.jpg"];
const skinColors = ["Black", "Deep", "Fair", "Purple", "Tan", "Olive", "Slate", "Green", "Blue", "Red", "Silver"];
const hairColors = ["Black", "Dark Brown", "Brown", "Auburn", "Blonde", "Platinum", "Copper", "Silver", "Rainbow"];
const defaultAppearance = { gender: "Female", origin: "African", skin: "Tan", eyes: "Brown", hair: "Black", age: "Adult", body: "Average" };
type Appearance = typeof defaultAppearance;

export function InfluencerPage() {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [details, setDetails] = useState("");
  const [copied, setCopied] = useState(false);
  function choose(key: keyof Appearance, value: string) { setAppearance((current) => ({ ...current, [key]: value })); setCopied(false); }
  function pills(key: keyof Appearance, choices: string[]) { return <div className={`influencer-pills ${key === "gender" ? "gender-pills" : ""}`}>{choices.map((choice) => <button type="button" key={choice} aria-pressed={appearance[key] === choice} onClick={() => choose(key, choice)}>{choice}{key === "gender" && (choice === "Female" ? <Venus size={28} /> : <Mars size={28} />)}</button>)}</div>; }
  function swatches(key: "skin" | "hair", choices: string[]) { return <div className="influencer-swatches">{choices.map((choice) => <button type="button" key={choice} className={`appearance-color swatch-${key}-${choice.toLowerCase().replaceAll(" ", "-")}`} aria-label={`${choice} ${key}`} title={choice} aria-pressed={appearance[key] === choice} onClick={() => choose(key, choice)}>{appearance[key] === choice && <Check size={13} />}</button>)}<label className="influencer-custom-color" aria-label={`Custom ${key} color`}><Palette size={20} /><input type="color" aria-label={`Custom ${key} color`} value={appearance[key].startsWith("#") ? appearance[key] : key === "skin" ? "#bd8a6c" : "#8b5cf6"} onChange={(event) => choose(key, event.target.value)} /></label></div>; }
  return <main className="influencer-page"><h1 className="library-visually-hidden">AI Influencer</h1><div className="influencer-page-layout"><aside className="influencer-drafts" aria-label="Influencer drafts"><button type="button" onClick={() => { setAppearance(defaultAppearance); setDetails(""); setCopied(false); }}><Plus size={20} /><span>Create new</span></button></aside><section className="influencer-preview" aria-label="Influencer preview"><div className="influencer-preview-inner"><div className="influencer-blank-portrait"><div><ImageIcon size={20} /><p>Your AI influencer lives here.<br />Design and build your AI influencer<br />from scratch</p></div></div><button className="library-primary-button" type="button" disabled>Generate Influencer <LockKeyhole size={16} /></button><p>Generation coming soon · No credits charged</p></div></section><aside className="influencer-appearance" aria-label="Appearance settings">
    <AppearanceSection title="Gender" icon={<Sparkles size={14} />}>{pills("gender", ["Female", "Male"])}</AppearanceSection>
    <AppearanceSection title="Ethnicity / Origin Base" icon={<Globe size={14} />}><div className="influencer-photo-choices">{origins.map((origin, index) => <button type="button" key={origin} title={origin} aria-pressed={appearance.origin === origin} onClick={() => choose("origin", origin)}><img src={`/sites/tezu/library/${appearance.gender === "Female" ? femaleOrigins[index] : maleOrigins[index]}`} alt={`${origin} adult ${appearance.gender.toLowerCase()} portrait reference`} width={360} height={360} /><span>{origin}</span>{appearance.origin === origin && <i><Check size={12} /></i>}</button>)}</div></AppearanceSection>
    <AppearanceSection title="Skin Color" icon={<Palette size={14} />}>{swatches("skin", skinColors)}</AppearanceSection>
    <AppearanceSection title="Eye" icon={<ImageIcon size={14} />}><div className="influencer-photo-choices">{eyes.map((eye, index) => <button type="button" key={eye} title={eye} aria-pressed={appearance.eyes === eye} onClick={() => choose("eyes", eye)}><img src={`/sites/tezu/library/${eyeImages[index]}`} alt={`${eye} eye appearance`} width={360} height={360} loading="lazy" /><span>{eye}</span>{appearance.eyes === eye && <i><Check size={12} /></i>}</button>)}</div><label className="influencer-custom-color influencer-eye-custom"><Palette size={20} /><input type="color" aria-label="Custom eyes color" value={appearance.eyes.startsWith("#") ? appearance.eyes : "#8b5cf6"} onChange={(event) => choose("eyes", event.target.value)} /></label></AppearanceSection>
    <AppearanceSection title="Hair color" icon={<Palette size={14} />}>{swatches("hair", hairColors)}</AppearanceSection>
    <AppearanceSection title="Age" icon={<UserRound size={14} />}>{pills("age", ["Adult", "Mature", "Senior"])}</AppearanceSection>
    <AppearanceSection title="Body type" icon={<Users size={14} />}>{pills("body", ["Slim", "Average", "Athletic", "Muscular", "Curvy", "Plus Size"])}</AppearanceSection>
    <label className="influencer-details-label">Additional details<textarea maxLength={2000} rows={3} placeholder="Hairstyle, outfit, expression…" value={details} onChange={(event) => { setDetails(event.target.value); setCopied(false); }} /></label><button className="library-secondary-button influencer-copy" type="button" onClick={async () => { try { await navigator.clipboard.writeText(`Original adult AI influencer. ${appearance.gender}, ${appearance.origin} appearance, ${appearance.skin} skin, ${appearance.eyes} eyes, ${appearance.hair} hair, ${appearance.age}, ${appearance.body} body type. ${details}`); setCopied(true); } catch { setCopied(false); } }}><Copy size={15} />{copied ? "Copied" : "Copy appearance prompt"}</button>
  </aside></div></main>;
}

function AppearanceSection({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <details className="appearance-section" open><summary><span>{icon}{title}</span><ChevronDown size={13} /></summary>{children}</details>; }

export function CharactersPage() {
  const [search, setSearch] = useState("");
  const [style, setStyle] = useState("All styles");
  const [sort, setSort] = useState("Newest first");
  return <main className="tezu-library library-account-page"><LibraryHeading title="My Characters" description="Your private character collection. Ready for new scenes and stories." action="New character" href="/create/character" /><div className="character-library-filters"><div><Search size={16} /><input aria-label="Search characters" placeholder="Search characters" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select aria-label="Filter by style" value={style} onChange={(event) => setStyle(event.target.value)}>{["All styles", "Cinematic 3D", "Stylized Animation", "Realistic", "Cartoon", "Anime-inspired"].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Sort characters" value={sort} onChange={(event) => setSort(event.target.value)}>{["Newest first", "Oldest first", "Name A–Z"].map((item) => <option key={item}>{item}</option>)}</select></div><div className="library-empty-state"><span className="empty-character-art"><UserRound size={72} /></span><h2>{search ? "No characters match your search." : "Your characters live here."}</h2><p>Save a character once. Bring it into new scenes whenever you want.</p><Link className="library-primary-button" href="/create/character"><Plus size={16} />Create your first character</Link></div></main>;
}

export function CreationsPage() {
  const [filter, setFilter] = useState("All");
  return <main className="tezu-library library-account-page"><LibraryHeading title="My Creations" description="Everything you've generated, saved privately to your account." action="New creation" href="/create/image" /><div className="creation-filters" role="tablist" aria-label="Filter creations">{["All", "Images", "Videos", "Characters"].map((item) => <button type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)} key={item}>{item}</button>)}</div><section className="library-empty-state" role="tabpanel" aria-label={filter}><span className="empty-creation-icon"><ImageIcon size={22} /></span><h2>No creations here yet</h2><p>Generate an image, video or character and it will be saved here automatically.</p><div className="empty-creation-actions"><Link className="library-secondary-button" href="/create/image"><ImageIcon size={16} /> Image</Link><Link className="library-secondary-button" href="/create/video"><WandSparkles size={16} /> Video</Link></div></section></main>;
}

function LibraryHeading({ title, description, action, href }: { title: string; description: string; action: string; href: string }) { return <header className="account-page-heading"><div><p>Library</p><h1>{title}</h1><span>{description}</span></div><Link className="library-primary-button" href={href}><Plus size={15} />{action}</Link></header>; }

const rewardDays = [["2 credits", "Generation credits"], ["1 free image", "Nano Banana 2.1 · 2K"], ["4 credits", "Generation credits"], ["2 free images", "Nano Banana 2.1 · 2K"], ["6 credits", "Generation credits"], ["3 free images", "Nano Banana 2.1 · 2K"], ["3 images or 3 characters", "Your choice · Images at 2K"]];
const rewardPrizes = [["10 credits", "4th most common"], ["Boost · Faster generations", "Most common"], ["15 credits", "5th most common"], ["3 image generations", "2nd most common"], ["3 character generations", "3rd most common"], ["1 video generation", "Rarest available proposal"], ["Ultra plan · $129 · 1 month", "Unavailable · 0%"]];
const rewardRules = ["An active Plus, Ultra or Agency subscription is required. Free, Lite and Starter accounts are not eligible.", "One free spin every rolling 24 hours for approved eligible accounts after activation.", "Verified email and a minimum account age will be required. The promotion will have published start/end dates and budget limits.", "Generation prizes will specify models, quantities, resolution and expiry. Boost is a proposed faster-generation benefit, not an active speed improvement. The decorative Ultra plan is unavailable with a 0% chance.", "Credit prizes will not expire. Bounded generation prizes expire after seven days; unused prizes do not roll over.", "The reward is saved before the wheel moves. Refreshing or retrying cannot change or duplicate it.", "Quests are optional and require verified completed activity, never clicks. No paid entries, cash prizes or wagering."];

export function RewardsPage() {
  const [showRules, setShowRules] = useState(false);
  return <main className="tezu-library library-rewards-page"><header className="rewards-heading"><span><Gift size={22} /></span><div><h1>Rewards</h1><p>Member benefits · Coming soon</p></div></header><div className="reward-membership"><div><h2>For Plus, Ultra and Agency members</h2><p>Rewards are not active. Upgrading does not unlock claims yet.</p></div><Link className="library-primary-button" href="/pricing">Upgrade to Plus <ArrowUpRight size={14} /></Link></div><div className="rewards-main-grid"><section className="reward-spin-card"><div className="reward-section-heading"><div><h2>Daily spin</h2><p>One free spin every 24 hours after launch.</p></div><LockKeyhole size={17} /></div><RewardWheel /><div className="reward-spin-actions"><button className="library-secondary-button" disabled type="button"><Gift size={16} />Spin coming soon</button><p>Free entries only. No paid spins.</p><button className="reward-rules-button" type="button" onClick={() => setShowRules(true)}><Info size={14} />Prizes &amp; eligibility</button></div></section><section className="reward-checkin"><div className="reward-section-heading"><div><h2>Seven-day check-in</h2><p>0/7 days completed</p></div><CalendarDays size={17} /></div><div>{rewardDays.map(([title, description], index) => <div className={`reward-day ${index === 6 ? "weekly" : ""}`} key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{title}</h3><p>{description}</p></div><LockKeyhole size={14} /></div>)}</div><button className="library-secondary-button reward-checkin-button" disabled type="button"><CalendarDays size={14} />Check-in coming soon</button></section></div><div className="reward-legendary"><div><Crown size={22} /><div><h3>Ultra · One month <span>$129 value</span></h3><p>Legendary preview only. No subscription is awarded.</p></div></div><span>Unavailable · 0% chance</span></div><p className="reward-proposal-note">Prize quantities and rarity are proposals; odds await approval. Check-ins follow UTC days. Missing a day restarts the cycle without removing earned rewards. Day seven offers three 2K Nano Banana 2.1 images or three characters—not both.</p><section className="reward-quests"><div className="reward-section-heading"><h2>Creator quests</h2><p>Optional · Resets at midnight UTC</p></div>{[["Find your next idea", "Complete a Prompt Assistant preview", "/create/image"], ["Keep a character you love", "Save a completed character sheet", "/characters"], ["Bring an idea to life", "Complete an image generation", "/create/image"]].map(([title, description, href]) => <div className="reward-quest" key={title}><LockKeyhole size={16} /><div><h3>{title}</h3><p>{description}</p></div><span>Not completed</span><Link href={href} aria-label={`Open studio for ${title}`}><ArrowUpRight size={17} /></Link></div>)}<p className="reward-proposal-note">Normal generation costs apply. Quest rewards are not active.</p></section><section className="reward-history"><div className="reward-section-heading"><h2>Reward history</h2><p>0 earned</p></div><p>No rewards earned yet.</p></section>{showRules && <RewardRulesDialog onClose={() => setShowRules(false)} />}</main>;
}


function RewardRulesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} aria-labelledby="reward-rules-title" className="library-modal" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); }}><button className="library-modal-close" type="button" aria-label="Close prizes and eligibility" onClick={onClose}><X size={20} /></button><h2 id="reward-rules-title">Rewards, odds &amp; eligibility</h2><p>Rewards are disabled. The categories below are proposals, not available prizes.</p><div className="reward-prize-list">{rewardPrizes.map(([title, description]) => <div key={title}><strong>{title}</strong><span>{description}</span></div>)}</div><ul>{rewardRules.map((rule) => <li key={rule}>{rule}</li>)}</ul><button className="library-secondary-button" type="button" onClick={onClose}>Got it</button></dialog>;
}

function RewardWheel() {
  const labels = [["10", "CREDITS"], ["BOOST", "FASTER GENERATIONS"], ["15", "CREDITS"], ["3", "IMAGES"], ["3", "CHARACTERS"], ["1", "VIDEO"], ["$129", "ULTRA · 1 MONTH"]];
  function point(angle: number, radius: number) { const radians = (angle - 90) * Math.PI / 180; return { x: Number((200 + Math.cos(radians) * radius).toFixed(4)), y: Number((200 + Math.sin(radians) * radius).toFixed(4)) }; }
  return <div className="library-reward-wheel"><span className="library-wheel-pointer" /><svg viewBox="0 0 400 400" role="img" aria-label="Proposed wheel: Boost, 3 images, 3 characters, 10 credits, 15 credits and 1 video. Gold Ultra plan unavailable, zero percent chance. Rewards are disabled.">{labels.map(([amount, label], index) => { const start = point(index * 360 / 7, 189); const end = point((index + 1) * 360 / 7, 189); const labelPosition = point((index + .5) * 360 / 7, 134); return <g key={index} className={index === 6 ? "legendary-segment" : ""}><path className={`wheel-segment segment-${index}`} d={`M200 200 L${start.x} ${start.y} A189 189 0 0 1 ${end.x} ${end.y} Z`} /><g transform={`translate(${labelPosition.x} ${labelPosition.y}) rotate(${((index + .5) * 360 / 7).toFixed(4)})`}><text textAnchor="middle" y="-4" className={`wheel-amount ${index === 1 ? "boost-amount" : ""}`}>{amount}</text><text textAnchor="middle" y="12">{label}</text>{index === 6 && <text textAnchor="middle" y="24">UNAVAILABLE · 0%</text>}</g></g>; })}<circle className="wheel-outline" cx="200" cy="200" r="190" /></svg><div className="library-wheel-hub"><img src={asset("/__l5e/assets-v1/dd7d1504-2633-4df7-b36e-be6076f0c090/tezu-white-knot-logo.png")} alt="TEZU" width={64} height={64} /></div></div>;
}

function subscribeDisplayName(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("tezu-profile-updated", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("tezu-profile-updated", onChange);
  };
}

function readDisplayName() {
  try { return localStorage.getItem("tezu-demo-display-name") || "Creator"; }
  catch { return "Creator"; }
}

export function SettingsPage() {
  const savedDisplayName = useSyncExternalStore(subscribeDisplayName, readDisplayName, () => "Creator");
  const [draftDisplayName, setDisplayName] = useState<string | null>(null);
  const displayName = draftDisplayName ?? savedDisplayName;
  const [message, setMessage] = useState("");
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = displayName.trim() || "Creator";
    setDisplayName(nextName);
    try {
      localStorage.setItem("tezu-demo-display-name", nextName);
      window.dispatchEvent(new Event("tezu-profile-updated"));
      setMessage("Display name saved for this local preview.");
    } catch { setMessage("Display name updated for this session."); }
  }
  return <main className="tezu-library library-account-page settings-page"><header className="account-page-heading"><div><p>Account</p><h1>Settings &amp; credits</h1></div></header><div className="settings-main-grid"><section className="library-settings-card"><h2>Profile</h2><form onSubmit={saveProfile}><label>Display name<input value={displayName} maxLength={60} onChange={(event) => { setDisplayName(event.target.value); setMessage(""); }} /></label><div className="settings-email"><span>Email</span><p>Not connected in this preview</p></div><div className="settings-profile-actions"><button type="submit" className="library-primary-button">Save changes</button><Link className="library-secondary-button" href="/auth"><LogOut size={15} />Sign out</Link></div>{message && <p role="status" className="settings-feedback">{message}</p>}</form><p className="settings-account-deletion">Your preview display name stays in this browser. Clear this site’s browser data to remove it. For other questions, contact @nateassets on Instagram.</p></section><section id="credits" className="library-settings-card settings-credits"><div><h2>Credits &amp; Billing</h2><p>Early-access test credits. Paid plans aren&apos;t open yet, and no card is needed.</p></div><div><strong>20</strong><span>available</span></div><Link className="library-primary-button" href="/pricing">View plans <ArrowUpRight size={15} /></Link></section></div><section className="library-settings-card settings-benefits"><h2>Account benefits</h2><p>No active paid subscription. Monthly plan allowances, bonus generations and image promotions are not active on your account.</p><p>Image promotion: inactive</p><details><summary>Eligible bonus settings</summary><p>One standard Nano Banana 2.1 2K 9:16 sheet; one Nano Banana 2.1 image at 2K; one Seedance 2.5 video at 480p, up to 5s. No reference-video input or multiple outputs. Your purchased offer terms apply.</p></details></section><section className="library-settings-card settings-benefits"><h2>Subscription</h2><p>No paid subscription. Checkout remains closed.</p><button type="button" className="library-secondary-button" disabled>Manage billing</button><p>Subscriptions renew automatically at the disclosed price and billing frequency until canceled. Annual subscriptions are charged for the full year upfront, with credits resetting monthly.</p><p>Subscription credits reset monthly. Unused subscription credits expire; separate testing and promotional credits are preserved.</p><p>Cancel before your next renewal to stop future charges. Scheduled cancellation keeps access through the paid period; cancellation does not automatically issue a refund.</p></section><section className="settings-history"><h2>History</h2><div className="settings-history-entry"><p>Early-access test credits</p><strong>+20</strong></div></section></main>;
}
