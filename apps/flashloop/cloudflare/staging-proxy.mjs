// Staging front door only. Next.js, authorization and durable jobs stay on Vercel.
// Configuration belongs in provider bindings; no credential belongs in this file.
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};
const PROOF = "x-flashloop-edge-key";
const PUBLIC_HOST = "x-flashloop-public-host";
const CLIENT_IP = "x-flashloop-client-ip";
const PRIVATE_PATHS = ["/api", "/auth", "/account"];
const HOP_HEADERS = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

function privateHeaders(headers) {
  for (const [name, value] of Object.entries(PRIVATE_HEADERS)) headers.set(name, value);
  const vary = headers.get("Vary");
  if (vary !== "*") {
    const fields = (vary ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    for (const field of ["Cookie", "Authorization"]) {
      if (!fields.some((value) => value.toLowerCase() === field.toLowerCase())) fields.push(field);
    }
    headers.set("Vary", fields.join(", "));
  }
  return headers;
}

function failure(message, status) {
  return new Response(message, { status, headers: privateHeaders(new Headers({ "Content-Type": "text/plain; charset=utf-8" })) });
}

function configuredOrigin(value, upstream = false) {
  if (typeof value !== "string") throw new Error("Invalid configuration");
  const url = new URL(value);
  const labels = url.hostname.split(".");
  if (url.protocol !== "https:" || url.origin !== value || url.port || labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    (upstream ? !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname) : url.hostname.endsWith(".vercel.app"))) {
    throw new Error("Invalid configuration");
  }
  return url;
}

function configuration(env) {
  const publicOrigin = configuredOrigin(env.PUBLIC_ORIGIN);
  const upstreamOrigin = configuredOrigin(env.UPSTREAM_ORIGIN, true);
  const secret = env.EDGE_ORIGIN_SECRET;
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256 || secret.trim() !== secret) {
    throw new Error("Invalid configuration");
  }
  return { publicOrigin, upstreamOrigin, secret };
}

function clientIp(request) {
  // Cloudflare supplies this inbound header. The Vercel boundary parses it
  // again with node:net after authenticating proof from this Worker.
  const value = request.headers.get("CF-Connecting-IP");
  if (!value || value.length > 45 || !/^[0-9a-f:.]+$/i.test(value)) throw new Error("Missing client network");
  if (value.includes(":")) {
    const parsed = new URL(`http://[${value}]/`);
    if (!parsed.hostname.startsWith("[")) throw new Error("Invalid client network");
  } else {
    const fields = value.split(".");
    if (fields.length !== 4 || fields.some((field) => !/^\d{1,3}$/.test(field) || Number(field) > 255 ||
      (field.length > 1 && field.startsWith("0")))) throw new Error("Invalid client network");
  }
  return value;
}

function stripHopHeaders(headers) {
  for (const value of (headers.get("Connection") ?? "").split(",")) {
    if (value.trim()) headers.delete(value.trim());
  }
  for (const name of [...headers.keys()]) {
    if (HOP_HEADERS.has(name.toLowerCase())) headers.delete(name);
  }
}

function upstreamHeaders(request, settings, ip) {
  const headers = new Headers(request.headers);
  stripHopHeaders(headers);
  // Overwrite all proof/forwarding input, including fields used by other proxies.
  for (const name of [...headers.keys()]) {
    const lower = name.toLowerCase();
    if (lower === "host" || lower === "forwarded" || lower === "x-real-ip" || lower === "cf-connecting-ip" ||
      lower === "cf-connecting-ipv6" || lower === "cf-worker" || lower === "cf-ray" ||
      lower.startsWith("x-forwarded-") || lower.startsWith("x-vercel-") || lower.startsWith("x-flashloop-")) headers.delete(name);
  }
  headers.set("Host", settings.upstreamOrigin.host);
  headers.set(PROOF, settings.secret);
  headers.set(PUBLIC_HOST, settings.publicOrigin.host);
  headers.set(CLIENT_IP, ip);
  return headers;
}

function redirectLocation(value, target, settings) {
  const destination = new URL(value, target);
  if (destination.username || destination.password ||
    ![settings.publicOrigin.origin, settings.upstreamOrigin.origin].includes(destination.origin)) {
    throw new Error("Unexpected redirect");
  }
  destination.protocol = settings.publicOrigin.protocol;
  destination.host = settings.publicOrigin.host;
  return destination.toString();
}

function privatePath(pathname) {
  return PRIVATE_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Synthetic tests inject fetch; the deployed entrypoint uses the platform fetch. */
export async function handleStagingProxy(request, env, fetchUpstream = fetch) {
  if (env?.ENABLED !== "true") return failure("Staging is unavailable.", 503);
  let settings;
  try { settings = configuration(env); } catch { return failure("Staging is not configured.", 503); }
  const incoming = new URL(request.url);
  const explicitHost = request.headers.get("Host");
  if (incoming.origin !== settings.publicOrigin.origin || (explicitHost && explicitHost !== settings.publicOrigin.host)) {
    return failure("Use the staging address.", 403);
  }
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method) || request.headers.has("Upgrade")) {
    return failure("Request method is unavailable.", 405);
  }
  let ip;
  try { ip = clientIp(request); } catch { return failure("Client network is unavailable.", 403); }
  const target = new URL(settings.upstreamOrigin);
  // Assign properties instead of resolving a visitor-controlled //hostname path.
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  try {
    const init = {
      method: request.method,
      headers: upstreamHeaders(request, settings, ip),
      redirect: "manual",
      // Subrequest caching cannot authorize or retain a private request.
      cache: "no-store",
      signal: request.signal,
    };
    if (!["GET", "HEAD"].includes(request.method)) { init.body = request.body; init.duplex = "half"; }
    const response = await fetchUpstream(target.toString(), init);
    const headers = new Headers(response.headers);
    stripHopHeaders(headers);
    headers.delete("Refresh");
    for (const name of [...headers.keys()]) {
      if (name.toLowerCase().startsWith("x-flashloop-")) headers.delete(name);
    }
    const location = headers.get("Location");
    if (location) {
      try { headers.set("Location", redirectLocation(location, target, settings)); }
      catch { await response.body?.cancel(); return failure("Staging redirect is unavailable.", 502); }
    }
    // Encoded paths can be normalized differently by upstream routing; never
    // cache an ambiguous representation before its authorization boundary.
    if (privatePath(incoming.pathname) || incoming.pathname.includes("%") || response.status >= 300 || headers.has("Set-Cookie") ||
      request.headers.has("Cookie") || request.headers.has("Authorization")) privateHeaders(headers);
    // Preserve streamed HTML/RSC/media and distinct Set-Cookie headers.
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    // Transport errors can contain URLs or credentials; never expose or log them.
    return failure("Staging is temporarily unavailable.", 502);
  }
}

export default { fetch: (request, env) => handleStagingProxy(request, env) };
