// /v1/destinations — public-API wire shapes for destination CRUD.
//
// The wire envelope lives here (leaf schema package); per-adapter
// config validation runs at the route handler via the `configSchema`
// exported on each adapter in `@leadrails/adapters`. `packages/schema`
// is a leaf package and MUST NOT import from `@leadrails/adapters` —
// the audit boundary enforces it.
//
// Two consequences of that boundary:
//
//   1. `adapter_type` is an `z.string()` here rather than a closed
//      enum sourced from the adapter registry. The route handler
//      validates the string against `ADAPTER_TYPES` from the
//      adapters package, returning `422 invalid-adapter-type` on
//      unknown values. The OpenAPI spec emitted by the route declares
//      the closed enum via the same registry at the route layer.
//
//   2. The `config` field on Create / Patch payloads is typed as
//      `z.record(z.string(), z.unknown())` — the route handler
//      branches on `adapter_type` and re-validates via the matching
//      adapter's Zod schema. Same SSoT pattern the admin route uses.
//
// Read-side `config` is omitted on the list response (cheap, no DEK
// fan-out) and included on the detail response. The shape parallels
// the admin `DestinationDetail`: a flat `config` record plus a
// `sensitive_keys: string[]` hint so SDKs / MCP clients can mask
// password-type fields in their UIs without re-deriving the field
// list from the adapter manifest.

import { z } from "zod";

/**
 * Lifecycle status as stored on the `destinations.status` column.
 * Mirrors the admin response shape; `revoked` is the terminal
 * soft-delete state surfaced via DELETE on the admin path, NOT
 * exposed as a state the public API can set. The public surface
 * only flips `active <-> paused`; revoke is administrative.
 */
export const destinationStatusSchema = z.enum(["active", "paused", "revoked"]);
export type DestinationStatus = z.infer<typeof destinationStatusSchema>;

/**
 * Sparse list-row shape. No `config` — listing destinations stays
 * cheap (no DEK decryption fan-out) and avoids accidentally
 * leaking credentials in log surfaces that capture response bodies.
 */
export const destinationListItemSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  name: z.string(),
  adapter_type: z.string(),
  status: destinationStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type DestinationListItem = z.infer<typeof destinationListItemSchema>;

/**
 * Detail-row shape. `config` is the decrypted, plaintext config
 * map (Slack `webhook_url`, GHL `locationId`+`apiKey`, etc.).
 * `sensitive_keys` lists which keys SDKs/MCP clients should mask
 * by default — anyone who can read a destination already has full
 * control of it, so this is UX hygiene rather than a security
 * boundary (encryption at rest protects from DB-leak attacks).
 */
export const destinationDetailSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  name: z.string(),
  adapter_type: z.string(),
  status: destinationStatusSchema,
  config: z.record(z.string(), z.unknown()),
  sensitive_keys: z.array(z.string()),
  /**
   * Provider-side metadata cache, JSON-decoded. Populated for
   * template-by-id adapters (today: `email_resend_v2`) where
   * LeadRails fetches the upstream template manifest at create-time
   * and caches it so the mapping editor can validate route mappings
   * before any lead flows. The wrapping envelope is always
   * `{ fetched_at: <ISO8601>, manifest: <provider-response> }`; the
   * `manifest` shape is provider-specific. `null` when the adapter
   * does not opt into this cache OR the destination predates the
   * adapter's manifest-fetch implementation.
   */
  provider_metadata: z.unknown().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type DestinationDetail = z.infer<typeof destinationDetailSchema>;

/**
 * Optional `variables` payload on the test endpoint for `email_*`
 * adapter types. The admin UI's "Send test email" panel collects one
 * input per template variable; the operator can override any
 * `fallback_value` from the cached manifest. Missing required
 * variables (no fallback, no operator value) → 422 with
 * `missing_required_variables` BEFORE any provider call. Type
 * mismatch (operator string for a `number`-typed variable) → 422 with
 * `type_mismatch`. Adapters that do not consume `variables` ignore
 * the field entirely.
 */
export const destinationTestRequestSchema = z
  .object({
    variables: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional(),
  })
  .strict();
export type DestinationTestRequest = z.infer<
  typeof destinationTestRequestSchema
>;

/**
 * Create-request payload. `adapter_type` and `config` are
 * cross-validated at the handler: the handler narrows on
 * `adapter_type` via `ADAPTERS[adapter_type].configSchema`. The
 * wire schema here keeps `config` open so the OpenAPI doc stays
 * compact rather than emitting an 8-way discriminated union as a
 * top-level component.
 *
 * `client_id` is intentionally NOT a field on the request body —
 * the workspace is implied by the API key. Passing one explicitly
 * is a 422 "unexpected field" via Zod's strict mode (we leave the
 * field off the schema entirely so the validator rejects it).
 */
export const createDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(200),
    adapter_type: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();
export type CreateDestinationRequest = z.infer<
  typeof createDestinationRequestSchema
>;

/**
 * Patch-request payload. Every field is optional; `status` is
 * narrowed to `active|paused` because the public surface cannot
 * issue a revoke (that's an admin-only soft delete). `adapter_type`
 * is NOT patchable — the encrypted config is keyed to a specific
 * adapter, and switching mid-flight would invalidate every stored
 * field. Customers create a new destination instead.
 */
export const patchDestinationRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    status: z.enum(["active", "paused"]).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type PatchDestinationRequest = z.infer<
  typeof patchDestinationRequestSchema
>;

/**
 * Response envelopes. The list response carries a `next_cursor`
 * (forward-only opaque cursor, see `apps/admin-api-worker/src/lib/cursor.ts`)
 * and a `has_more` boolean — same shape every /v1 list endpoint emits
 * across the four sister agents adding /v1 routes in parallel.
 */
export const destinationListResponseSchema = z.object({
  data: z.array(destinationListItemSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});
export type DestinationListResponse = z.infer<typeof destinationListResponseSchema>;

/**
 * Test-event response shape. POST /v1/destinations/{id}/test
 * dispatches a synthetic event through the adapter without
 * persisting a delivery_job; the response reports the classified
 * outcome so the customer can confirm credentials work. Mirrors
 * the structure of `DeliveryResult` from `@leadrails/adapters`
 * but with optional metadata fields renamed to snake_case for
 * wire consistency.
 */
export const destinationTestResponseSchema = z.object({
  ok: z.boolean(),
  classification: z.enum([
    "success",
    "transient_failure",
    "permanent_failure",
    "rate_limited",
  ]),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  response_summary: z.unknown().optional(),
});
export type DestinationTestResponse = z.infer<typeof destinationTestResponseSchema>;
