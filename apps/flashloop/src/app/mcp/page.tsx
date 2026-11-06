import type { Metadata } from "next";
import { ProductPage } from "@/components/sites/flashloop/ProductPage";
import { studioLink } from "@/lib/links";

export const metadata: Metadata = { title: "ChatGPT connection | Flashloop" };

export default function McpPage() {
  return <ProductPage eyebrow="Flashloop connections" title="Create in your own workspace.">
    <p>The live ChatGPT connection is not available yet. This preview does not connect to your ChatGPT account or send conversations anywhere.</p>
    <p>You can explore the image and video tools directly in Flashloop.</p>
    <a href={studioLink("image")}>Explore image tools</a>
    <a href={studioLink("video")}>Explore video tools</a>
  </ProductPage>;
}
