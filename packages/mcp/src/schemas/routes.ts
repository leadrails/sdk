// /v1/routes — Route resource wire shape.
//
// A `route` wires a source to a destination: when a lead event lands at
// intake under `source_id`, the delivery worker fans out one delivery_job
// per active route that points at that source + destination pair. Routes
// carry per-pair config (priority, status, optional mapping_json, optional
// filter_rules_json) — v1 surfaces the minimal CRUD slice; quiet hours UI,
// bulk creation, templating, and OpenAPI cross-check are explicitly out of
// scope at this surface.
//
// Wire shape mirrors the existing admin `Route` shape (intentional — the
// resource is the same DB row) but lives in `@leadrails/schema/public` so the
// public API has its own SSOT. The admin route hand-rolls a near-identical
// Zod schema today; we do NOT import that to keep `routes/v1/` sealed off
// from `routes/admin/` (boundary audit). When the admin UI migrates to the
// v1 surface, the admin schema becomes the deletable duplicate.
//
// Status enum is `active | paused | revoked`. `revoked` is the soft-delete
// terminal state surfaced via DELETE /v1/routes/{id}; PATCH cannot set it
// (the dedicated DELETE endpoint gets its own audit row).
//
// .openapi(...) registrations are NOT applied here — the schema package is
// a leaf (`packages/schema/AGENTS.md`) and must not depend on the
// `@hono/zod-openapi` toolchain. Route files attach `.openapi(...)` at
// use-site to register named components on the OpenAPI registry.
import { z } from "zod";

/**
 * Lifecycle status of a route. `active` fans out on intake; `paused`
 * persists the route but skips fanout; `revoked` is the terminal soft-delete
 * state — DELETE flips to revoked and future fanout never sees the row.
 */
export const routeStatusSchema = z.enum(["active", "paused", "revoked"]);
export type RouteStatus = z.infer<typeof routeStatusSchema>;

/**
 * `Route` — wire shape of a single route row exposed at /v1.
 *
 * Field semantics:
 *
 *   - `id`              — ULID-shaped `rt_<…>`; stable across the row's
 *                         lifetime.
 *   - `client_id`       — `cli_<…>` workspace id. Always equals the
 *                         calling key's workspace (cross-workspace reads
 *                         404 by design).
 *   - `source_id`       — `src_<…>`. Required on POST. The handler asserts
 *                         it belongs to the calling workspace.
 *   - `destination_id`  — `dst_<…>`. Required on POST. Same workspace
 *                         assertion.
 *   - `workflow_id`     — `wf_<…>`. POST resolves the source's default
 *                         workflow when omitted; PATCH does not surface
 *                         this in v1 (route-set wiring stays
 *                         server-managed).
 *   - `name`            — operator-set human label (1–200 chars).
 *   - `status`          — active | paused | revoked (see above).
 *   - `priority`        — int 0..10000 (lower = earlier in the fanout
 *                         order). Default 100.
 *   - `filter_rules_json` — opaque JSON string (route filter expressions);
 *                         passthrough for v1, validated structurally only.
 *   - `mapping_version` — adapter mapping version slug. Default `"default"`.
 *   - `mapping_json`    — opaque JSON string (per-route field mapping
 *                         spec). NULL = use the adapter's legacy mapping.
 *                         Validation against the adapter happens at the
 *                         admin surface today; v1 accepts the string
 *                         verbatim — full mapping validation lives on the
 *                         admin route for now and is on the backlog for a
 *                         v1 enhancement.
 *   - `created_at`,
 *     `updated_at`      — ISO-8601 UTC timestamps.
 */
export const routeSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  source_id: z.string().nullable(),
  destination_id: z.string(),
  workflow_id: z.string(),
  name: z.string(),
  status: routeStatusSchema,
  priority: z.number().int(),
  filter_rules_json: z.string().nullable(),
  mapping_version: z.string(),
  mapping_json: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Route = z.infer<typeof routeSchema>;

/**
 * `POST /v1/routes` request body.
 *
 * `client_id` is NOT accepted — every /v1 request is workspace-scoped by
 * the API key, so the caller cannot create a route in a different
 * workspace. The handler stamps `client_id` from `c.var.auth.client_id`.
 *
 * `source_id` + `destination_id` are required. The handler re-verifies that
 * BOTH belong to the calling workspace and returns 400 `invalid-reference`
 * on any cross-workspace id (per issue #41 acceptance criteria).
 *
 * `workflow_id` is optional. When omitted, the handler resolves the
 * source's default workflow (created eagerly by POST /v1/sources).
 */
export const createRouteRequestSchema = z
  .object({
    source_id: z.string().min(1),
    destination_id: z.string().min(1),
    workflow_id: z.string().min(1).optional(),
    name: z.string().min(1).max(200),
    priority: z.number().int().min(0).max(10000).optional(),
    filter_rules_json: z.string().optional(),
    mapping_version: z.string().min(1).max(50).optional(),
    mapping_json: z.string().optional(),
  })
  .strict();
export type CreateRouteRequest = z.infer<typeof createRouteRequestSchema>;

/**
 * `PATCH /v1/routes/:id` request body. Partial update — every field is
 * optional and only supplied fields are written.
 *
 * `status` here is restricted to `active | paused` — flipping to `revoked`
 * goes through `DELETE /v1/routes/:id` so the soft-delete gets its own
 * audit row (mirrors the source revoke pattern).
 *
 * `destination_id` MAY be patched; the handler re-verifies the new id
 * belongs to the calling workspace (400 `invalid-reference` otherwise).
 *
 * `source_id` is intentionally NOT patchable — moving a route across
 * sources would orphan the workflow link; customers recreate the route
 * instead. Same constraint as the admin PATCH (admin doesn't expose it
 * either).
 *
 * `mapping_json` accepts an explicit `null` to clear the column (revert
 * to the adapter's legacy mapping). `undefined` (key absent) leaves the
 * existing value untouched.
 *
 * `filter_rules_json` follows the same null-vs-undefined semantics.
 */
export const patchRouteRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(["active", "paused"]).optional(),
    priority: z.number().int().min(0).max(10000).optional(),
    destination_id: z.string().min(1).optional(),
    filter_rules_json: z.string().nullable().optional(),
    mapping_version: z.string().min(1).max(50).optional(),
    mapping_json: z.string().nullable().optional(),
  })
  .strict();
export type PatchRouteRequest = z.infer<typeof patchRouteRequestSchema>;

/**
 * `DELETE /v1/routes/:id` response body. The endpoint is idempotent —
 * deleting an already-revoked route returns the same shape with the
 * cached row, so SDK clients can blindly retry.
 *
 * The shape is the full `Route` (status will read `"revoked"`) so a
 * client doesn't have to issue a follow-up GET to refresh its local copy.
 */
export const deleteRouteResponseSchema = routeSchema;
export type DeleteRouteResponse = z.infer<typeof deleteRouteResponseSchema>;
