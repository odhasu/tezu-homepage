import { pageMetadata } from "@/lib/site-metadata";
import { HirePage } from "@/components/sites/tezu/HirePage";
export const metadata = pageMetadata("Hire TEZU · Character stories made for you", "Bring your idea to TEZU Studio. Explore our animation work and build a project brief for character stories, creator content, and brand campaigns.", "/hire", true);
export default function Page() { return <HirePage />; }
