<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/leadrails/.github/main/profile/lockup-horizontal-dark.svg">
    <img src="https://raw.githubusercontent.com/leadrails/.github/main/profile/lockup-horizontal.svg" width="320" alt="LeadRails" />
  </picture>
</p>

<p align="center">
  <strong>Server-only SDK for sending HMAC-signed lead events to LeadRails.</strong>
</p>

<p align="center">
  <a href="https://leadrails.dev/?ref=github-sdk">leadrails.dev</a>
</p>

---

## Packages

| Package | What it is |
|---|---|
| [`@leadrails/sdk`](./packages/sdk) | Server-only core. Signs and POSTs lead events. Tested in Node ≥18; portable to Bun, Deno, Cloudflare Workers, Vercel Edge (additional CI gates added as customers adopt them). |
| [`@leadrails/next`](./packages/next) | Next.js adapter — `createLeadEventRoute()` + `createLeadEventAction()` + lint preset that bans SDK imports outside server files. |

## Quick example

```ts
// app/api/lead/route.ts
import { createLeadEventRoute } from "@leadrails/next";

type ContactForm = { name?: string; email?: string; feedback?: string };

export const POST = createLeadEventRoute({
  mapRequest: (body) => {
    const b = body as ContactForm;
    return {
      source: { source_system: "world-flags-feedback" },
      lead: {
        full_name: b.name,
        email:     b.email,
        message:   b.feedback,
      },
    };
  },
});
```

`body` is typed `unknown` — you cast it to your form's shape inside `mapRequest`. The intake server validates the resulting LeadRails event; malformed payloads return a `LeadRailsApiError` with `errorCode === "schema_validation_failed"`.

Env vars the SDK reads by default:

```bash
LEADRAILS_CLIENT_ID=cli_...
LEADRAILS_SOURCE_ID=src_...
LEADRAILS_KEY_ID=key_...
LEADRAILS_SIGNING_SECRET=...        # NEVER prefix this with NEXT_PUBLIC_
LEADRAILS_API_URL=https://intake.leadrails.dev  # optional
```

That's it. The SDK signs the request, sends it, and your event lands in LeadRails. You configure where it goes from there in the [LeadRails admin UI](https://app.leadrails.dev).

## Server-only enforcement

Three layers ensure the HMAC signing secret never reaches a browser bundle, plus a separate guardrail against secrets being loaded from public-prefixed env vars:

1. **`package.json` exports map** with `browser` → a stub that throws on import. Every modern bundler (webpack, vite, esbuild, turbopack, rollup) resolves the `browser` condition when targeting a browser, so a client bundle that transitively imports `@leadrails/sdk` fails at bundle time with a clear error.
2. **Runtime guard** at module load: throws if `typeof window !== "undefined"`. Last-resort defense if a runtime somehow loads the non-browser entry from a browser context.
3. **`@leadrails/next/lint/{eslint,oxlint}` preset** bans imports of `@leadrails/sdk` outside server-side file conventions (Route Handlers, Server Actions). Caught at lint-time, before bundle.

Plus, independently:

4. **`NEXT_PUBLIC_*` refusal** — `createClient()` throws if the signing secret value matches any env var whose name starts with `NEXT_PUBLIC_`. Even if a developer accidentally configures the secret as a public env var, the SDK refuses to use it.

`@leadrails/next` additionally uses `import "server-only"` in each of its entry files, since that package is Next.js-specific and that marker adds value in that runtime. The SDK itself does NOT use `server-only` — its `react-server` condition would break every non-Next.js runtime the SDK supports.

## Status

Pre-launch alpha. Wire contract is stable (`lead_event.v1`); SDK surface is at `0.1.0` and may evolve in minor versions until 1.0. Open an issue if anything's missing.

## License

[MIT](./LICENSE)
