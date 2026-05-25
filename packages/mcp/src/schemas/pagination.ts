// Cursor pagination — shared wire helpers for every list endpoint on /v1.
//
// Every /v1/* list endpoint returns the same envelope so SDK generators
// can emit ONE paged-list type and reuse it across resources (sources,
// destinations, routes, events). The cursor is an opaque base64-encoded
// payload — clients MUST NOT parse it. The wire guarantees we make:
//
//   - `next_cursor` is a string when `has_more` is true.
//   - `next_cursor` is `null` when `has_more` is false.
//   - Sending an unknown/malformed cursor returns 400 `invalid-cursor`.
//
// Cursor payload shape is encoded in `apps/admin-api-worker/src/lib/cursor.ts`
// (base64 of `{ after_id, after_created_at }`). The shape is deliberately
// NOT exported as a wire schema — keeping the encoding server-side means
// we can change the implementation (add a tiebreaker, switch to keyset on
// `id` only, etc.) without breaking SDK contracts.
//
// Query params share the same `limitSchema` so every list endpoint has the
// same min/max/default behavior. v1 picks 1..100, default 50; future
// versions can widen `max` to 200 without a contract break (clients that
// pin lower still get fewer rows).
//
// .openapi(...) registrations are NOT applied here — `packages/schema` is a
// leaf and must not depend on `@hono/zod-openapi`. Route files attach
// per-field descriptions and named-component registrations at use-site.
import { z } from "zod";

/**
 * `limit` query param. Coerced from string (URL query) → number; clamps
 * out-of-range values via Zod's `.min`/`.max` so a malformed value (e.g.
 * `?limit=abc` or `?limit=99999`) renders a 422 schema-validation problem
 * rather than silently scanning the whole table.
 *
 * Default-vs-undefined: we mark this `.optional()` so the route handler
 * can supply `limit ?? 50` instead of forcing a default at schema-parse
 * time. Splitting the default to the handler keeps the OpenAPI doc honest
 * (the field is genuinely optional in the wire contract).
 */
export const limitQuerySchema = z.coerce.number().int().min(1).max(100).optional();

/**
 * `cursor` query param. Opaque base64 string. Server decodes via
 * `apps/admin-api-worker/src/lib/cursor.ts`; a malformed/unknown cursor
 * renders a 400 RFC-9457 problem with slug `invalid-cursor`.
 */
export const cursorQuerySchema = z.string().min(1).optional();

/**
 * Standard list-envelope. Used by `GET /v1/<resource>` for every resource:
 *
 *   { data: T[], has_more: boolean, next_cursor: string | null }
 *
 * Locked by the v1 spec so SDKs can emit one `Paged<T>` helper instead of
 * N per-resource shapes. Adding a top-level field is non-breaking (clients
 * ignore unknown keys); removing or renaming a field is a v2 break.
 */
export function makeListResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
): z.ZodObject<{
  data: z.ZodArray<T>;
  has_more: z.ZodBoolean;
  next_cursor: z.ZodNullable<z.ZodString>;
}> {
  return z.object({
    data: z.array(itemSchema),
    has_more: z.boolean(),
    next_cursor: z.string().nullable(),
  });
}
