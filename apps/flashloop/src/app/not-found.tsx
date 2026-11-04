import { localPath } from "@/lib/local-path";
export default function NotFound() {
  return (
    <main className="not-found">
      <h1>Let&apos;s get back to creating.</h1>
      <p>This page is outside the local homepage preview.</p>
      <a href={localPath("/blue/")}>Explore Flashloop →</a>
    </main>
  );
}
