import { pageMetadata } from "@/lib/site-metadata";
import { LegalPage } from "@/components/sites/tezu/LegalPage";
export const metadata = pageMetadata("Terms & Conditions · TEZU", "Read the terms for exploring TEZU Studio, using creative references, and discussing commissioned projects before production begins.", "/terms", true);
export default function Page() { return <LegalPage kind="terms" />; }
