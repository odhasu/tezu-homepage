import type { Metadata } from "next";
import { GenerationDashboard } from "@/components/dashboard/GenerationDashboard";

export const metadata: Metadata = { title: "Video workspace | Flashloop" };

export default function VideoWorkspacePage() {
  return <GenerationDashboard kind="video" />;
}
