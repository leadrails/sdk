# `@leadrails/next`

Next.js adapter for [`@leadrails/sdk`](https://github.com/leadrails/sdk/tree/main/packages/sdk). Drop-in factories for Route Handlers and Server Actions, plus an opt-in lint preset that bans SDK imports from client-side files.

## Install

```bash
pnpm add @leadrails/next @leadrails/sdk
```

## Route Handler

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

`body` is typed `unknown` — cast it to your form's shape inside `mapRequest`. The intake server validates the resulting LeadRails event.

The route reads `LEADRAILS_*` env vars by default; pass `clientId / sourceId / keyId / signingSecret` explicitly to override. **If a required env var is missing, the route throws a `LeadRailsConfigError` at module-load time — your Next.js dev server will fail to start with a clear message.**

## Server Action

```ts
// app/actions.ts
"use server";
import { createLeadEventAction } from "@leadrails/next";

export const submitLead = createLeadEventAction({
  mapFormData: (fd) => ({
    source: { source_system: "my-app" },
    lead: {
      full_name: String(fd.get("name") ?? ""),
      email:     String(fd.get("email") ?? ""),
      message:   String(fd.get("message") ?? ""),
    },
  }),
});
```

```tsx
// app/contact/page.tsx
import { submitLead } from "../actions";

export default function ContactPage() {
  return (
    <form action={submitLead}>
      <input name="name"    placeholder="Your name" />
      <input name="email"   placeholder="Email" type="email" />
      <textarea name="message" placeholder="Message" />
      <button type="submit">Send</button>
    </form>
  );
}
```

## Lint preset (ESLint)

The SDK has four build/runtime guardrails to keep the signing secret server-side. The optional ESLint preset is a fifth layer that catches misuse in your editor before you even build.

```js
// eslint.config.js
import leadrailsNext from "@leadrails/next/lint/eslint";

export default [
  ...leadrailsNext,
  // your other configs
];
```

The rule errors on `@leadrails/sdk` imports from any file NOT matching the conventional server-only paths:
- `app/api/**/route.{ts,tsx}` (Next.js App Router handlers)
- `pages/api/**/*.{ts,tsx}` (Next.js Pages Router handlers)
- `**/*.route.{ts,tsx}`
- `**/actions.{ts,tsx}` / `**/*.action.{ts,tsx}` / `**/actions/**/*.{ts,tsx}` (Server Actions)

> **oxlint:** an oxlint config fragment ships at `@leadrails/next/lint/oxlint` as a JS module for future use, but oxlint doesn't yet support preset extension via `.oxlintrc.json` (as of v0.15). Use the ESLint preset for now; the oxlint shape is there for when oxlint enables it.

## License

MIT
