import { MONTHLY_PLANS, formatEuro } from "@/lib/billing/catalog";
import { localPath } from "@/lib/local-path";
import styles from "./billing.module.css";

export function PlanCards({ runtimeAvailable }: { runtimeAvailable: boolean }) {
  return (
    <div className={styles.plans}>
      {MONTHLY_PLANS.map((plan) => (
        <article key={plan.tier} className={styles.plan} aria-labelledby={`plan-${plan.tier}`}>
          <h2 id={`plan-${plan.tier}`}>{plan.name}</h2>
          <p className={styles.creditAmount}>{plan.credits.toLocaleString("en-GB")} <span>credits / month</span></p>
          <p className={styles.price}>{formatEuro(plan.initialPriceCents)} <span>/ month</span></p>
          <p className={styles.renewal}>
            {plan.initialPriceCents !== plan.renewalPriceCents
              ? `First month, then ${formatEuro(plan.renewalPriceCents)} / month.`
              : "Renews monthly until canceled."}
          </p>
          <ul className={styles.features}>
            <li>Credits reset after each paid renewal.</li>
            <li>No unused credit rollover.</li>
            <li>Cancel future renewals in Whop.</li>
          </ul>
          {runtimeAvailable
            ? <a className={styles.primary} href={localPath(`/account/billing?tier=${plan.tier}`)}>View {plan.name}</a>
            : <button type="button" className={styles.primary} disabled>Subscriptions coming soon</button>}
        </article>
      ))}
    </div>
  );
}
