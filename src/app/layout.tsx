import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tezu — Create with Tezu",
  description: "Explore Tezu cartoons, character swaps, images, and videos.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
