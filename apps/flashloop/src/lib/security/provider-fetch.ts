import "server-only";

/** Provider responses may contain sessions or account data; never enter a fetch cache. */
export async function boundedProviderFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signals = [AbortSignal.timeout(8000)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return fetch(input, { ...init, cache: "no-store", next: undefined, signal: AbortSignal.any(signals) });
}
