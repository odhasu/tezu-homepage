const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, imports) {
  const code = ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib", path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, require(name) {
      if (!(name in imports) && name in require("./helpers/telemetry-dependencies.cjs")) return require("./helpers/telemetry-dependencies.cjs")[name];
      assert.ok(name in imports, `Unexpected dependency ${name}`);
      return imports[name];
    }, Request, Response, URL, TextDecoder, Uint8Array, Object, Number, Error,
  });
  return module.exports;
}

const security = load("auth/security.ts", {});
const owner = "10000000-0000-4000-8000-000000000001";
const project = "20000000-0000-4000-8000-000000000001";
const record = "30000000-0000-4000-8000-000000000001";
const origin = "https://kumi-staging.vercel.app";

function scenario({ session = true, parent = true, found = true, error = null } = {}) {
  const calls = [];
  const client = { from(table) {
    const query = { table, filters: [], operation: "select" };
    calls.push(query);
    const builder = {
      select(value) { query.columns = value; return builder; },
      insert(value) { query.operation = "insert"; query.value = value; return builder; },
      update(value) { query.operation = "update"; query.value = value; return builder; },
      delete() { query.operation = "delete"; return builder; },
      eq(key, value) { query.filters.push([key, value]); return builder; },
      order() { return builder; },
      limit(value) { query.limit = value; return Promise.resolve({ data: [], error }); },
      async single() { return { data: { id: record }, error }; },
      async maybeSingle() { return { data: query.columns === "id" ? (parent ? { id: project } : null) : (found ? { id: record } : null), error }; },
    };
    return builder;
  } };
  let validations = 0;
  const store = load("ownership/store.ts", {
    "server-only": {}, "@/lib/auth/security": security,
    "@/lib/auth/server": { assertUserDataClient: (candidate) => assert.equal(candidate, client), requireProtectedSession: async (clients) => {
      validations++;
      assert.equal(clients.client, client);
      assert.equal(clients.admin, undefined);
      if (!session) throw new security.AuthFailure("Sign in to continue.", 401);
      return { user_id: owner };
    } },
  });
  return { store, client, calls, validations: () => validations, execute: store.createOwnedStore(client).execute };
}

test("every data operation revalidates live user session", async () => {
  const s = scenario();
  await s.execute("projects", "list");
  await s.execute("projects", "read", { id: record });
  assert.equal(s.validations(), 2);
});

test("only factory-issued publishable-key user clients can enter ownership store", async () => {
  const user = {};
  const admin = {};
  const boundedProviderFetch = async () => { throw new Error("No provider request expected."); };
  const api = load("auth/server.ts", {
    "server-only": {}, "@supabase/ssr": { createServerClient: (_url, _key, options) => {
      assert.equal(options.global.fetch, boundedProviderFetch);
      return user;
    } },
    "@supabase/supabase-js": { createClient: (_url, _key, options) => {
      assert.equal(options.global.fetch, boundedProviderFetch);
      return admin;
    } },
    "node:crypto": require("node:crypto"), "./security": security,
    "@/lib/security/provider-fetch": { boundedProviderFetch },
    "./config": { authConfig: () => ({ origin, supabaseUrl: "https://project.supabase.co", publishableKey: "public-test-key", secretKey: "server-test-key" }) },
    "next/headers": { cookies: async () => ({ getAll: () => [], set() {} }) },
  });
  assert.throws(() => api.assertUserDataClient(admin), { status: 503 });
  const clients = await api.authClients();
  assert.equal(clients.client, user);
  assert.equal(clients.admin, admin);
  assert.doesNotThrow(() => api.assertUserDataClient(user));
  assert.throws(() => api.assertUserDataClient(admin), { status: 503 });
});

for (const table of ["accounts", "projects", "jobs", "uploads", "outputs"]) {
  test(`${table}: no query before session authorization`, async () => {
    const s = scenario({ session: false });
    await assert.rejects(s.execute(table, "list", { projectId: project }), { status: 401 });
    assert.equal(s.calls.length, 0);
  });
  for (const operation of ["list", "read", "update", "delete"]) {
    test(`${table} ${operation}: owner and parent scopes explicit`, async () => {
      const s = scenario();
      const body = table === "accounts" ? { display_name: "Profile" } : table === "projects" ? { name: "Project" }
        : table === "jobs" ? { label: "Job" } : { filename: "Asset" };
      await s.execute(table, operation, { projectId: project, id: table === "accounts" ? undefined : record, body });
      const query = s.calls.at(-1);
      assert.ok(query.filters.some(([key, value]) => key === (table === "accounts" ? "user_id" : "owner_id") && value === owner));
      if (["jobs", "uploads", "outputs"].includes(table)) {
        assert.deepEqual(s.calls[0].filters, [["id", project], ["owner_id", owner]]);
        assert.ok(query.filters.some(([key, value]) => key === "project_id" && value === project));
      }
      if (operation === "list") assert.equal(query.limit, 100);
    });
  }
}

