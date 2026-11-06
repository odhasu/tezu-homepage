import type { Metadata } from "next";
import { GenerationDashboard } from "@/components/dashboard/GenerationDashboard";

export const metadata: Metadata = { title: "Image workspace | Flashloop" };

export default function ImageWorkspacePage() {
  return <GenerationDashboard kind="image" />;
}
