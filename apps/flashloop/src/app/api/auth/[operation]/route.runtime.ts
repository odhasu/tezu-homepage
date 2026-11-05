import { authOperation, observeRequest } from "@/lib/observability/request";
import { handleAuthGet, handleAuthPost } from "@/lib/auth/handlers";

export const runtime = "nodejs";

type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  const operation = (await context.params).operation;
  return observeRequest(request, authOperation(operation), () => handleAuthPost(request, operation));
}

export async function GET(request: Request, context: Context) {
  const operation = (await context.params).operation;
  return observeRequest(request, authOperation(operation), () => handleAuthGet(request, operation));
}
