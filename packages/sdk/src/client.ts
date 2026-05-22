import type { LeadEventV1 } from "./types";
import { sendLeadEvent, type SendLeadEventConfig, type SendLeadEventResult } from "./send";
import { LeadRailsConfigError } from "./errors";

export interface ClientOptions {
  clientId: string;
  sourceId: string;
  keyId: string;
  signingSecret: string;
  apiUrl?: string;
  idempotencyWindowMs?: number;
  fetch?: typeof fetch;
  onRequest?: SendLeadEventConfig["onRequest"];
  onError?: SendLeadEventConfig["onError"];
}

export interface LeadRailsClient {
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
      throw new LeadRailsConfigError(
        `@leadrails/sdk: signing secret is present in env var "${key}". ` +
          `NEXT_PUBLIC_* env vars are inlined into the browser bundle — this would leak the secret. ` +
          `Move the secret to a server-only env var (drop the NEXT_PUBLIC_ prefix).`,
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
