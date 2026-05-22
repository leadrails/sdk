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

The route reads `LEADRAILS_*` env vars by default; pass `clientId / sourceId / keyId / signingSecret` explicitly to override.

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

## Lint preset

The SDK has four layers of build/runtime guardrails to keep the signing secret server-side. The optional lint preset is a fifth layer that catches misuse in your editor before you even build.

```js
// eslint.config.js
import leadrailsNext from "@leadrails/next/lint/eslint";

export default [
  ...leadrailsNext,
  // your other configs
];
```

```json
// .oxlintrc.json — manual integration (oxlint doesn't yet support preset extension)
{
  "plugins": [],
  "rules": { "no-restricted-imports": "error" }
}
// Then merge in the rule shape from @leadrails/next/lint/oxlint
```

The rule bans `@leadrails/sdk` imports from any file NOT matching these conventional server-only paths:
- `app/api/**/route.{ts,tsx}` (Next.js Route Handlers)
- `**/*.route.{ts,tsx}`
- `**/actions.{ts,tsx}` / `**/*.action.{ts,tsx}` / `**/actions/**/*.{ts,tsx}` (Server Actions)

## License

MIT
