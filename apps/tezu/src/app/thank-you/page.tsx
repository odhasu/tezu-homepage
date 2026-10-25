import Link from "next/link";
import { Check, ArrowUpRight } from "lucide-react";
import { pageMetadata } from "@/lib/site-metadata";
import { publicContact } from "@/lib/public-contact";

export const metadata = pageMetadata("Your next step · TEZU Studio", "Your project brief is ready to share. Find the next step for your story with TEZU Studio.", "/thank-you", false);

export default function ThankYouPage() {
  return <main className="utility-page thank-you-page"><span className="utility-check"><Check size={28} aria-hidden="true" /></span><p className="utility-kicker">The next chapter</p><h1>Thanks for shaping<br />your story.</h1><p>Your brief is yours to share. Nothing is sent automatically from this preview.</p><ol className="thank-you-steps"><li>Copy your brief from the project review.</li><li>Send it to {publicContact.handle} on Instagram.</li><li>Discuss the scope and timing with the studio before production.</li></ol><div className="utility-actions"><a href={publicContact.instagram} target="_blank" rel="noreferrer" className="primary-button">Talk to {publicContact.handle}<ArrowUpRight size={16} aria-hidden="true" /></a><Link href="/hire#inquiry" className="secondary-button">Start another brief</Link></div><p className="utility-footnote">Keep your brief copied before leaving its review. This preview does not store project details.</p></main>;
}
