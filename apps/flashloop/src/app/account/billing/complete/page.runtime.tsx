import type { Metadata } from "next";
import { localPath } from "@/lib/local-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment return | Flashloop" };

export default function BillingCompletePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "6rem 1.5rem", color: "white" }}>
      <p>Whop returned you to Flashloop.</p>
      <h1>Refresh your billing status.</h1>
      <p>Credits appear only after Whop’s signed event is reconciled. This page does not grant access from a redirect.</p>
      <p><a href={localPath("/account/billing")}>Open billing status</a></p>
    </main>
  );
}
