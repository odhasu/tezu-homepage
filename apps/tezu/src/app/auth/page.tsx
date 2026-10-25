import { pageMetadata } from "@/lib/site-metadata";
import { Suspense } from "react";
import { AuthWithQuery } from "./AuthWithQuery";

export const metadata = pageMetadata("Your account · TEZU", "Explore login and signup for TEZU, your studio for character stories, images, and animated video.", "/auth", false);

export default function Page() {
  return <Suspense fallback={<p role="status">Loading account…</p>}><AuthWithQuery /></Suspense>;
}
