import Link from "next/link";
import { publicContact } from "@/lib/public-contact";
import { CookieSettingsButton } from "./PrivacyControls";
import "./secondary-pages.css";

const content = {
  privacy: {
    title: "Privacy Policy",
    intro: "How information is handled in the TEZU website preview.",
    sections: [
      { title: "Information you enter", paragraphs: ["Project briefs, prompts and reference images stay in the current page. The preview does not submit these details to TEZU or an AI generation service. Closing or reloading the page clears these drafts.", "Login, signup and password reset screens are demonstrations. They do not create accounts, send reset emails or save your credentials."] },
      { title: "Storage on your device", paragraphs: ["Your chosen display name is saved in your browser under tezu-demo-display-name. Acknowledging the storage notice saves tezu-privacy-v1. You can remove both through your browser’s site-data settings.", "Reference files are used for a local preview and are not uploaded by this interface. Copying a brief uses your device clipboard only when you choose to copy it."] },
      { title: "Analytics and advertising", paragraphs: ["This preview does not load analytics or advertising trackers."] },
      { title: "External links and hosting", paragraphs: ["Contacting the studio on Instagram opens a separate service. Any details you send there are handled under that service’s policies. TEZU does not receive a project brief until you choose to share it.", "The hosting provider may process technical request information, such as IP addresses, to deliver the website. This interface does not provide a separate tracking or visitor database."] },
      { title: "Questions and requests", paragraphs: ["Contact the studio through the verified Instagram link below for privacy questions or information you have shared directly. You can delete local preview settings yourself through your browser. This policy will be updated when live accounts or generation services become available."] },
    ],
  },
  terms: {
    title: "Terms & Conditions",
    intro: "Terms for exploring the TEZU website and studio preview.",
    sections: [
      { title: "Using the preview", paragraphs: ["TEZU lets you explore a proposed creative workflow for cartoon characters, images and video. Generation, paid subscriptions and account creation are not active in this preview. Test credits are illustrative and have no cash value."] },
      { title: "Your content and references", paragraphs: ["Only use prompts, images and other material you have permission to use. You remain responsible for the rights, permissions and consent needed for content you provide, including identifiable people and third-party characters.", "Do not use the interface to plan unlawful, deceptive, abusive or infringing content. Examples shown on the site are demonstrations; they do not grant permission to reuse another person’s work or likeness."] },
      { title: "Studio commissions", paragraphs: ["A project brief is prepared locally and is not an order or a confirmed booking. Share it with the studio to discuss the scope. Deliverables, timing, revisions, fees, cancellation and usage rights must be agreed separately before production."] },
      { title: "Pricing and future services", paragraphs: ["Prices and features describe proposed launch plans. No payment is taken here. Live billing, renewal, cancellation and refund terms will be shown before any purchase is offered."] },
      { title: "Availability and results", paragraphs: ["The preview may change or be unavailable during development. Example outputs do not guarantee a specific result. Review any future generated content before publishing and check the rights relevant to your use."] },
      { title: "Contact", paragraphs: ["For questions about the site or a studio project, contact TEZU Studio through the Instagram link below."] },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    intro: "A small amount of local storage. No analytics or advertising trackers.",
    sections: [
      { title: "What this preview stores", paragraphs: ["tezu-privacy-v1 remembers that you acknowledged the storage notice. tezu-demo-display-name remembers the display name you saved in Settings. These entries stay on your device until you clear them.", "These are browser local-storage entries, rather than advertising cookies. No optional tracking cookies are set by this interface."] },
      { title: "Your choices", paragraphs: ["You can reopen the notice using Cookie settings below or in the footer. To remove the stored entries, clear this website’s site data in your browser. Blocking storage still lets you explore the site; your preferences may only last for the current session."] },
      { title: "Other services", paragraphs: ["Instagram links open an external website. That service has its own cookie and privacy policies. No Instagram embed or tracking script is loaded by this preview."] },
    ],
  },
};

export function LegalPage({ kind }: { kind: keyof typeof content }) {
  const page = content[kind];
  return <main className="tezu-secondary"><article className="secondary-legal"><h1>{page.title}</h1><p className="legal-updated">Updated October 23, 2026 · Website preview</p><div className="legal-copy"><p>{page.intro}</p>{page.sections.map(section => <section key={section.title} className="legal-section"><h2>{section.title}</h2>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}<section className="legal-section"><h2>TEZU Studio</h2><p><a href={publicContact.instagram} target="_blank" rel="noreferrer">Contact {publicContact.handle} on Instagram</a></p><CookieSettingsButton /><p><Link href="/privacy">Privacy Policy</Link> · <Link href="/terms">Terms &amp; Conditions</Link> · <Link href="/cookies">Cookie Policy</Link></p></section></div></article></main>;
}
