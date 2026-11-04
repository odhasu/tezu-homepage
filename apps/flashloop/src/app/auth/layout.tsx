import { localPath } from "@/lib/local-path";
import "@/components/auth/auth.css";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="auth-shell">
      <header className="auth-header">
        <a className="auth-brand" href={localPath("/blue")} aria-label="Flashloop home">Flashloop</a>
        <a className="auth-back" href={localPath("/blue")}>Back to home</a>
      </header>
      <main id="main-content" className="auth-main">{children}</main>
    </div>
  );
}
