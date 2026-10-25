import type { Metadata } from "next";

export const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://tezu.ai");
export const siteDescription = "Create your cast, build the scene, and direct your next cartoon video in TEZU. Character, image, and video tools in one creative studio.";

export function pageMetadata(title: string, description: string, path: string, index = true): Metadata {
  return {
    title,
    description,
    alternates: { canonical: new URL(path.replace(/^\//, ""), siteUrl).href },
    robots: { index, follow: index },
    openGraph: {
      type: "website",
      siteName: "TEZU",
      title,
      description,
      url: new URL(path.replace(/^\//, ""), siteUrl).href,
      images: [{ url: new URL("og-image.jpg", siteUrl).href, width: 1200, height: 630, alt: "TEZU — Your characters. Their next story." }],
    },
    twitter: { card: "summary_large_image", title, description, images: [new URL("og-image.jpg", siteUrl).href] },
  };
}
