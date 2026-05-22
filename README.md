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
| [`@leadrails/sdk`](./packages/sdk) | Server-only core. Signs and POSTs lead events. Works in Node ≥18, Bun, Deno, Cloudflare Workers, Vercel Edge. |
| [`@leadrails/next`](./packages/next) | Next.js adapter — `createLeadEventRoute()` + `createLeadEventAction()` + lint preset that bans SDK imports outside server files. |

## Quick example

```ts
// app/api/lead/route.ts
import { createLeadEventRoute } from "@leadrails/next";

export const POST = createLeadEventRoute({
  mapRequest: (body) => ({
    source: { source_system: "world-flags-feedback" },
    lead: {
      full_name: body.name,
      email:     body.email,
      message:   body.feedback,
    },
  }),
});
```

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

Four layers of guardrails to ensure the HMAC signing secret never reaches a browser bundle:

1. **`import "server-only"`** at the top of every `@leadrails/sdk` entry file. Next.js fails the build with a clear error if a client component transitively imports it.
2. **`package.json` exports map** with `browser` → a stub that throws on import. Webpack / Vite / Rollup / esbuild all resolve to the throwing stub when bundling for the browser.
3. **Runtime guard** at module load: throws if `typeof window !== "undefined"`.
4. **`NEXT_PUBLIC_*` refusal** — `createClient()` throws if the signing secret value matches any env var whose name starts with `NEXT_PUBLIC_`.

## Status

Pre-launch alpha. Wire contract is stable (`lead_event.v1`); SDK surface is at `0.1.0` and may evolve in minor versions until 1.0. Open an issue if anything's missing.

## License

[MIT](./LICENSE)
