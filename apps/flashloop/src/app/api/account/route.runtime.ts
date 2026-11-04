import { authClients, requireProtectedSession } from "@/lib/auth/server";
import { authError, authJson } from "@/lib/auth/handlers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireProtectedSession(await authClients());
    return authJson({ userId: context.user_id, videoCredits: context.credits });
  } catch (error) { return authError(error); }
}
