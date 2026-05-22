/**
 * @module
 *
 * Next.js adapter for `@leadrails/sdk`. Provides two thin factories
 * — {@link createLeadEventRoute} for App Router Route Handlers and
 * {@link createLeadEventAction} for Server Actions — that wrap the
 * SDK's `createClient()` + `client.send()` pattern with sensible
 * HTTP / Server Action envelope defaults.
 *
 * Every export is server-only by design: each entry file uses
 * `import "server-only"` so any client component that transitively
 * imports them fails the Next.js build at compile time. Combined
 * with the SDK's own browser-stub exports condition, the signing
 * secret cannot reach a browser bundle.
 *
 * See also `@leadrails/next/lint/eslint` and `@leadrails/next/lint/oxlint`
 * for editor-level guardrails that catch misuse before build time.
 *
 * @example
 * ```ts
 * // app/api/lead/route.ts
 * import { createLeadEventRoute } from "@leadrails/next";
 *
 * export const POST = createLeadEventRoute({
 *   mapRequest: (body) => ({
 *     source: { source_system: "my-app" },
 *     lead:   { email: (body as { email: string }).email },
 *   }),
 * });
 * ```
 */

export { createLeadEventRoute } from "./route.js";
export type { CreateLeadEventRouteOptions } from "./route.js";
export { createLeadEventAction } from "./action.js";
export type { CreateLeadEventActionOptions, LeadEventActionResult } from "./action.js";
