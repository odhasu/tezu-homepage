# PostHog wizard and Sentry plugin setup

Updated: 5 November 2026. The user requested `npx -y @posthog/wizard@latest` and reported installing the Sentry plugin. This continues [OBSERVABILITY.md](OBSERVABILITY.md); it does not replace its privacy, environment-separation or live acceptance requirements.

## Wizard execution

The registry resolved `@posthog/wizard@latest` to **2.89.0**. Its general and audit help commands completed successfully under Node.js 24.22.2. The existing Flashloop application already has manual server-side Capture API instrumentation and explicit consent/privacy controls, so the wizard's supported audit mode was selected instead of replacing those controls with a default SDK installation.

A private temporary copy of `apps/flashloop` was created for review. It excludes real `.env*` files, `.vercel`, Git metadata, installed dependencies, output directories and log files; the blank `.env.example` is retained. The authoring application, unrelated work and newer deployment checkout were not changed. Extra instructions in the temporary copy restrict the audit to a safe Markdown report and prohibit credentials in files/output, source rewrites, package installation, project/billing changes, autocapture, replay and user identification.

The actual supported command is:

```sh
npx -y @posthog/wizard@latest audit all \
  --no-signup \
  --no-telemetry \
  --log-file /dev/null
```

It ran in the temporary app copy. `--no-signup` selects existing-account OAuth. Browser authorization completed. Two audit runs exited zero and claimed success, including a second run with the explicit canonical install directory, but neither produced the claimed `posthog-audit-report.md`. The observed fourteen-check ledger initially had all fourteen checks pending and later disappeared during cleanup. Independent installed-source review identified a false-success path; this is not a passed audit. Both processes ended. No further identical retry is warranted. No OAuth code, token, callback URL or project credential is recorded here. No application source was replaced by wizard defaults.

### Wizard privacy scope

In installed 2.89.0, `--no-telemetry` disables run/task uploads and codebase-scan sharing, but does **not** fully disable the wizard's own analytics client. The installed analytics module still constructs a client with exception capture and can send setup-account identification and ordinary wizard events. Do not describe this flag as a complete network or analytics opt-out. `--log-file /dev/null` avoids a persistent wizard debug log. This tooling behavior is separate from the application's stricter website consent boundary; no customer media or credential-bearing environment files were supplied in the audit snapshot.

The wizard presents a source-code/AI-processing notice and browser authorization. Account/project authorization belongs in that browser flow. Never ask the user to paste a callback, OAuth code, ingestion token or personal API key into chat. Do not approve a new account/region, paid plan, production reuse or broader tracking because the command happens to support it. Review any resulting report for prohibited data before copying safe findings back into the authoring notes.

## Sentry plugin capability

The newly installed skill is [Sentry (Read-only Observability)](/Users/oscargraafmans/.codex/plugins/cache/openai-curated-remote/sentry/0.1.2/skills/sentry/SKILL.md). Its instructions explicitly require `SENTRY_AUTH_TOKEN` and use a bundled read-only Python API script. The current root and newly spawned agent tool inventories exposed no OAuth-backed Sentry tools. This does not prove that the user's installation or connection failed.

A value-preserving boolean check found no `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` or `SENTRY_PROJECT` in this session's environment. No credential value was read or printed. The user was asked to configure a read-only token securely for this session, or choose a signed-in browser fallback. The skill says: “Never ask the user to paste the full token in chat. Ask them to set it locally and confirm when ready.”

The user selected the signed-in browser fallback and completed sign-in. The observed organization is `kumi-jq`; onboarding stopped at Connect repository after manual setup was selected. No repository was connected, project/DSN configured, or staging failure received. Installing this skill alone does not satisfy the controlled staging-failure acceptance check.

## Current acceptance state

The existing local implementation and verification remain as recorded in [VERIFICATION.md](VERIFICATION.md). The connected PostHog project is `kumi / Default project` (`334651`); `project-get` confirmed EU ingestion at `https://eu.i.posthog.com`. Separate staging/production projects were not created or configured. No application tests were rerun for this documentation correction. Sentry project creation, approved processing/consent policies and alerts, separate environment configuration, actual received events, and the custom-domain/edge rollout remain live gates. Browser authorization and a zero wizard exit code do not establish completed setup or privacy acceptance.
