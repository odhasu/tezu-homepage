import type { CSSProperties } from "react";
import { localPath } from "@/lib/local-path";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@/components/sites/flashloop/reference-layout.css";
import "@/components/sites/flashloop/flashloop.css";

const tiktok = localFont({
  src: "../../public/sites/flashloop/tiktok-sans.woff2",
  variable: "--font-flashloop",
  display: "swap",
  weight: "100 900",
});
export const metadata: Metadata = {
  title: "Flashloop - AI Video & Image Generator",
  description:
    "Create images, videos, and stories with the latest AI models. An independent, editable frontend recreation of the Flashloop blue reference.",
  robots: { index: false, follow: false },
  icons: { icon: localPath("/sites/flashloop/blue/acda2036-logo-wordmark.webp") },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-flashloop-theme="blue" className={tiktok.variable}>
      <body style={{
        "--fl-atmosphere": `url(${localPath("/sites/flashloop/blue/c03dae77-film-studio-atmosphere.webp")})`,
        "--fl-model-panel": `url(${localPath("/sites/flashloop/9895368a-models-panel.webp")})`,
      } as CSSProperties}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
