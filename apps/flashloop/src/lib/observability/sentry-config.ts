export type SentryConfig = {
  environment: "staging" | "production";
  dsn: string;
  release: string;
  tracesSampleRate: number;
};

type Environment = Record<string, string | undefined>;

function validDsn(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.password && !url.port && !url.search && !url.hash &&
      /^[a-f0-9]{32}$/i.test(url.username) && /^\/[1-9][0-9]*$/.test(url.pathname) &&
      /^o[0-9]+\.ingest(?:\.(?:us|de))?\.sentry\.io$/.test(url.hostname);
  } catch { return false; }
}

/** Missing or invalid setup disables capture without printing configuration values. */
export function sentryConfig(env: Environment = process.env): SentryConfig | null {
  if (env.STATIC_EXPORT === "true" || env.SENTRY_ENABLED !== "true" || env.SENTRY_PRIVACY_APPROVED !== "true") return null;
  const environment = env.TELEMETRY_ENVIRONMENT;
  if (environment !== "staging" && environment !== "production") return null;
  // Releases are commit hashes only: arbitrary deployment names can contain personal data.
  const release = env.SENTRY_RELEASE;
  if (!release || !/^[a-f0-9]{7,64}$/i.test(release)) return null;
  const staging = env.SENTRY_STAGING_DSN;
  const production = env.SENTRY_PRODUCTION_DSN;
  if (validDsn(staging) && validDsn(production)) {
    const stagingProject = new URL(staging);
    const productionProject = new URL(production);
    if (stagingProject.hostname === productionProject.hostname && stagingProject.pathname === productionProject.pathname) return null;
  }
  const dsn = environment === "staging" ? staging : production;
  if (!validDsn(dsn)) return null;
  const rawRate = env.SENTRY_TRACES_SAMPLE_RATE ?? (environment === "staging" ? "1" : "0.1");
  if (!/^(?:0(?:\.[0-9]+)?|1(?:\.0+)?)$/.test(rawRate)) return null;
  const tracesSampleRate = Number(rawRate);
  return { environment, dsn, release: release.toLowerCase(), tracesSampleRate };
}
