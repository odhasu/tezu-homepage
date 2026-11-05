import type { Metadata } from "next";
import { PlanCards } from "@/components/billing/PlanCards";
import styles from "@/components/billing/billing.module.css";
import { localPath } from "@/lib/local-path";

export const metadata: Metadata = { title: "Monthly plans | Flashloop" };

export default function PricingPage() {
  // Keep the public page honest: an unset billing flag means no checkout is open.
  const runtimeAvailable = process.env.STATIC_EXPORT !== "true" && process.env.BILLING_ENABLED === "true" && process.env.BILLING_FULFILL_ENABLED === "true";
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <a className={styles.brand} href={localPath("/blue/")}>Flashloop</a>
        <a className={styles.back} href={localPath("/blue/")}>Back to creating</a>
      </header>
      <main className={styles.main} id="main-content">
        <div className={styles.intro}>
          <h1>Choose your monthly credits.</h1>
          <p>A monthly plan for your next ideas. Compare credit allowances and recurring prices before continuing to Whop.</p>
        </div>
        {!runtimeAvailable && <p className={styles.notice}>Subscriptions are not open in this preview. No payment is taken here.</p>}
        <PlanCards runtimeAvailable={runtimeAvailable} />
        <p className={styles.terms}>All plans are in EUR and renew monthly until canceled. Unused subscription credits do not roll over. Canceling stops future renewals; your paid period continues until its end. Whop shows the final total before you confirm payment.</p>
      </main>
    </div>
  );
}
