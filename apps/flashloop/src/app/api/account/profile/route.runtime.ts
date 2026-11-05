import { observeRequest } from "@/lib/observability/request";
import { handleOwnedRequest } from "@/lib/ownership/handlers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, {}, true);
  });
}
export async function POST(request: Request) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, {}, true);
  });
}
export async function PATCH(request: Request) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, {}, true);
  });
}
export async function DELETE(request: Request) {
  return observeRequest(request, "authorization", async () => {
    return handleOwnedRequest(request, {}, true);
  });
}
