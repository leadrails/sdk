import type { LeadEventV1 } from "./types.js";
import { sendLeadEvent, type SendLeadEventConfig, type SendLeadEventResult } from "./send.js";
import { LeadRailsConfigError } from "./errors.js";

/**
 * Configuration for a LeadRails client. Pass these to
 * `createClient()` to override the defaults that would otherwise be
 * read from the `LEADRAILS_*` env vars. Every field except the four
 * credentials is optional.
 */
export interface ClientOptions {
  /** LeadRails client identifier (`cli_...`). Maps to `LEADRAILS_CLIENT_ID`. */
  clientId: string;
  /** LeadRails source identifier (`src_...`). Maps to `LEADRAILS_SOURCE_ID`. */
  sourceId: string;
  /** Signing key identifier (`key_...`). Maps to `LEADRAILS_KEY_ID`. */
  keyId: string;
  /** HMAC signing secret (server-only). Maps to `LEADRAILS_SIGNING_SECRET`. NEVER prefix with `NEXT_PUBLIC_`. */
  signingSecret: string;
  /** Override the intake endpoint. Defaults to `https://intake.leadrails.dev`. */
  apiUrl?: string;
  /** Window (ms) used to derive the default idempotency key. Defaults to 60_000. */
  idempotencyWindowMs?: number;
  /** Inject a custom `fetch` (useful for tests, retries, or instrumented clients). */
  fetch?: typeof fetch;
  /** Observability hook fired after every request (success or failure). */
  onRequest?: SendLeadEventConfig["onRequest"];
  /** Observability hook fired on every thrown error. */
  onError?: SendLeadEventConfig["onError"];
}

/**
 * A pre-configured LeadRails client returned by `createClient()`.
 * Call `.send(event)` to sign and POST a `LeadEventV1`. Errors are
 * thrown as `LeadRailsApiError` / `LeadRailsAuthError`; the success
 * value is a `SendLeadEventResult`.
 */
export interface LeadRailsClient {
  /**
   * Sign and POST a lead event. `overrides.idempotencyKey` replaces
   * the default content-hash-based key for this single call.
   */
  send(event: LeadEventV1, overrides?: { idempotencyKey?: string }): Promise<SendLeadEventResult>;
}

const ENV_VAR_NAMES = [
  "LEADRAILS_CLIENT_ID",
  "LEADRAILS_SOURCE_ID",
  "LEADRAILS_KEY_ID",
  "LEADRAILS_SIGNING_SECRET",
] as const;

/**
 * Create a pre-configured LeadRails client. Pass credentials
 * explicitly, OR call with no args to auto-read the standard
 * `LEADRAILS_*` env vars (`LEADRAILS_CLIENT_ID`,
 * `LEADRAILS_SOURCE_ID`, `LEADRAILS_KEY_ID`,
 * `LEADRAILS_SIGNING_SECRET`, optional `LEADRAILS_API_URL`).
 *
 * Throws `LeadRailsConfigError` if the signing secret was read from
 * a `NEXT_PUBLIC_*`-prefixed env var (a security guardrail —
 * NEXT_PUBLIC_* values are bundled into the browser).
 */
export function createClient(opts?: Partial<ClientOptions>): LeadRailsClient {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const apiUrl = opts?.apiUrl ?? env.LEADRAILS_API_URL;
  const config: ClientOptions = {
    clientId: opts?.clientId ?? env.LEADRAILS_CLIENT_ID ?? "",
    sourceId: opts?.sourceId ?? env.LEADRAILS_SOURCE_ID ?? "",
    keyId: opts?.keyId ?? env.LEADRAILS_KEY_ID ?? "",
    signingSecret: opts?.signingSecret ?? env.LEADRAILS_SIGNING_SECRET ?? "",
    ...(apiUrl !== undefined ? { apiUrl } : {}),
    ...(opts?.idempotencyWindowMs !== undefined ? { idempotencyWindowMs: opts.idempotencyWindowMs } : {}),
    ...(opts?.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts?.onRequest !== undefined ? { onRequest: opts.onRequest } : {}),
    ...(opts?.onError !== undefined ? { onError: opts.onError } : {}),
  };

  for (const name of ENV_VAR_NAMES) {
    if (!config[envVarToOption(name)]) {
      throw new LeadRailsConfigError(
        `@leadrails/sdk: missing required value for ${name} (or the equivalent constructor option).`,
      );
    }
  }

  // NEXT_PUBLIC_* guard — refuse to use a secret loaded from a
  // public-prefixed env var, even if the user explicitly passed it
  // in. The exact secret value is what's checked against every
  // env var; if any NEXT_PUBLIC_* var has the same value, throw.
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (typeof value === "string" && value === config.signingSecret) {
      const renamed = key.replace(/^NEXT_PUBLIC_/, "");
      throw new LeadRailsConfigError(
        `@leadrails/sdk: signing secret is set in env var "${key}". ` +
          `NEXT_PUBLIC_* env vars are inlined into the browser bundle by Next.js — ` +
          `this would leak the secret to every visitor. ` +
          `Rename "${key}" to "${renamed}" in your .env (and in your hosting platform's env-var settings).`,
      );
    }
  }

  return {
    send(event, overrides) {
      return sendLeadEvent(event, {
        clientId: config.clientId,
        sourceId: config.sourceId,
        keyId: config.keyId,
        signingSecret: config.signingSecret,
        ...(config.apiUrl !== undefined ? { apiUrl: config.apiUrl } : {}),
        ...(config.idempotencyWindowMs !== undefined
          ? { idempotencyWindowMs: config.idempotencyWindowMs }
          : {}),
        ...(config.fetch !== undefined ? { fetch: config.fetch } : {}),
        ...(config.onRequest !== undefined ? { onRequest: config.onRequest } : {}),
        ...(config.onError !== undefined ? { onError: config.onError } : {}),
        ...(overrides?.idempotencyKey !== undefined
          ? { idempotencyKey: overrides.idempotencyKey }
          : {}),
      });
    },
  };
}

function envVarToOption(envVar: (typeof ENV_VAR_NAMES)[number]): keyof ClientOptions {
  switch (envVar) {
    case "LEADRAILS_CLIENT_ID":
      return "clientId";
    case "LEADRAILS_SOURCE_ID":
      return "sourceId";
    case "LEADRAILS_KEY_ID":
      return "keyId";
    case "LEADRAILS_SIGNING_SECRET":
      return "signingSecret";
  }
}
