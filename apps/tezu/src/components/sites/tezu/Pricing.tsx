"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight, Check, ChevronDown, Clapperboard, Gift, ImageIcon, Info, Minus, Plus, ShieldCheck, Sparkles, UserRound, Zap } from "lucide-react";
import { Footer } from "./SiteShell";
import "./pricing.css";

type Plan = { name: string; description: string; credits: number; monthly: number; annual: number; bonus: number[] };
const plans: Plan[] = [
  { name: "Lite", description: "Try TEZU affordably", credits: 120, monthly: 9, annual: 9, bonus: [0, 0, 0] },
  { name: "Starter", description: "For getting started", credits: 270, monthly: 19, annual: 19, bonus: [2, 10, 0] },
  { name: "Plus", description: "For everyday creators", credits: 1200, monthly: 59, annual: 47, bonus: [10, 40, 1] },
  { name: "Ultra", description: "For serious creators", credits: 3000, monthly: 129, annual: 99, bonus: [25, 100, 3] },
];
const ultraAnnual = [99, 194, 270];
const ultraMonthly = [129, 220, 310];
const ultraRegular = [129, 250, 375];
const creationTools = ["Character, Image & Video tools", "Private creation library", "Saved character references", "Downloadable outputs"];
const bonusLabels = ["Character sheets", "Standard images · 2K", "Short videos · 480p"];
const bonusIcons = [UserRound, ImageIcon, Clapperboard];
function number(value: number) { return value.toLocaleString("en-US"); }
function planPrice(plan: Plan, annual: boolean, volume = 0) { return plan.name === "Ultra" ? (annual ? ultraAnnual : ultraMonthly)[volume] : annual ? plan.annual : plan.monthly; }

function BillingToggle({ annual, change, compact = false }: { annual: boolean; change: (annual: boolean) => void; compact?: boolean }) {
  return <div className="billing-tabs" role="group" aria-label="Billing period"><button type="button" aria-pressed={!annual} onClick={() => change(false)}>Monthly</button><button type="button" aria-pressed={annual} onClick={() => change(true)}>{compact ? "Annual" : "Annually"}</button></div>;
}

