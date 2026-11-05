import { redirect } from "next/navigation";
import { authClients, requireProtectedSession } from "@/lib/auth/server";
import { localPath } from "@/lib/local-path";
import { headers } from "next/headers";
import { requireEdgeOrigin } from "@/lib/security/edge-origin";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  requireEdgeOrigin({ headers: await headers() });
  // Cookie refreshes run through /api/auth/session, where response cookies can be written.
  const context = await requireProtectedSession(await authClients(false)).catch(() => null);
  if (!context) redirect(localPath("/auth/verify"));
  return (
    <main id="main-content">
      <h1>Your account</h1>
      <p>Video credits: {context.credits}</p>
      <a href={localPath("/blue")}>Back to Flashloop</a>
    </main>
  );
}
