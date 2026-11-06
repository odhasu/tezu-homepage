import type { Metadata } from "next";
import { ProductPage } from "@/components/sites/flashloop/ProductPage";
import { studioLink } from "@/lib/links";

export const metadata: Metadata = { title: "Creators | Flashloop" };

export default function CreatorsPage() {
  return <ProductPage eyebrow="Made for creators" title="From an idea to your next story.">
    <p>Explore the image and video workspaces, try a prompt, and find a look for your next project.</p>
    <p>Creator program applications are not open in this preview. No application or personal information is collected here.</p>
    <a href={studioLink("video")}>Open video workspace</a>
    <a href={studioLink("image")}>Open image workspace</a>
  </ProductPage>;
}
