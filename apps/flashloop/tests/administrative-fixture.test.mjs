import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { prepareAdministrativeFixture } from "../scripts/administrative-fixture.mjs";

const missing = {
  code: "PGRST202",
  message: "Could not find the function public.get_signup_ip_quota(p_ip_key_hash) in the schema cache",
};
const input = {
  email: "fixture@example.invalid", fixtureId: "helper-unit:run-one",
  userMetadata: { owner_id: "forged-owner", credits: 999, verified: true },
};

function scenario(responses) {
  const calls = [];
  const admin = { rpc: async (name, args) => {
    calls.push({ name, args });
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    return response;
  } };
  return { admin, calls };
}

test("new schema prepares explicit admin metadata without issuing a signup permit", async () => {
  const s = scenario([{ data: { allowed: true, retry_after_seconds: 0 }, error: null }]);
  const prepared = await prepareAdministrativeFixture(s.admin, input);
  assert.equal(prepared.schema, "ip-bound");
  assert.deepEqual(prepared.userMetadata, input.userMetadata);
  assert.notEqual(prepared.userMetadata, input.userMetadata);
  assert.equal(Object.hasOwn(prepared.userMetadata, "signup_permit"), false);
  assert.deepEqual(s.calls, [{ name: "get_signup_ip_quota", args: {
    p_ip_key_hash: createHash("sha256").update("flashloop:administrative-fixture:")
      .update(input.fixtureId).digest("hex"),
  } }]);
});

test("fixture quota probes use distinct synthetic hashes across tests", async () => {
  const s = scenario(Array.from({ length: 2 }, () => ({ data: { allowed: true, retry_after_seconds: 0 }, error: null })));
  await prepareAdministrativeFixture(s.admin, input);
  await prepareAdministrativeFixture(s.admin, { ...input, fixtureId: "helper-unit:run-two" });
  assert.match(s.calls[0].args.p_ip_key_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(s.calls[0].args.p_ip_key_hash, s.calls[1].args.p_ip_key_hash);
});

test("only exact missing new RPC selects legacy permit compatibility", async () => {
  const s = scenario([{ data: null, error: missing }, { data: true, error: null }]);
  const prepared = await prepareAdministrativeFixture(s.admin, input);
  assert.equal(prepared.schema, "legacy");
  assert.equal(prepared.userMetadata.credits, 999);
  assert.match(prepared.userMetadata.signup_permit, /^[0-9a-f]{64}$/);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[1].name, "issue_signup_permit");
  assert.deepEqual(s.calls[1].args, {
    p_email: input.email,
    p_permit_hash: createHash("sha256").update(prepared.userMetadata.signup_permit).digest("hex"),
  });
  assert.equal(JSON.stringify(s.calls).includes(prepared.userMetadata.signup_permit), false);
});

for (const [label, response] of [
  ["quota denial", { data: { allowed: false, retry_after_seconds: 345600 }, error: null }],
  ["grant denial", { data: null, error: { code: "42501", message: "credential-must-not-escape" } }],
  ["network error response", { data: null, error: { code: "", message: "credential-must-not-escape" } }],
  ["wrong missing RPC", { data: null, error: { ...missing, message: missing.message.replace("get_signup_ip_quota", "different_rpc") } }],
  ["ambiguous RPC", { data: null, error: { code: "PGRST203", message: missing.message } }],
  ["bare missing code", { data: null, error: { code: "PGRST202" } }],
  ["thrown provider failure", new Error("credential-must-not-escape")],
]) {
  test(`${label} cannot fall back to legacy permit issuance`, async () => {
    const s = scenario([response]);
    await assert.rejects(prepareAdministrativeFixture(s.admin, input), { message: "Administrative fixture setup failed." });
    assert.equal(s.calls.length, 1);
  });
}

for (const [label, data] of [
  ["missing response", null],
  ["string success", { allowed: "true", retry_after_seconds: 0 }],
  ["nonzero success retry", { allowed: true, retry_after_seconds: 1 }],
  ["missing retry", { allowed: true }],
  ["unexpected response fields", { allowed: true, retry_after_seconds: 0, secret: "credential-must-not-escape" }],
]) {
  test(`${label} fails closed before fixture preparation`, async () => {
    const s = scenario([{ data, error: null }]);
    await assert.rejects(prepareAdministrativeFixture(s.admin, input), { message: "Administrative fixture setup failed." });
    assert.equal(s.calls.length, 1);
  });
}

for (const [label, response] of [
  ["legacy permission failure", { data: null, error: { code: "42501", message: "credential-must-not-escape" } }],
  ["legacy disabled issuer", { data: null, error: { code: "55000", message: "credential-must-not-escape" } }],
  ["legacy network failure", new Error("credential-must-not-escape")],
  ["legacy false response", { data: false, error: null }],
  ["legacy malformed response", { data: "true", error: null }],
]) {
  test(`${label} cannot produce fixture metadata`, async () => {
    const s = scenario([{ data: null, error: missing }, response]);
    await assert.rejects(prepareAdministrativeFixture(s.admin, input), { message: "Administrative fixture setup failed." });
    assert.equal(s.calls.length, 2);
  });
}

test("only disposable fixture inputs accepted and caller cannot inject signup permit", async () => {
  for (const change of [
    { email: "someone@example.com" }, { fixtureId: "" }, { fixtureId: "x".repeat(257) },
    { userMetadata: null }, { userMetadata: [] }, { userMetadata: { signup_permit: "forged" } },
  ]) {
    const s = scenario([]);
    await assert.rejects(prepareAdministrativeFixture(s.admin, { ...input, ...change }), { message: "Administrative fixture setup failed." });
    assert.equal(s.calls.length, 0);
  }
});
