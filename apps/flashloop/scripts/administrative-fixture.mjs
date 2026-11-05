import { createHash, randomBytes } from "node:crypto";

const missingQuotaRpc = "Could not find the function public.get_signup_ip_quota(p_ip_key_hash) in the schema cache";

function setupFailure() {
  // Provider errors may contain request material. Never propagate their details.
  return new Error("Administrative fixture setup failed.");
}

/**
 * Prepare metadata for trusted admin.createUser authorization fixtures only.
 *
 * New-schema fixtures deliberately omit signup_permit. Supabase's administrative
 * creation endpoint inserts directly, without the public-signup hook; presenting
 * an unclaimed permit would correctly fail the new insertion trigger. See:
 * https://github.com/supabase/auth/blob/d7955e9eb54003c4abbd7808e774c810d5d3e6cc/internal/api/admin.go
 * https://supabase.com/docs/reference/javascript/auth-admin-createuser
 *
 * The quota read detects the migration without issuing or consuming a permit.
 * These fixtures do not prove signup, native-hook execution, or IP quota behavior.
 * Only the exact missing new RPC permits legacy compatibility, never an outage,
 * permission denial, quota denial, ambiguous signature, or malformed response.
 */
export async function prepareAdministrativeFixture(admin, { email, fixtureId, userMetadata = {} }) {
  if (typeof email !== "string" || !email.endsWith("@example.invalid") ||
    typeof fixtureId !== "string" || !fixtureId || fixtureId.length > 256 ||
    !userMetadata || typeof userMetadata !== "object" || Array.isArray(userMetadata) ||
    Object.hasOwn(userMetadata, "signup_permit")) throw setupFailure();

  // Public test namespace, not a real IP or a production IP-hashing secret.
  const fixtureIpHash = createHash("sha256")
    .update("flashloop:administrative-fixture:").update(fixtureId).digest("hex");
  let quota;
  try {
    quota = await admin.rpc("get_signup_ip_quota", { p_ip_key_hash: fixtureIpHash });
  } catch {
    throw setupFailure();
  }

  if (quota?.error) {
    if (quota.error.code !== "PGRST202" || quota.error.message !== missingQuotaRpc) throw setupFailure();
    const permit = randomBytes(32).toString("hex");
    let issued;
    try {
      issued = await admin.rpc("issue_signup_permit", {
        p_email: email,
        p_permit_hash: createHash("sha256").update(permit).digest("hex"),
      });
    } catch {
      throw setupFailure();
    }
    if (issued?.error || issued?.data !== true) throw setupFailure();
    return { schema: "legacy", userMetadata: { ...userMetadata, signup_permit: permit } };
  }

  const data = quota?.data;
  if (!data || typeof data !== "object" || Array.isArray(data) ||
    Object.keys(data).length !== 2 || data.allowed !== true || data.retry_after_seconds !== 0) {
    throw setupFailure();
  }
  return { schema: "ip-bound", userMetadata: { ...userMetadata } };
}
