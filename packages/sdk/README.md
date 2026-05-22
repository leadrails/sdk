# `@leadrails/sdk`

Server-only SDK to send HMAC-signed lead events to [LeadRails](https://leadrails.dev/?ref=npm). Works in Node ≥18, Bun, Deno, Cloudflare Workers, Vercel Edge.

## Install

```bash
pnpm add @leadrails/sdk
npm  install @leadrails/sdk
deno add @leadrails/sdk    # via JSR
```

## Env vars

The SDK auto-reads these from `process.env` by default:

```bash
LEADRAILS_CLIENT_ID=cli_...
LEADRAILS_SOURCE_ID=src_...
LEADRAILS_KEY_ID=key_...
LEADRAILS_SIGNING_SECRET=...          # server-only, NEVER prefix with NEXT_PUBLIC_
LEADRAILS_API_URL=https://intake.leadrails.dev  # optional override
```

If `LEADRAILS_SIGNING_SECRET` is detected in a `NEXT_PUBLIC_*`-prefixed env var, `createClient()` throws — that prefix inlines the value into the browser bundle and would leak the secret.

## Usage

```ts
import { createClient, leadEvent } from "@leadrails/sdk";

const client = createClient();  // auto-reads the LEADRAILS_* env vars above

await client.send(
  leadEvent({
    source: { source_system: "world-flags-feedback" },
    lead: {
      full_name: "Jane Doe",
      email: "jane@example.com",
      message: "I'd like a quote.",
    },
  }),
);
```

If you prefer to pass credentials explicitly:

```ts
const client = createClient({
  clientId:      "cli_...",
  sourceId:      "src_...",
  keyId:         "key_...",
  signingSecret: "...",        // server-only, never NEXT_PUBLIC_*
  apiUrl:        "https://intake.leadrails.dev", // optional
});
```

## Errors

```ts
import { LeadRailsApiError, LeadRailsAuthError } from "@leadrails/sdk";

try {
  await client.send(event);
} catch (err) {
  if (err instanceof LeadRailsAuthError) {
    // 401 — rotate keys
  } else if (err instanceof LeadRailsApiError) {
    // Other non-2xx: err.status, err.errorCode, err.requestId
  } else {
    // Network / fetch error
  }
}
```

Stable `errorCode` values: `auth_failed`, `stale_timestamp`, `replayed_nonce`, `schema_validation_failed`, `workflow_paused`, `idempotency_key_collision`, plus HTTP fallbacks like `http_500`.

## Idempotency

By default, the SDK sets `X-LR-Idempotency-Key = sha256(body + floor(now / 60s))`. Same body within a 60-second window dedupes — covers double-clicks, retries, transient network. Configurable per call:

```ts
await client.send(event, { idempotencyKey: "your-stable-key" });
```

## Observability

Optional, off by default:

```ts
const client = createClient({
  onRequest({ url, durationMs, status, errorCode }) {
    yourMetrics.increment("leadrails.send", { status });
  },
  onError(err) {
    yourSentry.captureException(err);
  },
});
```

The SDK never makes a network request the consumer didn't ask for.

## License

MIT
