// /v1/events — read-only event + delivery-job projection for the public API.
//
// `/v1/events` is the audit-trail surface customers (and the MCP server) use
// to see what's moved through their workspace. Plan-gated to `pro+` because
// (a) the rows carry lead PII, (b) the read load is rate-limit-sensitive,
// (c) it's a clean upsell signal — Pro/Agency/Scale pass, Free/Starter get a
// hard 403 RFC-9457 problem with
// `type: https://docs.leadrails.dev/errors/plan-required`.
//
// SSOT for the wire shapes lives here so the route handler in
// `apps/admin-api-worker/src/routes/v1/events.ts`, the (later) MCP tool
// definitions, and the SDK type emitter all agree on field names and
// nullability. The `LeadEventRow` / `DeliveryJobRow` / `DeliveryAttemptRow`
// types in `@leadrails/db` are the *row* shapes — they leak migration
// columns we don't want on the public surface (e.g. internal `body_sha256`,
// `dispatch_kind`). The schemas below project a stable subset that v1 SDK
// consumers can rely on across schema migrations.
//
// Schema lives in `packages/schema` (the wire-contract SSOT). The
// `.openapi(...)` registration happens at the route level — the schema
// package is leaf-only and must not depend on the OpenAPI codegen toolchain.
import { z } from "zod";

/**
 * `lead_events.normalized_status` projected onto the public surface. The
 * full set on the row matches the `NormalizedEventStatus` union in
 * `@leadrails/db`; we re-declare it here as a Zod enum so the SDK gets a
 * concrete literal type rather than `string`. This is the *event-side*
 * normalization status (did the intake worker parse the payload into a
 * lead row); the *delivery-side* status filter for `GET /v1/events?status`
 * is a separate enum below (`v1EventStatusFilterSchema`).
 */
export const eventNormalizedStatusSchema = z.enum([
  "pending",
  "normalized",
  "failed",
]);
export type EventNormalizedStatus = z.infer<typeof eventNormalizedStatusSchema>;

/**
 * The public projection of a `lead_events` row. Internal/intake-only
 * columns are dropped to keep the surface stable across schema migrations:
 *
 *   - `body_sha256` — intake-side dedupe artifact, internal.
 *   - `raw_payload_json` — already redundant with the normalized projection
 *     and would blow up response sizes; surfaced via the (intake-side)
 *     replay path, not the v1 read API.
 *   - `validation_errors_json` — intake-side; v1.1 will surface a typed
 *     subset under a dedicated field if customers ask.
 *
 * Fields included match what an SDK / MCP consumer needs to correlate an
 * event with its source, workspace, and delivery jobs.
 */
export const v1EventSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  source_id: z.string(),
  schema_version: z.string(),
  idempotency_key: z.string(),
  normalized_status: eventNormalizedStatusSchema,
  received_at: z.string(),
  remote_ip: z.string().nullable(),
  user_agent: z.string().nullable(),
  referer: z.string().nullable(),
  origin: z.string().nullable(),
  site_url: z.string().nullable(),
  workflow_name: z.string(),
});
export type V1Event = z.infer<typeof v1EventSchema>;

/**
 * Filter values for `GET /v1/events?status=...`. The wire surface is
 * intentionally narrower than the underlying `delivery_jobs.status`
 * column — the v1 contract locks the public values at
 * `delivered | failed | pending`, with `pending` collapsing the
 * `pending | enqueued | processing | retrying` continuum into a single
 * "still in flight" bucket.
 *
 * If a v1.1 SDK consumer needs the granular column we'll add an explicit
 * `lifecycle` filter; the existing values stay stable.
 */
export const v1EventStatusFilterSchema = z.enum([
  "delivered",
  "failed",
  "pending",
]);
export type V1EventStatusFilter = z.infer<typeof v1EventStatusFilterSchema>;