function Bonuses({ amounts, lite = false }: { amounts: number[]; lite?: boolean }) {
  const [info, setInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState(false);
  const infoId = useId();
  const videoInfoId = useId();
  return <div className="plan-bonuses">
    <div className="bonus-heading"><Gift size={14} /><div><b>BONUSES</b><p>{lite ? "No monthly bonuses" : "Proposed · separate from credits"}</p></div><button type="button" className="bonus-info" aria-label="Monthly bonus eligibility" aria-expanded={info} aria-controls={infoId} onClick={() => setInfo(!info)}><Info size={14} /></button></div>
    <div className="bonus-rows">{bonusLabels.map((label, index) => {
      const Icon = bonusIcons[index];
      const [name, quality] = label.split(" · ");
      return <div className={`bonus-row ${amounts[index] ? "" : "no-bonus-row"}`} key={label}><Icon size={15} /><span>{name}{quality && <small> · {quality}</small>}</span><div className="bonus-value">{index === 2 && amounts[index] > 0 && <button className="bonus-info bonus-video-info" type="button" aria-label="Bonus video limits" aria-expanded={videoInfo} aria-controls={videoInfoId} onClick={() => setVideoInfo(!videoInfo)}><Info size={14} /></button>}<b className={amounts[index] ? "" : "no-bonus"}>{amounts[index] ? `+${amounts[index]}` : <><Minus size={12} />No bonus</>}</b></div></div>;
    })}</div>
    {info && <p className="bonus-explanation" id={infoId} role="status">Proposed monthly bonuses are separate from credits and not active yet. Eligible jobs: a standard character sheet, Nano Banana 2.1 at 2K, or Seedance 2.5 up to 5s at 480p. No reference videos. Failed qualifying jobs restore the bonus.</p>}
    {videoInfo && <p className="bonus-explanation" id={videoInfoId} role="status">Bonus videos use Seedance 2.5, up to 5 seconds at 480p. Reference videos are not included. Bonuses are proposed and not active yet.</p>}
    <small>{lite ? "Generations use your monthly credits" : "Pending approval · not active"}</small>
  </div>;
}

export function PricingCards({ home = false, annual: controlledAnnual, onAnnualChange }: { home?: boolean; annual?: boolean; onAnnualChange?: (annual: boolean) => void }) {
  const [localAnnual, setLocalAnnual] = useState(false);
  const [volume, setVolume] = useState(0);
  const annual = controlledAnnual ?? localAnnual;
  const changeAnnual = onAnnualChange ?? setLocalAnnual;
  return <section className={`tezu-pricing section ${home ? "pricing-home" : "pricing-full-cards"}`} id="pricing"><div className="section-inner">
    {home ? <div className="pricing-heading"><h2>Choose your plan</h2><p>More credits. More room to create.</p><BillingToggle annual={annual} change={changeAnnual} /></div> : <div className="pricing-card-header"><div><h2>Creator &amp; Agency plans</h2><p>One studio. Every creative possibility.</p></div><div><BillingToggle annual={annual} change={changeAnnual} /><small>Save up to 30% with annual billing</small></div></div>}
    <div className="plans-grid">{plans.map((plan, index) => {
      const credits = plan.name === "Ultra" ? plan.credits * (volume + 1) : plan.credits;
      const price = planPrice(plan, annual, volume);
      const regular = plan.name === "Ultra" ? ultraRegular[volume] : plan.monthly;
      const discount = Math.round((1 - price / regular) * 100);
      const annualPrice = planPrice(plan, true, volume);
      const annualDiscount = Math.round((1 - annualPrice / regular) * 100);
      const showSavings = annualDiscount > 0;
      return <article className={`plan-card plan-${plan.name.toLowerCase()} ${index === 3 ? "recommended" : ""}`} data-discount={showSavings || undefined} key={plan.name} aria-label={`${plan.name} plan`}>
        {showSavings && <span className="plan-discount" aria-label={annual ? `${discount}% off` : `Billed annually: $${annualPrice} per month instead of $${regular}`}>{annual ? `${discount}% OFF` : `SAVE ${annualDiscount}%`}</span>}
        <div className="plan-card-head"><div><h3>{plan.name}</h3>{index === 3 && <b className="plan-recommended">RECOMMENDED</b>}</div><p className="plan-description">{plan.description}</p></div>
        <div className="plan-credit-box"><div className="plan-credit-line"><Sparkles size={15} /><div><div className="plan-credits" aria-live="polite"><span className="pricing-value-in" key={credits}>{number(credits)}</span> credits / month</div><p className="plan-note">{index === 3 ? "Choose your monthly volume" : "Fixed monthly allowance"}</p></div></div>
          {index === 3 ? <div className="volume-options"><input aria-label="Ultra monthly credits" aria-valuetext={`${number(credits)} credits per month`} type="range" min="0" max="2" step="1" value={volume} onChange={event => setVolume(Number(event.target.value))} /><div>{["3,000", "6,000", "9,000"].map((label, value) => <button type="button" key={value} aria-pressed={volume === value} onClick={() => setVolume(value)}>{label}</button>)}</div></div> : <div className="plan-includes"><ul>{["Characters", "Images", "Videos"].map(item => <li key={item}><Check size={12} />{item}</li>)}</ul></div>}
        </div>
        <div className="plan-price" aria-live="polite">{discount > 0 && <del aria-label={`Regular price $${regular} per month`}>${regular}</del>}<span className="pricing-value-in" key={`${annual}-${price}`}>${price}</span><p>{annual && index > 0 ? "per month, billed annually" : "per month"}</p></div>
        <div className="plan-purchase"><Link href="/auth?mode=signup" className="plan-action">Get {plan.name}<ArrowRight size={16} /></Link><p className="plan-upfront">{index === 0 ? "Monthly only · no annual commitment" : annual ? `$${number(price * 12)} USD paid upfront / year` : "Monthly billing · USD"}</p></div>
        <Bonuses amounts={plan.bonus.map(amount => amount * (index === 3 ? volume + 1 : 1))} lite={index === 0} />
        {!home && <div className="plan-tools"><h4>CREATION TOOLS</h4><ul>{creationTools.map(tool => <li key={tool}><Check size={13} />{tool}</li>)}</ul><p><strong>{number(credits)}</strong> proposed monthly credits</p></div>}
      </article>;
    })}</div>
    {home ? <div className="pricing-bottom"><Link className="pricing-agency-link" href="/pricing#agency">Creating at scale? Explore TEZU Agency<ArrowRight size={16} /></Link><div className="pricing-inclusions"><p>Every individual plan includes</p><ul>{creationTools.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul></div><PricingNotice /><Link className="compare-link" href="/pricing#pricing-details">Compare all features →</Link></div> : <p className="pricing-bonus-note">Monthly bonus generations are proposed, pending approval and not active yet.</p>}
  </div></section>;
}

function PricingNotice() {
  return <div className="pricing-notice"><p>Proposed launch pricing in USD. Checkout is not open. No payment is taken.</p><p>Get a plan starts free signup, not a subscription. Public generation remains closed during testing.</p></div>;
}

function Agency() {
  return <section className="agency-card" id="agency" aria-labelledby="agency-heading"><div className="agency-overview"><span>HIGH-VOLUME CREATION</span><h2 id="agency-heading">TEZU Agency</h2><p>More room for your creative studio.</p><div className="agency-price"><strong>$397</strong><span>USD / month</span></div><small>Monthly only · no annual commitment</small><div className="agency-allowance"><strong>12,000</strong><span>proposed credits / month</span></div></div><div className="agency-purchase"><ul>{["Character, image & video tools", "Private library & saved characters", "Downloads"].map(item => <li key={item}><Check size={15} />{item}</li>)}</ul><Bonuses amounts={[75, 250, 5]} /><Link href="/hire#inquiry" className="agency-action">Enquire about Agency<ArrowRight size={17} /></Link><p>Proposed offer. Checkout is closed; no subscription or bonuses are granted.</p><p>Commercial use depends on model-provider terms. Image promotion is not active.</p></div></section>;
}

function PlanFinder({ annual, change }: { annual: boolean; change: (value: boolean) => void }) {
  const [categories, setCategories] = useState<string[]>(["Social media videos"]);
  const [usage, setUsage] = useState([10, 20, 2]);
  const [why, setWhy] = useState(false);
  const estimated = usage[0] * 55 + usage[1] * 3 + usage[2] * 4;
  const recommended = estimated <= 120 ? plans[0] : estimated <= 270 ? plans[1] : estimated <= 1200 ? plans[2] : plans[3];
  const agency = estimated > 9000;
  const volume = estimated > 6000 ? 2 : estimated > 3000 ? 1 : 0;
  const credits = agency ? 12000 : recommended.name === "Ultra" ? 3000 * (volume + 1) : recommended.credits;
  const price = agency ? 397 : planPrice(recommended, annual, volume);
  const name = agency ? "Agency" : recommended.name;
  const monthlyOnly = name === "Lite" || agency;
  const description = agency ? "For high-volume creation" : recommended.description;
  return <section className="plan-finder" id="plan-finder" aria-labelledby="finder-heading"><div className="finder-heading"><h2 id="finder-heading">Find the best plan for you</h2><p>Choose what you want to create and get what you need.</p></div><div className="finder-panel"><div className="finder-questions"><fieldset className="finder-step"><legend><span>1</span>What are you here to make?</legend><p>Multiple options can be selected</p><div className="finder-categories">{["Social media videos", "Cinematic AI videos", "AI characters", "AI images & artwork", "Marketing & product content", "Personal projects"].map((category, index) => {
    const Icon = [Clapperboard, Sparkles, UserRound, ImageIcon, Zap, Gift][index];
    return <button key={category} type="button" role="checkbox" aria-checked={categories.includes(category)} onClick={() => setCategories(current => current.includes(category) ? current.filter(item => item !== category) : [...current, category])}><Icon size={17} />{category}<i>{categories.includes(category) && <Check size={12} />}</i></button>;
  })}</div></fieldset><fieldset className="finder-step"><legend><span>2</span>How much content per month?</legend><p>≈ 55 credits per video · 3 per image · 4 per character</p><div className="finder-sliders">{["AI videos", "AI images", "AI characters"].map((label, index) => <div className="finder-usage" key={label}><div><strong>{usage[index]}</strong><label htmlFor={`finder-${index}`}>{label}</label><small>/month</small><b>{number(usage[index] * [55, 3, 4][index])} credits</b></div><div><button type="button" aria-label={`Fewer ${label}`} disabled={usage[index] === 0} onClick={() => setUsage(current => current.map((value, i) => i === index ? Math.max(0, value - 1) : value))}><Minus size={13} /></button><input id={`finder-${index}`} aria-label={`${label} per month`} type="range" min="0" max={[200, 500, 100][index]} value={usage[index]} onChange={event => setUsage(current => current.map((value, i) => i === index ? Number(event.target.value) : value))} /><button type="button" aria-label={`More ${label}`} disabled={usage[index] === [200, 500, 100][index]} onClick={() => setUsage(current => current.map((value, i) => i === index ? Math.min([200, 500, 100][index], value + 1) : value))}><Plus size={13} /></button></div></div>)}</div></fieldset><fieldset className="finder-step"><legend><span>3</span>Features &amp; capabilities</legend><p>Included with every individual plan</p><ul className="finder-features">{["Character Creator", "Image Generator", "Video Generator", "Saved characters", "Private library", "Downloads"].map(item => <li key={item}><Check size={13} />{item}</li>)}</ul></fieldset></div><div className="finder-result"><p className="finder-recommend-label">We recommend <strong>{name}</strong> plan</p><button type="button" className="finder-why" aria-expanded={why} onClick={() => setWhy(!why)}>See why<Info size={13} /></button>{why && <p className="finder-reason">{number(estimated)} estimated credits {estimated <= credits ? `fit within ${name}'s ${number(credits)} at the lowest eligible price.` : `exceed the proposed ${number(credits)} allowance. Enquire for your needs.`} Bonuses aren&apos;t counted.</p>}<div className={`finder-recommendation finder-${name.toLowerCase()}`} aria-live="polite"><div><h4>{name}</h4>{name === "Plus" && annual && <b>20% OFF</b>}</div><p>{description}</p><strong>{number(credits)} credits/mo</strong><div className="finder-usage-meter"><span>Expected monthly usage</span><div><b>{number(estimated)}</b> / {number(credits)} credits</div><progress max={credits} value={Math.min(estimated, credits)} aria-label="Expected monthly credit usage" /></div><ul>{["All three creation tools", "Private library & saved characters", "Downloadable creations"].map(item => <li key={item}><Check size={13} />{item}</li>)}</ul><div className="finder-price"><strong>${price}</strong><span>/month{annual && !monthlyOnly && ", billed annually"}</span></div><Link className="plan-action" href={agency ? "/hire#inquiry" : "/auth?mode=signup"}>{agency ? "Enquire about Agency" : `Get ${name}`}<ArrowRight size={15} /></Link><small>{annual && !monthlyOnly ? `$${number(price * 12)} USD upfront/year · ` : monthlyOnly ? "Monthly only · " : "Billed monthly · "}Checkout not open yet</small></div><BillingToggle annual={annual} change={change} compact /><a className="finder-compare" href="#pricing-details">Compare all features<ArrowRight size={13} /></a></div></div></section>;
}

type ComparisonRow = { label: string; detail?: string; values?: (string | boolean)[] };
const comparison: { title: string; rows: ComparisonRow[] }[] = [
  { title: "Video Generation", rows: [{ label: "Video Generator" }, { label: "Text-to-video & image-to-video", detail: "Seedance 2.5" }, { label: "Resolutions", values: Array(5).fill("480p · 720p · 1080p · 4K · 768p · 2K") as string[] }, { label: "Durations", detail: "Model-specific", values: Array(5).fill("2–30s by model") as string[] }, { label: "Image & saved character references" }, { label: "Bonus videos / month", detail: "5s · 480p", values: [false, false, "1 · inactive", "3 · inactive", "5 · inactive"] }] },
  { title: "Image Generation", rows: [{ label: "Image Generator", detail: "Nano Banana 2.1" }, { label: "1K resolution", detail: "3 credits/image" }, { label: "2K resolution", detail: "3 credits/image" }, { label: "4K resolution", detail: "4 credits/image" }, { label: "Image reference uploads" }, { label: "Bonus images / month", detail: "Nano Banana 2.1 · 2K", values: [false, "10 · inactive", "40 · inactive", "100 · inactive", "250 · inactive"] }] },
  { title: "Character Creator", rows: [{ label: "Character Creator", detail: "4 credits/sheet" }, { label: "Boy & Girl starting references" }, { label: "Custom character descriptions" }, { label: "Character reference sheets" }, { label: "Saved character library" }, { label: "Reuse characters in images & videos" }, { label: "Bonus characters / month", values: [false, "2 · inactive", "10 · inactive", "25 · inactive", "75 · inactive"] }] },
  { title: "Credits & Usage", rows: [{ label: "Monthly credits", values: ["120", "270", "1,200", "3,000+", "12,000 · proposed"] }, { label: "Credit volumes", values: [false, false, false, "3k · 6k · 9k", "12k · proposed"] }, { label: "Credit-based generation", detail: "Exact cost shown before each run" }, { label: "Failed generations refunded" }, { label: "Credit reset & rollover", values: Array(5).fill("To be confirmed") as string[] }, { label: "Buy extra credits", values: Array(5).fill(false) as boolean[] }] },
  { title: "Access & Features", rows: [{ label: "Private creation library" }, { label: "Downloadable outputs" }, { label: "Creation history" }, { label: "Saved characters" }, { label: "Seven-day image promotion", values: Array(5).fill(false) as boolean[] }] },
];
function FeatureComparison({ annual, change }: { annual: boolean; change: (value: boolean) => void }) {
  const [open, setOpen] = useState([true, true, false, false, false]);
  const allOpen = open.every(Boolean);
  return <section className="pricing-details" id="pricing-details" aria-labelledby="compare-heading"><div className="compare-heading"><div><h2 id="compare-heading">Compare features</h2><p>See exactly what&apos;s included in each TEZU plan.</p></div><button className="compare-expand" type="button" onClick={() => setOpen(comparison.map(() => !allOpen))}>{allOpen ? "Collapse all" : "Expand all"}</button><BillingToggle annual={annual} change={change} compact /></div><div className="comparison-wrap"><div className="comparison-table" role="table" aria-label="Compare TEZU plans"><div className="comparison-head" role="row"><div role="columnheader" />{[...plans, { name: "Agency", monthly: 397, annual: 397 }].map(plan => {
    const price = annual ? plan.annual : plan.monthly;
    return <div role="columnheader" key={plan.name}><h3>{plan.name}</h3><p>{plan.name === "Ultra" && <small>From </small>}<strong>${price}</strong><span>/month</span></p><small>{plan.name === "Lite" ? "Monthly only" : plan.name === "Agency" ? "Monthly only · proposed" : annual ? `$${number(price * 12)} upfront/year` : "Billed monthly"}</small><Link href={plan.name === "Agency" ? "/hire#inquiry" : "/auth?mode=signup"}>{plan.name === "Agency" ? "Enquire" : `Get ${plan.name}`}</Link></div>;
  })}</div>{comparison.map((group, groupIndex) => {
    const Icon = [Clapperboard, ImageIcon, UserRound, Zap, ShieldCheck][groupIndex];
    return <div key={group.title} role="rowgroup"><button type="button" className="comparison-group-toggle" aria-expanded={open[groupIndex]} aria-controls={`compare-group-${groupIndex}`} onClick={() => setOpen(current => current.map((value, i) => i === groupIndex ? !value : value))}><Icon size={17} /><span>{group.title}</span><ChevronDown size={17} /></button><div id={`compare-group-${groupIndex}`} hidden={!open[groupIndex]}>{group.rows.map(row => <div className="comparison-row" role="row" key={row.label}><div role="rowheader"><span>{row.label}</span>{row.detail && <small>{row.detail}</small>}</div>{(row.values ?? [true, true, true, true, true]).map((value, index) => <div role="cell" key={index}>{value === true ? <Check size={16} aria-label="Included" /> : value === false ? <Minus size={16} className="comparison-no" aria-label="Not included" /> : <span>{value}</span>}</div>)}</div>)}</div></div>;
  })}</div></div><p className="comparison-note">Proposed USD pricing before taxes. Checkout is closed, bonuses are inactive, and public generation remains closed during testing.</p></section>;
}

const pricingFaq = [
  ["Can I buy a plan today?", "Not yet. Get Lite, Starter, Plus and Ultra open free signup, not a paid subscription. No payment is taken or monthly plan allowance granted. Agency opens a working enquiry. Public generation stays closed during testing."],
  ["How does annual billing work?", "Starter is $228 USD upfront/year and Plus $564. Ultra is $1,188 for 3,000 monthly credits, $2,328 for 6,000 or $3,240 for 9,000. Cards display the monthly equivalent and full upfront total before taxes. Credits are monthly, not a year's allowance upfront. Lite ($9) and Agency ($397) are monthly-only even when Annual is selected."],
  ["What are monthly bonus generations?", "They are proposed additional eligible jobs, separate from credits and not active yet: Starter 2 sheets/10 images, Plus 10/40/1 video, Ultra 25/100/3 videos, Agency 75/250/5 videos. Lite has none. Proposed eligibility is one Nano Banana 2.1 2K image or standard 9:16 character sheet, or one Seedance 2.5 clip up to 5s at 480p. No reference videos. Bonuses reset on the paid subscription cycle without rollover, and qualifying failed jobs restore the bonus."],
  ["What is a credit?", "Credits are used for characters, images and videos. Each generation shows its exact credit cost before you start. Failed generations return their reserved credits automatically. Usage remains subject to launch availability and safety limits."],
  ["Do unused credits roll over?", "Rollover, reset and expiry terms are not finalized. They will be published before paid checkout opens; no rollover is promised by this proposal."],
  ["Can I cancel or change my subscription?", "There are no active paid subscriptions to cancel. Cancellation, plan changes and renewal terms will be confirmed before checkout opens, along with the full charge and applicable taxes."],
  ["What is included with Agency?", "Agency is a proposed $397 USD monthly plan with 12,000 credits and provisional 75 character, 250 image and 5 video bonuses. Final economics and eligibility need approval. Get Agency opens an inquiry, not checkout. No team seats, enterprise controls or unlimited image promotion are included or active."],
];
function PricingFaq() {
  return <section className="pricing-faq"><h2>A few things to know</h2>{pricingFaq.map(([question, answer]) => <details key={question}><summary>{question}<Plus size={17} /></summary><p>{answer}</p></details>)}<p>Before any purchase, review our <Link href="/terms">Terms of Service</Link>.</p><Link className="pricing-contact" href="/hire#inquiry">Talk to TEZU<ArrowRight size={15} /></Link></section>;
}

export function PricingPage() {
  const [annual, setAnnual] = useState(false);
  return <><main className="pricing-complete"><header className="pricing-page-top section"><div className="section-inner"><span>TEZU PRICING</span><h1>Room for every creator.</h1><p>Start at $9. Create characters, images and cinematic video with one clear monthly allowance.</p></div></header><PricingCards annual={annual} onAnnualChange={setAnnual} /><div className="pricing-page-content section"><div className="section-inner"><Agency /><PricingNotice /><PlanFinder annual={annual} change={setAnnual} /><FeatureComparison annual={annual} change={setAnnual} /><PricingFaq /></div></div></main><Footer /></>;
}
