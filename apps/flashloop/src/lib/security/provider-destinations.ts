import "server-only";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { AuthFailure } from "@/lib/auth/security";

const callbackPath = "/api/providers/callback";

function destinationFailure(status = 400): AuthFailure {
  return new AuthFailure("Provider destination is not permitted.", status);
}

/** No URL credentials, IP literals, alternate ports, local hostnames, or parser-normalized authorities. */
function httpsUrl(value: string): URL {
  if (typeof value !== "string" || value.length > 8192 || /[\s\\]/.test(value)) throw destinationFailure();
  let url: URL;
  try { url = new URL(value); } catch { throw destinationFailure(); }
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/, 1)[0];
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash ||
    authority !== url.hostname || isIP(url.hostname) || !url.hostname.includes(".") ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(url.hostname) ||
    url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") ||
    url.hostname.endsWith(".internal") || url.hostname.endsWith(".home.arpa")) {
    throw destinationFailure();
  }
  return url;
}

function configuredOrigin(value: string | undefined): string {
  try {
    if (!value) throw destinationFailure();
    const url = httpsUrl(value);
    if (url.origin !== value) throw destinationFailure();
    return url.origin;
  } catch { throw destinationFailure(503); }
}

/** Empty allowlists deny all downloads; every entry must be a canonical HTTPS origin. */
export function validateProviderDownloadUrl(value: string): URL {
  const rawOrigins = process.env.PROVIDER_DOWNLOAD_ORIGINS;
  if (!rawOrigins) throw destinationFailure(503);
  const origins = rawOrigins.split(",").map((origin) => configuredOrigin(origin.trim()));
  const url = httpsUrl(value);
  if (!origins.includes(url.origin)) throw destinationFailure();
  return url;
}

/** Callback URL construction must use server configuration, never forwarded or request Host headers. */
export function validateProviderCallbackUrl(value: string): URL {
  const origin = configuredOrigin(process.env.AUTH_ORIGIN);
  const url = httpsUrl(value);
  if (url.origin !== origin || url.pathname !== callbackPath || url.search || value !== `${origin}${callbackPath}`) {
    throw destinationFailure();
  }
  return url;
}

/** Conservative public-unicast filter: refuse special-purpose networks even on an allowed hostname. */
function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6 || address.includes("%") || address.includes(".")) return false;
  const halves = address.toLowerCase().split("::");
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const words = halves.length === 1 ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
  const [first, second] = words.map((word) => Number.parseInt(word, 16));
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    !(first === 0x3fff && second <= 0x0fff);
}

async function resolvePinned(hostname: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const answers = await new Promise<Awaited<ReturnType<typeof lookup>>[]>((resolve, reject) => {
    const abort = () => reject(destinationFailure(502));
    signal.addEventListener("abort", abort, { once: true });
    lookup(hostname, { all: true, verbatim: true }).then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
  signal.throwIfAborted();
  if (!answers.length || answers.length > 32 || answers.some((answer) => !publicAddress(answer.address))) {
    throw destinationFailure();
  }
  return answers[0];
}

export type ProviderOutput = { body: Uint8Array; contentType: string; byteSize: number };

/**
 * Download only from the reviewed provider allowlist. DNS is resolved once, every
 * answer is checked, and the TLS socket is pinned to that checked address while
 * keeping the original hostname for certificate verification. No proxy, pooled
 * connection, redirect, caller-controlled header, or cookie jar is used.
 */
export async function fetchProviderOutput(value: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<ProviderOutput> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 20 * 1024 * 1024) {
    throw new AuthFailure("Invalid provider output limit.", 400);
  }
  const url = validateProviderDownloadUrl(value);
  const signal = AbortSignal.any([AbortSignal.timeout(8000), ...(options.signal ? [options.signal] : [])]);
  try {
    const pinned = await resolvePinned(url.hostname, signal);
    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
      else callback(null, pinned.address, pinned.family);
    };
    return await new Promise<ProviderOutput>((resolve, reject) => {
      const request = httpsRequest(url, {
        method: "GET", agent: false, lookup: pinnedLookup, servername: url.hostname,
        signal, headers: { "accept-encoding": "identity" }, maxHeaderSize: 16 * 1024,
      }, (response) => {
        const fail = (error: AuthFailure) => { response.destroy(); request.destroy(); reject(error); };
        if (response.statusCode !== 200) { fail(new AuthFailure("Provider output unavailable.", 502)); return; }
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
          fail(new AuthFailure("Encoded provider output is not supported.", 400)); return;
        }
        const declared = response.headers["content-length"];
        const expected = declared === undefined ? undefined : Number(declared);
        if (expected !== undefined && (!/^\d+$/.test(declared ?? "") || !Number.isSafeInteger(expected) || expected > options.maxBytes)) {
          fail(new AuthFailure("Provider output exceeds the storage limit.", 413)); return;
        }
        const chunks: Buffer[] = [];
        let byteSize = 0;
        response.on("data", (chunk: Buffer) => {
          byteSize += chunk.length;
          if (byteSize > options.maxBytes) { fail(new AuthFailure("Provider output exceeds the storage limit.", 413)); return; }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (!byteSize || (expected !== undefined && expected !== byteSize)) {
            reject(new AuthFailure("Incomplete provider output.", 400)); return;
          }
          resolve({ body: Buffer.concat(chunks), contentType: response.headers["content-type"] ?? "application/octet-stream", byteSize });
        });
        response.on("error", () => reject(new AuthFailure("Provider output unavailable.", 502)));
        response.on("aborted", () => reject(new AuthFailure("Provider output unavailable.", 502)));
      });
      request.on("error", () => reject(new AuthFailure("Provider output unavailable.", 502)));
      request.end();
    });
  } catch (error) {
    if (error instanceof AuthFailure) throw error;
    throw new AuthFailure("Provider output unavailable.", 502);
  }
}
