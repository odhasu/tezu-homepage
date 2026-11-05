import { handleAnalyticsPageview } from "@/lib/analytics/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = handleAnalyticsPageview;