/**
 * Query parameters for `GET /v1/events`. All optional. Numeric `limit`
 * comes in as a string (raw query strings are strings); the route handler
 * parses + clamps to the shared `DEFAULT_LIMIT` / `MAX_LIMIT`.
 *
 * ISO-timestamp filters (`from` / `to`) are validated as plain strings on
 * the wire; the handler does a sanity-check (parse to Date, reject NaN) so
 * an obviously-malformed value 400s rather than landing as a string in the
 * SQL bind list.
 */
export const v1EventsListQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  source_id: z.string().optional(),
  destination_id: z.string().optional(),
  // Wire-side schema keeps `status` as a free-form string so the route
  // handler can validate and 400 with an RFC-9457 problem document
  // (`invalid-parameter`) on a bad value — rather than tripping the
  // framework's default schema-validation hook which emits a different
  // envelope. The allowed values are documented in the route's
  // `description` and codified in `v1EventStatusFilterSchema`.
  status: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type V1EventsListQuery = z.infer<typeof v1EventsListQuerySchema>;

/**
 * Cursor-paginated list response. `data` is the page, `next_cursor`
 * carries the opaque base64-encoded cursor for the next page (or
 * `null` when this is the last page).
 */
export const v1EventsListResponseSchema = z.object({
  data: z.array(v1EventSchema),
  next_cursor: z.string().nullable(),
});
export type V1EventsListResponse = z.infer<typeof v1EventsListResponseSchema>;

/**
 * `GET /v1/events/:id` response. Single-event projection; same fields as
 * the list shape.
 */
export const v1EventResponseSchema = z.object({
  data: v1EventSchema,
});
export type V1EventResponse = z.infer<typeof v1EventResponseSchema>;

/**
 * Public projection of a `delivery_attempts` row. The `request_summary_json`
 * and `response_summary_json` columns intentionally stay as opaque strings
 * (or null) on the wire — they're internal-debug fixtures whose schemas
 * shift adapter-by-adapter; promoting them to a typed object is a v1.1
 * project once we lock a stable summary contract.
 */
export const v1DeliveryAttemptSchema = z.object({
  id: z.string(),
  job_id: z.string(),
  event_id: z.string(),
  destination_id: z.string(),
  adapter_type: z.string(),
  attempt_number: z.number().int(),
  status: z.enum([
    "success",
    "transient_failure",
    "permanent_failure",
    "rate_limited",
  ]),
  request_summary_json: z.string().nullable(),
  response_summary_json: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type V1DeliveryAttempt = z.infer<typeof v1DeliveryAttemptSchema>;

/**
 * Public projection of a `delivery_jobs` row. The `dispatch_kind`,
 * `mapping_override_json`, and `dispatched_by_user_id` columns relate to
 * admin-side manual-dispatch and replay flows; we omit them from the public
 * read surface so the SSE shape stays focused on the delivery state machine.
 */
export const v1DeliveryJobSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  client_id: z.string(),
  route_id: z.string(),
  destination_id: z.string(),
  adapter_type: z.string(),
  status: z.enum([
    "pending",
    "enqueued",
    "processing",
    "retrying",
    "delivered",
    "failed",
    "skipped",
  ]),
  attempt_count: z.number().int(),
  max_attempts: z.number().int(),
  next_attempt_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  last_error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  delivered_at: z.string().nullable(),
  /**
   * Ordered list of attempts for this job (attempt_number ascending). One
   * row per HTTP call to the destination — including transient failures so
   * customers can see the retry trail.
   */
  attempts: z.array(v1DeliveryAttemptSchema),
});
export type V1DeliveryJob = z.infer<typeof v1DeliveryJobSchema>;

/**
 * `GET /v1/events/:id/delivery-jobs` response. Returns *all* delivery jobs
 * fanned out from this event (one per matching route at intake time),
 * embedded with each job's attempt history. Not paginated — one event
 * fans out to O(routes) jobs and the existing fanout caps are well under
 * the 200-row default page size.
 */
export const v1EventDeliveryJobsResponseSchema = z.object({
  data: z.array(v1DeliveryJobSchema),
});
export type V1EventDeliveryJobsResponse = z.infer<
  typeof v1EventDeliveryJobsResponseSchema
>;
