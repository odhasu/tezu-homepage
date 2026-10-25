import type { Metadata } from "next";
import { pageMetadata } from "@/lib/site-metadata";
import { notFound } from "next/navigation";
import { TemplateDetailPage } from "@/components/sites/tezu/library-pages";
import mediaContent from "@/components/sites/tezu/media-content.json";
const templates = mediaContent.filter((item) => item.kind === "template").map((item) => ({ title: item.title, slug: item.title.toLowerCase().replaceAll(" ", "-") }));
export function generateStaticParams() { return templates.map(({ slug }) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const title = templates.find((template) => template.slug === slug)?.title ?? "Template";
  return pageMetadata(`${title} · TEZU Video Template`, `Explore the ${title} cartoon video template. Choose your characters and plan your own version in TEZU Studio.`, `/templates/${slug}`);
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!templates.some((template) => template.slug === slug)) notFound();
  return <TemplateDetailPage slug={slug} />;
}
