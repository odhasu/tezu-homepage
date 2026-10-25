import { pageMetadata } from "@/lib/site-metadata";
import { PricingPage } from "@/components/sites/tezu/Pricing";
export const metadata = pageMetadata("TEZU Pricing · Plans for your next story", "Compare TEZU plans, monthly credits, character tools, images, and video options. Explore proposed launch pricing before choosing your creative workflow.", "/pricing", true);
export default function Page() { return <PricingPage />; }
