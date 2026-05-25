// Source-resource tools — wraps `/v1/sources/*`.
//
// v1 `/sources` surface. Sources are the entry-point row a
// customer wires up when they integrate a new lead-capture form;
// every source carries an attached `source_keys` row holding the HMAC
// signing secret the intake worker validates.
//
// Eight tools registered here (the most of any resource family):
//
//   list_sources           — paged scan of the workspace's sources
//   get_source             — fetch one by id
//   create_source          — POST /v1/sources
//   update_source          — PATCH /v1/sources/{id}
//   pause_source           — POST /v1/sources/{id}/pause
//   resume_source          — PATCH /v1/sources/{id} (status: active)
//   revoke_source          — POST /v1/sources/{id}/revoke (terminal)
//   rotate_source_secret   — POST /v1/sources/{id}/rotate-secret
//                            (single-shot reveal)
//
// `resume_source` is implemented as a PATCH-status convenience — there
// is intentionally NO dedicated /v1/sources/{id}/resume endpoint on
// the API (the proposal documents pause as the only one-shot route;
// resume is a status flip). Wrapping it as a discoverable tool keeps
// the MCP UX symmetric with `pause_source` so an agent doesn't have
// to know about the asymmetric backend semantics.
//
// All write tools use `client.post` / `client.patch` which stamp a
// fresh UUID v4 `Idempotency-Key` per call. Replays are server-side
// idempotent for 24h.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createSourceRequestSchema,
  makeListResponseSchema,
  patchSourceRequestSchema,
  rotateSecretResponseSchema,
  sourceSchema,
  type RotateSecretResponse,
  type Source,
} from "../schemas/index.js";
import { z } from "zod";
import type { ApiClient } from "../lib/api-client.js";
import { listResult, successResult } from "../lib/dual-emit.js";
import { registerTool, type AnyToolDefinition } from "../lib/register.js";

const sourceListResponseSchema = makeListResponseSchema(sourceSchema);

const idArgSchema = {
  id: z.string().min(1).describe("Source id — `src_<ULID>`"),
};

