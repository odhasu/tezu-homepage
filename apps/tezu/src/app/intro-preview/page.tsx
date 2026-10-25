import { pageMetadata } from "@/lib/site-metadata";
import { IntroPreview } from "@/components/sites/tezu/IntroPreview";


export const metadata = pageMetadata("TEZU · Choose your entrance", "Compare four entrances for the TEZU balloon letters and preview their motion on the homepage.", "/intro-preview", false);
export default function IntroPreviewPage() {
  return <IntroPreview />;
}
