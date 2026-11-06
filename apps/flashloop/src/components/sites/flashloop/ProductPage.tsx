import { Header, Footer } from "./SiteShell";
import styles from "./product-page.module.css";

export function ProductPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="shell-app">
      <Header />
      <main className={styles.main} id="main-content">
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <div className={styles.content}>{children}</div>
      </main>
      <Footer />
    </div>
  );
}