const paginationArgs = {
  cursor: z.string().min(1).optional().describe("Opaque pagination cursor"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Items per page (1..200, default 50)"),
};
/**
 * Local input-type alias used by handlers to narrow the loosely-typed
 * `Record<string, unknown>` argument back to the specific shape the
 * handler validates. The `AnyToolDefinition` record-value type widens
 * the per-handler signature to keep the factory return type
 * heterogeneous; this alias provides the tight type at the call site.
 */
type PaginationInput = { cursor?: string; limit?: number };

export function createSourceTools(
  client: ApiClient,
): Record<string, AnyToolDefinition> {
  return {
    list_sources: {
      title: "List sources",
      description:
        "Page through the workspace's sources. Paginated via opaque " +
        "`cursor` + `limit` (default 50, max 200). Returns `data`, " +
        "`has_more`, `next_cursor` — pass `next_cursor` back as `cursor` to " +
        "fetch the next page.",
      inputSchema: paginationArgs,
      outputSchema: sourceListResponseSchema.shape,
      handler: async (input) => {
        const { cursor, limit } = input as PaginationInput;
        const res = await client.get<z.infer<typeof sourceListResponseSchema>>(
          "/sources",
          { cursor, limit },
        );
        const parsed = sourceListResponseSchema.parse(res.body);
        return listResult("source(s)", parsed);
      },
    },
    get_source: {
      title: "Get a source by id",
      description: "Fetch one source row from the workspace. 404 if no match.",
      inputSchema: idArgSchema,
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const res = await client.get<Source>(`/sources/${input.id}`);
        const parsed = sourceSchema.parse(res.body);
        return successResult(
          `Source ${parsed.id} (${parsed.name}, ${parsed.source_type}) — status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    create_source: {
      title: "Create a source",
      description:
        "Create a new source in the workspace. `name`, `source_type`, and " +
        "optional `allowed_site_url` are accepted. The workspace is implied " +
        "by the API key; you cannot create a source in a different workspace. " +
        "The returned `id` is `src_<ULID>`. Pair with `rotate_source_secret` " +
        "to obtain the HMAC signing secret your intake pipeline needs.",
      inputSchema: createSourceRequestSchema.shape,
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const body = createSourceRequestSchema.parse(input);
        const res = await client.post<Source>("/sources", body);
        const parsed = sourceSchema.parse(res.body);
        return successResult(
          `Created source ${parsed.id} (${parsed.name}). Call rotate_source_secret next to mint a signing secret.`,
          parsed,
        );
      },
    },
    update_source: {
      title: "Update a source (partial)",
      description:
        "Partial update — only supplied fields are written. `status` is " +
        "restricted to `active|paused`; flipping to `revoked` goes through " +
        "the dedicated `revoke_source` tool so the irreversible action has " +
        "its own audit row. To pause/resume specifically, prefer the " +
        "`pause_source` / `resume_source` convenience tools.",
      inputSchema: {
        ...idArgSchema,
        ...patchSourceRequestSchema.shape,
      },
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const { id, ...patchInput } = input as { id: string } & Record<
          string,
          unknown
        >;
        const body = patchSourceRequestSchema.parse(patchInput);
        const res = await client.patch<Source>(`/sources/${id}`, body);
        const parsed = sourceSchema.parse(res.body);
        return successResult(
          `Updated source ${parsed.id} — status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    pause_source: {
      title: "Pause a source",
      description:
        "Pause intake fan-out for a source. A paused source still ingests " +
        "events (they persist with `source_paused: true` activity) but no " +
        "delivery jobs are enqueued. Idempotent — already-paused sources " +
        "return unchanged.",
      inputSchema: idArgSchema,
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const res = await client.post<Source>(`/sources/${input.id}/pause`);
        const parsed = sourceSchema.parse(res.body);
        return successResult(`Source ${parsed.id} is now paused.`, parsed);
      },
    },
    resume_source: {
      title: "Resume a paused source",
      description:
        "Resume a paused source by flipping its status back to `active`. " +
        "Implemented as a PATCH-status convenience over /v1/sources/{id}; " +
        "the underlying surface does not expose a separate /resume " +
        "endpoint. Idempotent — already-active sources return unchanged.",
      inputSchema: idArgSchema,
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const res = await client.patch<Source>(`/sources/${input.id}`, {
          status: "active",
        });
        const parsed = sourceSchema.parse(res.body);
        return successResult(`Source ${parsed.id} is now active.`, parsed);
      },
    },
    revoke_source: {
      title: "Revoke a source (irreversible)",
      description:
        "Revoke a source. TERMINAL — once revoked, intake auth hard-fails " +
        "for the source's signing key and the row cannot be reactivated. " +
        "Use this when a key is suspected compromised AND you do not want " +
        "to rotate it (rotation is the usual path; revoke is for full " +
        "decommission). This action is audited.",
      inputSchema: idArgSchema,
      outputSchema: sourceSchema.shape,
      handler: async (input) => {
        const res = await client.post<Source>(`/sources/${input.id}/revoke`);
        const parsed = sourceSchema.parse(res.body);
        return successResult(
          `Source ${parsed.id} REVOKED. Intake auth will now hard-fail for this source.`,
          parsed,
        );
      },
    },
    rotate_source_secret: {
      title: "Rotate a source's HMAC signing secret (single-shot reveal)",
      description:
        "Mint a fresh HMAC signing secret for the source. The previous " +
        "active signing secret is revoked atomically in the same " +
        "transaction — there is NO grace window. " +
        "The plaintext secret is returned ONCE and cannot be recovered " +
        "after this response; persist `signing_secret` in your secrets " +
        "store before doing anything else. Customers MUST update their " +
        "intake pipeline before calling this in production.",
      inputSchema: idArgSchema,
      outputSchema: rotateSecretResponseSchema.shape,
      handler: async (input) => {
        const res = await client.post<RotateSecretResponse>(
          `/sources/${input.id}/rotate-secret`,
        );
        const parsed = rotateSecretResponseSchema.parse(res.body);
        return successResult(
          `Rotated signing secret for source ${input.id}. key_id=${parsed.key_id}. ` +
            "Persist signing_secret now — it cannot be recovered after this response.",
          parsed,
        );
      },
    },
  };
}

export function registerSourceTools(server: McpServer, client: ApiClient): void {
  for (const [name, def] of Object.entries(createSourceTools(client))) {
    registerTool(server, name, def);
  }
}
