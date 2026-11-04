import { handleAuthGet, handleAuthPost } from "@/lib/auth/handlers";

export const runtime = "nodejs";

type Context = { params: Promise<{ operation: string }> };

export async function POST(request: Request, context: Context) {
  return handleAuthPost(request, (await context.params).operation);
}

export async function GET(request: Request, context: Context) {
  return handleAuthGet(request, (await context.params).operation);
}
