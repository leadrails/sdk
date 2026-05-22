// Server-side enforcement. Three layers:
//
// 1. package.json `exports` map: the `browser` condition resolves to
//    a throwing stub (`./dist/browser-stub.js`). Every modern bundler
//    (webpack, vite, esbuild, turbopack, rollup) honors this, so a
//    browser bundle that transitively imports this package fails at
//    bundle time with a clear error.
// 2. Runtime guard below: if a runtime somehow loads the non-browser
//    entry from a browser context, throw on module init.
// 3. `@leadrails/next/lint/{eslint,oxlint}` preset bans imports of
//    this package outside server-side file conventions (Route
//    Handlers, Server Actions). Caught at lint-time, before bundle.
//
// We deliberately do NOT use `import "server-only"` here: that
// package's marker throws unless the `react-server` resolve
// condition is set, which excludes Node ESM scripts, Bun, Deno,
// Cloudflare Workers, and Vercel Edge — all environments this SDK
// explicitly supports.
if (typeof window !== "undefined") {
  throw new Error(
    "@leadrails/sdk loaded in a browser environment. " +
      "This package is server-only — call it from a Route Handler, " +
      "Server Action, or any server-side context. The HMAC signing " +
      "secret must never reach a browser bundle.",
  );
}

export { leadEvent } from "./lead-event.js";
export type { FormDataFieldMap } from "./lead-event.js";
export { sendLeadEvent } from "./send.js";
export type { SendLeadEventConfig, SendLeadEventResult } from "./send.js";
export { createClient } from "./client.js";
export type { ClientOptions, LeadRailsClient } from "./client.js";
export {
  LeadRailsError,
  LeadRailsApiError,
  LeadRailsAuthError,
  LeadRailsConfigError,
} from "./errors.js";
export type {
  LeadEventV1,
  LeadEventV1Input,
  LeadV1,
  SourceV1,
  LocationV1,
  AttributionV1,
  ConsentV1,
} from "./types.js";