for (const table of ["jobs", "uploads", "outputs"]) test(`${table}: hidden parent returns 404 before child query`, async () => {
  const s = scenario({ parent: false });
  await assert.rejects(s.execute(table, "read", { projectId: project, id: record }), { status: 404 });
  assert.equal(s.calls.length, 1);
});

for (const [table, body] of [
  ["projects", { name: "Project", owner_id: "forged" }],
  ["accounts", { display_name: "Profile", user_id: "forged" }],
  ["jobs", { label: "Job", project_id: "forged" }],
  ["jobs", { label: "Job", status: "succeeded" }],
  ["uploads", { filename: "file", object_key: "another-owner-key" }],
  ["uploads", { filename: "file", byte_size: 123 }],
  ["outputs", { filename: "file", job_id: "forged" }],
  ["projects", JSON.parse('{"name":"Project","__proto__":{}}')],
]) test(`${table}: reject protected or unexpected fields ${Object.keys(body).at(-1)}`, () => {
  assert.throws(() => scenario().store.recordFields(table, "update", body), { status: 400 });
});

test("create binds trusted owner and scoped parent", async () => {
  const s = scenario();
  await s.execute("jobs", "create", { projectId: project, body: { label: "Draft" } });
  assert.equal(s.calls.at(-1).value.owner_id, owner);
  assert.equal(s.calls.at(-1).value.project_id, project);
  assert.equal(s.calls.at(-1).value.status, undefined);
});

test("outputs cannot be client-created", async () => {
  const s = scenario();
  await assert.rejects(s.execute("outputs", "create", { projectId: project, body: {} }), { status: 405 });
  assert.equal(s.calls.length, 1);
});

for (const byte_size of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1, "10"]) test(`invalid upload byte size ${byte_size}`, () => {
  assert.throws(() => scenario().store.recordFields("uploads", "create", { filename: "image.png", content_type: "image/png", byte_size }), { status: 400 });
});

test("missing row and database errors never expose database detail", async () => {
  await assert.rejects(scenario({ found: false }).execute("projects", "read", { id: record }), { status: 404 });
  await assert.rejects(scenario({ error: { code: "XX000", message: "private detail" } }).execute("projects", "list"),
    { message: "Project data unavailable.", status: 503 });
});

function handlerScenario(options = {}) {
  const s = scenario(options);
  const handlers = load("ownership/handlers.ts", {
    "server-only": {},
    "@/lib/auth/server": { authUserClient: async () => ({ client: s.client, config: { origin } }) },
    "@/lib/auth/security": security,
    "@/lib/security/edge-origin": { requireEdgeOrigin() {} },
    "@/lib/auth/handlers": {
      authJson: (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } }),
      authError: (error) => Response.json({ error: error.message }, { status: error.status ?? 503, headers: { "cache-control": "private, no-store" } }),
    },
    "@/lib/security/edge-origin": { requireEdgeOrigin: () => {} },
    "./store": s.store,
  });
  const request = (method, body, extra = {}) => new Request(`${origin}/api/projects`, {
    method, headers: { origin, "content-type": "application/json", "x-requested-with": "flashloop", ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...s, ...handlers, request };
}

test("handler rejects cross-site mutations without querying user data", async () => {
  const s = handlerScenario();
  const response = await s.handleOwnedRequest(s.request("POST", { name: "Test" }, { origin: "https://attacker.example" }));
  assert.equal(response.status, 403);
  assert.equal(s.calls.length, 0);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("handler passes only user client, returns uncached owner data", async () => {
  const s = handlerScenario();
  const response = await s.handleOwnedRequest(s.request("POST", { name: "Test" }));
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(s.calls[0].value.owner_id, owner);
});

test("handler denies unsigned session and unknown resources", async () => {
  const s = handlerScenario({ session: false });
  assert.equal((await s.handleOwnedRequest(s.request("GET"))).status, 401);
  assert.equal((await s.handleOwnedRequest(s.request("GET"), { projectId: project, resource: "video_credit_accounts" })).status, 404);
  assert.equal(s.calls.length, 0);
});
