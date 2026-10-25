import { pageMetadata } from "@/lib/site-metadata";
import { AboutPage } from "@/components/sites/tezu/secondary-pages";
export const metadata = pageMetadata("About TEZU · A studio for stories that move", "Meet TEZU, the creative studio bringing characters, expressive animation, and cinematic storytelling to creators and brands.", "/about", true);
export default function Page() { return <AboutPage />; }
