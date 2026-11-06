import { redirect } from "next/navigation";
import { authClients, requireProtectedSession } from "@/lib/auth/server";
import { localPath } from "@/lib/local-path";
import { headers } from "next/headers";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";
import { GenerationDashboard } from "@/components/dashboard/GenerationDashboard";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  requireEdgeOrigin({ headers: await headers() });
  // Cookie refreshes run through /api/auth/session, where response cookies can be written.
  const context = await requireProtectedSession(await authClients(false)).catch(() => null);
  if (!context) redirect(localPath("/auth/verify"));
  const kind = (await searchParams).kind === "image" ? "image" : "video";
  return <GenerationDashboard key={kind} kind={kind} runtime />;
}
