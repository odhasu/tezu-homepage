"use client";

import Link from "next/link";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="utility-page"><p className="utility-kicker">Scene interrupted</p><h1>Let&apos;s try that again.</h1><p>This page couldn&apos;t load. Retry, or head back to the studio.</p><div className="utility-actions"><button className="primary-button" onClick={retry}>Try again</button><Link className="secondary-button" href="/">Back to home</Link></div></main>;
}
