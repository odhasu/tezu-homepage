import type { Metadata } from "next";
import { ProductPage } from "@/components/sites/flashloop/ProductPage";
import { studioLink } from "@/lib/links";

export const metadata: Metadata = { title: "Model preview | Flashloop" };
const models = [
  ["Kling 4.0", "video"], ["Kling 3.0", "video"], ["Sora 2", "video"],
  ["Seedance 2.5", "video"], ["Veo 3.1", "video"], ["Wan 3.0", "video"], ["MiniMax Hailuo 3", "video"],
  ["Nano Banana 2.1", "image"], ["Nano Banana Pro", "image"], ["GPT Image 2", "image"], ["Flux 2", "image"], ["Seedream 5.0", "image"],
] as const;

export default function ModelsPage() {
  return <ProductPage eyebrow="Image & video" title="Find the tools for your idea.">
    <p>These model options are part of the website preview. Live generation is not available, and selecting a model does not submit a paid request.</p>
    <ul>{models.map(([name, kind]) => <li key={name}><a href={studioLink(kind)}><span>{name}<small>{kind === "image" ? "Image workspace" : "Video workspace"}</small></span><span aria-hidden="true">↗</span></a></li>)}</ul>
  </ProductPage>;
}
