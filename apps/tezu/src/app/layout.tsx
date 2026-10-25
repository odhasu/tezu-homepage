import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteShell } from "@/components/sites/tezu/SiteShell";
import { pageMetadata, siteDescription, siteUrl } from "@/lib/site-metadata";
import { PrivacyControls } from "@/components/sites/tezu/PrivacyControls";
import "./globals.css";
import "@/components/sites/tezu/site-essentials.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  ...pageMetadata("TEZU | Cartoon stories, familiar characters", siteDescription, "/"),
  metadataBase: siteUrl,
  applicationName: "TEZU",
  manifest: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/site.webmanifest`,
  icons: {
    icon: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.ico`, sizes: "any" }, { url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/favicon-32.png`, sizes: "32x32", type: "image/png" }],
    apple: [{ url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" className={`${geistSans.variable} ${geistMono.variable}`}><body><SiteShell>{children}</SiteShell><PrivacyControls /></body></html>;
}
