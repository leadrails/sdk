/**
 * @module
 *
 * Server-only SDK to send HMAC-signed lead events to LeadRails.
 *
 * Exposes {@link createClient} for the common case (auto-reads
 * `LEADRAILS_*` env vars), {@link sendLeadEvent} for ad-hoc per-call
 * config, {@link leadEvent} as a typed factory that pre-fills the
 * wire-contract constants, and structured error classes
 * ({@link LeadRailsApiError}, {@link LeadRailsAuthError},
 * {@link LeadRailsConfigError}) for branching in catch blocks.
 *
 * ## Server-side enforcement (three layers)
 *
 * 1. `package.json` `exports.browser` resolves to a throwing stub;
 *    every modern bundler routes browser bundles there and fails the
 *    build with a clear error.
 * 2. Runtime `typeof window` guard below — last-resort defense if a
 *    runtime somehow loads the non-browser entry in a browser context.
 * 3. `@leadrails/next/lint/{eslint,oxlint}` preset bans imports of
 *    this package outside server-side file conventions.
 *
 * This module deliberately does NOT use `import "server-only"` —
 * that package's `react-server` resolve condition throws outside
 * Next.js Server Components, breaking Node ESM scripts, Bun, Deno,
 * Cloudflare Workers, and Vercel Edge.
 *
 * @example
 * ```ts
 * import { createClient, leadEvent } from "@leadrails/sdk";
 *
 * const client = createClient(); // reads LEADRAILS_* from process.env
 * await client.send(leadEvent({
 *   source: { source_system: "my-app" },
 *   lead:   { email: "x@example.com" },
 * }));
 * ```
 */

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
