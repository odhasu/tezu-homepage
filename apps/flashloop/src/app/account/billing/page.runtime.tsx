import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { BillingDashboard } from "@/components/billing/BillingDashboard";
import styles from "@/components/billing/billing.module.css";
import { authClients, requireProtectedSession } from "@/lib/auth/server";
import { monthlyPlan } from "@/lib/billing/catalog";
import { localPath } from "@/lib/local-path";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your subscription | Flashloop" };

export default async function BillingPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  requireEdgeOrigin({ headers: await headers() });
  const context = await requireProtectedSession(await authClients(false)).catch(() => null);
  if (!context) redirect(localPath("/auth/verify"));
  const query = await searchParams;
  const plan = monthlyPlan(query.tier);
  const linkQuery = query.link;
  const linkStatus = linkQuery === "success" || linkQuery === "failed" ? linkQuery : undefined;
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href={localPath("/blue/")}>Flashloop</a>
        <a className={styles.back} href={localPath("/account")}>Your account</a>
      </header>
      <main className={styles.main} id="main-content">
        <div className={styles.intro}>
          <h1>Your monthly plan.</h1>
          <p>Check your credits, connect your Whop account, and manage future renewals.</p>
        </div>
        <BillingDashboard initialTier={plan?.tier} linkStatus={linkStatus} />
      </main>
    </div>
  );
}
