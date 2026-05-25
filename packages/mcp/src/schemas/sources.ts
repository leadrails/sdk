// /v1/sources — Source resource wire shape.
//
// Sources are the entry point a customer wires up when they integrate a
// new lead capture form. Every source has an attached `source_keys` row
// carrying the HMAC signing secret the intake worker validates; the public
// API surfaces source CRUD here and rotate-secret (single-shot reveal) as
// a side-action.
//
// Wire shape mirrors the existing admin `Source` shape (intentional — the
// resource is the same DB row) but lives in `@leadrails/schema/public` so
// the public API has its own SSOT. The admin route hand-rolls a near-
// identical Zod schema today; we do NOT import that to keep `routes/v1/`
// sealed off from `routes/admin/` (boundary audit). When the admin UI
// migrates to the v1 surface, the admin schema becomes the deletable
// duplicate.
//
// Status enum is locked to `active | paused | revoked` — the three states
// `routes/sources.ts` already supports. `revoked` is terminal (revoke is
// irreversible — see the PATCH semantics below).
//
// .openapi(...) registrations are NOT applied here — the schema package is
// a leaf (`packages/schema/AGENTS.md`) and must not depend on the
// `@hono/zod-openapi` toolchain. Route files wrap these with `.openapi(...)`
// at use-site to register named components on the OpenAPI registry.
import { z } from "zod";

/**
 * Lifecycle status of a source. `active` accepts intake; `paused` accepts
 * but doesn't fan out (lenient sources, strict destinations — see root
 * AGENTS.md invariant #6); `revoked` is terminal and hard-fails intake auth.
 */
export const sourceStatusSchema = z.enum(["active", "paused", "revoked"]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

/**
 * `Source` — the wire shape of a single source row exposed at /v1.
 *
 * Field semantics:
 *
 *   - `id`              — ULID-shaped `src_<…>`; stable across the row's
 *                         lifetime.
 *   - `client_id`       — `cli_<…>` workspace id. Always equals the
 *                         calling key's workspace (cross-workspace reads
 *                         404 by design).
 *   - `name`            — operator-set human label (1–200 chars).
 *   - `source_type`     — vendor/source family slug
 *                         (e.g. `wp_plugin`, `generic_webhook`).
 *   - `status`          — active | paused | revoked (see above).
 *   - `allowed_site_url`— optional origin pin; if set, intake rejects
 *                         events whose `source.site_url` doesn't match.
 *   - `auth_mode`       — HMAC v1 only in v1 (locked field; future modes
 *                         add a new enum variant without rename).
 *   - `schema_version`  — `lead_event.v1` for now; same future-proof note.
 *   - `created_at`,
 *     `updated_at`      — ISO-8601 UTC timestamps.
 */
export const sourceSchema = z.object({
  id: z.string(),
  client_id: z.string(),
  name: z.string(),
  source_type: z.string(),
  status: sourceStatusSchema,
  allowed_site_url: z.string().nullable(),
  auth_mode: z.literal("hmac_v1"),
  schema_version: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * `POST /v1/sources` request body.
 *
 * `client_id` is NOT accepted — every /v1 request is workspace-scoped by
 * the API key, so the caller cannot create a source in a different
 * workspace. The handler stamps `client_id` from `c.var.auth.client_id`.
 *
 * `allowed_site_url`, when supplied, MUST pass `isSafeOutboundUrl` (the
 * intake worker rejects unsafe origins later, but we check at write time
 * so a hostile origin never lands in the DB).
 */
export const createSourceRequestSchema = z.object({
  name: z.string().min(1).max(200),
  source_type: z.string().min(1).max(100),
  allowed_site_url: z.string().url().optional(),
});
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;

/**
 * `PATCH /v1/sources/:id` request body. Partial update — every field is
 * optional and only supplied fields are written.
 *
 * `status` here is restricted to `active | paused` — flipping to `revoked`
 * goes through the dedicated `POST /v1/sources/:id/revoke` route so the
 * irreversible action has its own audit row.
 *
 * `allowed_site_url: null` clears the column; omitting it leaves it
 * untouched. Same null-vs-undefined semantics as the admin PATCH.
 */
export const patchSourceRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "paused"]).optional(),
  allowed_site_url: z.string().url().nullable().optional(),
});
export type PatchSourceRequest = z.infer<typeof patchSourceRequestSchema>;

/**
 * `POST /v1/sources/:id/rotate-secret` response body. The plaintext is
 * returned ONCE; it is not stored cleartext and cannot be recovered after
 * this response. Callers MUST persist `signing_secret` in their own
 * secrets store before the response leaves memory.
 *
 * `key_id` identifies the new `source_keys` row so an operator can later
 * revoke it from the admin UI / audit log if they suspect compromise.
 *
 * The previous active signing secret is revoked atomically in the same
 * transaction — no grace window. Customers MUST update their intake
 * pipeline before calling rotate-secret in production.
 */
export const rotateSecretResponseSchema = z.object({
  key_id: z.string(),
  signing_secret: z.string(),
  created_at: z.string(),
});
export type RotateSecretResponse = z.infer<typeof rotateSecretResponseSchema>;
