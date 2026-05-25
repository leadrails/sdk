// Destination-resource tools — wraps `/v1/destinations/*`.
//
// v1 `/destinations` surface. A destination is an outbound row holding
// an adapter type (`slack`, `n8n`, `housecall_pro`, …) plus its
// adapter-specific config (`webhook_url`, `locationId`+`apiKey`, …).
// The /v1 surface encrypts the config at rest using the workspace's
// DEK; on read the detail endpoint returns plaintext config and a
// `sensitive_keys[]` hint so SDKs/MCP clients can mask password-type
// fields by default.
//
// Six tools registered here:
//
//   list_destinations    — paged scan (list-row shape: no config)
//   get_destination      — fetch one by id (detail shape: with config)
//   create_destination   — POST /v1/destinations
//   update_destination   — PATCH /v1/destinations/{id}
//   pause_destination    — POST /v1/destinations/{id}/pause
//   test_destination     — POST /v1/destinations/{id}/test
//                          (dispatches a synthetic event, no persistence)
//
// Resume is via `update_destination` with `status: "active"`. This is
// intentionally NOT a separate tool — sources have an asymmetric
// pause-only endpoint that justifies the convenience wrapper; the
// destination PATCH surface is already symmetric so a dedicated
// resume tool would be noise on the tool list.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createDestinationRequestSchema,
  destinationDetailSchema,
  destinationListResponseSchema,
  destinationTestResponseSchema,
  patchDestinationRequestSchema,
  type DestinationDetail,
  type DestinationListResponse,
  type DestinationTestResponse,
} from "../schemas/index.js";
import { z } from "zod";
import type { ApiClient } from "../lib/api-client.js";
import { listResult, successResult } from "../lib/dual-emit.js";
import { registerTool, type AnyToolDefinition } from "../lib/register.js";

const idArgSchema = {
  id: z.string().min(1).describe("Destination id — `dst_<ULID>`"),
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
type PaginationInput = { cursor?: string; limit?: number };

export function createDestinationTools(
  client: ApiClient,
): Record<string, AnyToolDefinition> {
  return {
    list_destinations: {
      title: "List destinations",
      description:
        "Page through the workspace's destinations. Returns the list-row " +
        "shape (no `config` field — listing destinations stays cheap and " +
        "doesn't decrypt credentials). Use `get_destination` for the full " +
        "detail-row shape.",
      inputSchema: paginationArgs,
      outputSchema: destinationListResponseSchema.shape,
      handler: async (input) => {
        const { cursor, limit } = input as PaginationInput;
        const res = await client.get<DestinationListResponse>("/destinations", {
          cursor,
          limit,
        });
        const parsed = destinationListResponseSchema.parse(res.body);
        return listResult("destination(s)", parsed);
      },
    },
    get_destination: {
      title: "Get a destination by id (with decrypted config)",
      description:
        "Fetch one destination with its full decrypted config plus the " +
        "`sensitive_keys[]` hint indicating which config fields the client " +
        "should mask by default. 404 if no match.",
      inputSchema: idArgSchema,
      outputSchema: destinationDetailSchema.shape,
      handler: async (input) => {
        const res = await client.get<DestinationDetail>(
          `/destinations/${input.id}`,
        );
        const parsed = destinationDetailSchema.parse(res.body);
        return successResult(
          `Destination ${parsed.id} (${parsed.name}, ${parsed.adapter_type}) — status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    create_destination: {
      title: "Create a destination",
      description:
        "Create a new destination. `adapter_type` must match a registered " +
        "adapter (slack, n8n, zapier, make, housecall_pro, gohighlevel, " +
        "generic_webhook). The `config` object is validated against the " +
        "adapter's schema server-side; outbound URLs are checked against " +
        "`isSafeOutboundUrl` at write time. The returned `id` is " +
        "`dst_<ULID>`.",
      inputSchema: createDestinationRequestSchema.shape,
      outputSchema: destinationDetailSchema.shape,
      handler: async (input) => {
        const body = createDestinationRequestSchema.parse(input);
        const res = await client.post<DestinationDetail>("/destinations", body);
        const parsed = destinationDetailSchema.parse(res.body);
        return successResult(
          `Created destination ${parsed.id} (${parsed.adapter_type}). Call test_destination to verify credentials.`,
          parsed,
        );
      },
    },
    update_destination: {
      title: "Update a destination (partial)",
      description:
        "Partial update — only supplied fields are written. `status` is " +
        "restricted to `active|paused` (revoke is an admin-only soft " +
        "delete). `adapter_type` is NOT patchable — switching mid-flight " +
        "would invalidate the encrypted config; create a new destination " +
        "instead.",
      inputSchema: {
        ...idArgSchema,
        ...patchDestinationRequestSchema.shape,
      },
      outputSchema: destinationDetailSchema.shape,
      handler: async (input) => {
        const { id, ...patchInput } = input as { id: string } & Record<
          string,
          unknown
        >;
        const body = patchDestinationRequestSchema.parse(patchInput);
        const res = await client.patch<DestinationDetail>(
          `/destinations/${id}`,
          body,
        );
        const parsed = destinationDetailSchema.parse(res.body);
        return successResult(
          `Updated destination ${parsed.id} — status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    pause_destination: {
      title: "Pause a destination",
      description:
        "Pause delivery to this destination. The intake worker still " +
        "accepts events but delivery jobs targeting this destination are " +
        "skipped (lenient sources, strict destinations). Idempotent — " +
        "already-paused destinations return unchanged. To resume, call " +
        "`update_destination` with status: 'active'.",
      inputSchema: idArgSchema,
      outputSchema: destinationDetailSchema.shape,
      handler: async (input) => {
        const res = await client.post<DestinationDetail>(
          `/destinations/${input.id}/pause`,
        );
        const parsed = destinationDetailSchema.parse(res.body);
        return successResult(
          `Destination ${parsed.id} is now paused.`,
          parsed,
        );
      },
    },
    test_destination: {
      title: "Dispatch a synthetic test event through a destination",
      description:
        "Dispatch a synthetic lead-event through the destination's adapter " +
        "to verify credentials. NO delivery_job is persisted — this is a " +
        "fire-once probe. The response reports the classified outcome " +
        "(success | transient_failure | permanent_failure | rate_limited) " +
        "plus any error_code / error_message the adapter surfaced. Useful " +
        "right after `create_destination` to catch typos in webhook_url, " +
        "expired API tokens, etc.",
      inputSchema: idArgSchema,
      outputSchema: destinationTestResponseSchema.shape,
      handler: async (input) => {
        const res = await client.post<DestinationTestResponse>(
          `/destinations/${input.id}/test`,
        );
        const parsed = destinationTestResponseSchema.parse(res.body);
        const verdict = parsed.ok
          ? "OK"
          : `FAILED (${parsed.classification}${parsed.error_message ? `: ${parsed.error_message}` : ""})`;
        return successResult(
          `Test dispatch for destination ${input.id}: ${verdict}.`,
          parsed,
        );
      },
    },
  };
}

export function registerDestinationTools(
  server: McpServer,
  client: ApiClient,
): void {
  for (const [name, def] of Object.entries(createDestinationTools(client))) {
    registerTool(server, name, def);
  }
}
