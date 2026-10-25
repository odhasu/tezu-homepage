import Link from "next/link";
import { pageMetadata } from "@/lib/site-metadata";

export const metadata = pageMetadata("Scene not found · TEZU", "This page has moved or does not exist. Find your next story in TEZU Studio.", "/404", false);

export default function NotFound() {
  return <main className="utility-page not-found-page"><span className="missing-scene-number" aria-hidden="true">404</span><p className="utility-kicker">Missing scene</p><h1>This scene isn’t here.</h1><p>The page may have moved. Your next story can still start in the studio.</p><div className="utility-actions"><Link className="primary-button" href="/#tools">Open Cartoon Maker</Link><Link className="secondary-button" href="/">Back to home</Link></div></main>;
}
