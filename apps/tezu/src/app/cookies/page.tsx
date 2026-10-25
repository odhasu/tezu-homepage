import { pageMetadata } from "@/lib/site-metadata";
import { LegalPage } from "@/components/sites/tezu/LegalPage";
export const metadata = pageMetadata("Cookie Policy · TEZU", "Learn about essential browser storage, saved local preferences, and how to clear your settings on TEZU.", "/cookies", true);
export default function Page() { return <LegalPage kind="cookies" />; }
