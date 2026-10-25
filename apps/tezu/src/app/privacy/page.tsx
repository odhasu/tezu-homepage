import { pageMetadata } from "@/lib/site-metadata";
import { LegalPage } from "@/components/sites/tezu/LegalPage";
export const metadata = pageMetadata("Privacy Policy · TEZU", "Understand how the TEZU preview handles local drafts, browser preferences, and information you choose to share with the studio.", "/privacy", true);
export default function Page() { return <LegalPage kind="privacy" />; }
