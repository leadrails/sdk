// /v1/me — discovery + capabilities surface for the public API.
//
// `/v1/me` is THE configurability surface for the public API. SDK clients
// (and the MCP server) call it on cold start to learn which capabilities
// the current API key has access to, instead of trial-and-erroring 403s
// across the surface. Anything the API conditionally exposes flips a flag
// in `capabilities`.
//
// Current state of fields and capability flags:
//
//   - `rate_limit.{limit, remaining, reset}` are nullable today; a later
//     release wires the Cloudflare `ratelimit` binding and fills them in.
//   - `capabilities.events_read` is computed today from the request's plan
//     (`pro`/`agency`/`scale` → true) so the gate is advertised alongside
//     `/v1/events`.
//   - `capabilities.{webhooks_outbound, agency_endpoints, fine_grained_scopes}`
//     are all `false` in v1; they're declared here so v1.1/v2 can flip
//     them without a contract change.
//
// Schema lives in `packages/schema` (the wire-contract SSOT). The
// `.openapi(...)` registration happens at the route level — the schema
// package is leaf-only and must not depend on the OpenAPI codegen toolchain.
import { z } from "zod";

/**
 * Plan slug as stored in the `plans.slug` column (migration 0027). The
 * `requireApiKey` middleware reads this per-request and stashes it on
 * `c.var.auth.plan`; `/v1/me` echoes it back to the caller so SDKs can
 * cache and branch on it without parsing capability flags.
 */
export const planSlugSchema = z.enum([
  "free",
  "starter",
  "pro",
  "agency",
  "scale",
]);
export type PlanSlug = z.infer<typeof planSlugSchema>;

/**
 * Plans that grant read access to `/v1/events` in v1. The constant is
 * exported so both the `/v1/me` capability computation and the
 * `requirePlan('pro+')` middleware read from the same source. Adding a new
 * gated plan tier is a one-line change here that propagates everywhere.
 */
export const PLANS_WITH_EVENTS_READ = new Set<PlanSlug>([
  "pro",
  "agency",
  "scale",
]);

/**
 * Per-request rate-limit window snapshot.
 *
 * Every field except `period` ships as `null` today — a later release
 * attaches the Cloudflare `ratelimit` binding and replaces the nulls with
 * real counters (`limit`, `remaining`, `reset`). `period` is locked at 60
 * because the rate-limit design uses a two-binding setup (10s burst + 60s
 * sustained); the `/v1/me` snapshot reports the sustained side, which is
 * what SDKs care about for back-off pacing.
 */
export const rateLimitSnapshotSchema = z.object({
  /** Requests allowed per `period`. `null` until rate-limit enforcement ships. */
  limit: z.number().int().nonnegative().nullable(),
  /** Window length in seconds. Locked to 60 for the sustained budget. */
  period: z.literal(60),
  /** Requests remaining in the current window. `null` until rate-limit enforcement ships. */
  remaining: z.number().int().nonnegative().nullable(),
  /** Epoch seconds at which the current window resets. `null` until rate-limit enforcement ships. */
  reset: z.number().int().nonnegative().nullable(),
});
export type RateLimitSnapshot = z.infer<typeof rateLimitSnapshotSchema>;

/**
 * Capability flags advertised by `/v1/me`. Each flag describes one
 * conditionally-exposed slice of the API; clients branch on the flag
 * instead of probing the surface and parsing 403s.
 *
 *  - `events_read`: `/v1/events` read access. Pro/Agency/Scale only in v1.
 *  - `webhooks_outbound`: outbound state-change webhooks. Deferred to v2.
 *  - `agency_endpoints`: `/v1/agency/*` management. Deferred to v2.
 *  - `fine_grained_scopes`: per-route scope enforcement. v1.1 flips this.
 */
export const meCapabilitiesSchema = z.object({
  events_read: z.boolean(),
  webhooks_outbound: z.boolean(),
  agency_endpoints: z.boolean(),
  fine_grained_scopes: z.boolean(),
});
export type MeCapabilities = z.infer<typeof meCapabilitiesSchema>;

/**
 * `/v1/me` response body. Wire shape locked by the v1 spec; field semantics
 * documented above. Adding a field is non-breaking (clients ignore unknown
 * fields); removing or renaming a field is a v2 break.
 */
export const meResponseSchema = z.object({
  /** Workspace id (`cli_<ULID>`). The scoping anchor for every /v1 query. */
  client_id: z.string(),
  /** Human-readable workspace name as stored in `clients.name`. Surfaced so SDK/MCP consumers can display "you're authenticated as <name>" without a second round-trip. */
  name: z
    .string()
    .describe(
      "Human-readable workspace name. Mirrors `clients.name` for the resolved `client_id`.",
    ),
  /** Plan slug; one of `free|starter|pro|agency|scale`. */
  plan: planSlugSchema,
  /** Scope strings attached to this API key. v1 ships `["*"]` only. */
  scopes: z.array(z.string()),
  /** Sustained-window rate-limit snapshot. Nullable until rate-limit enforcement ships. */
  rate_limit: rateLimitSnapshotSchema,
  /** Capability flags — see meCapabilitiesSchema. */
  capabilities: meCapabilitiesSchema,
  /** Correlation id (CF-Ray when present). Mirrors `X-Request-Id`. */
  request_id: z.string(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * `/v1/healthz` response body. Intentionally minimal: just a liveness
 * signal and the worker label so a probe knows which deploy answered.
 * Status-page consumers (synthetic monitors, marketing /status page) hit
 * this endpoint unauthenticated.
 */
export const healthzResponseSchema = z.object({
  ok: z.literal(true),
  worker: z.literal("admin-api"),
});
export type HealthzResponse = z.infer<typeof healthzResponseSchema>;

/**
 * Pure capability computation. Exported so `/v1/me` and any future route
 * that needs to advertise capabilities (e.g. an SDK-discovery helper) read
 * from the same source. Keeping it pure makes unit testing trivial: feed
 * a plan slug, assert the flag set.
 */
export function computeCapabilities(plan: PlanSlug): MeCapabilities {
  return {
    events_read: PLANS_WITH_EVENTS_READ.has(plan),
    webhooks_outbound: false,
    agency_endpoints: false,
    fine_grained_scopes: false,
  };
}
