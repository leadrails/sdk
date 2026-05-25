// Route-resource tools — wraps `/v1/routes/*`.
//
// v1 `/routes` surface. A "route" wires a source to a destination:
// every accepted intake event on `source_id` produces a `delivery_job`
// per active route that points at that source + destination pair. The
// wire shape uses a single `destination_id` per row (NOT an array) —
// fan-out across N destinations is N rows in the routes table.
//
// Five tools registered here:
//
//   list_routes   — paged scan
//   get_route     — fetch one by id
//   create_route  — POST /v1/routes
//   update_route  — PATCH /v1/routes/{id}
//   delete_route  — DELETE /v1/routes/{id} (soft-delete → status:revoked)
//
// `delete_route` is a soft delete on the public surface — the row flips
// to `status:"revoked"` and future fan-out skips it. In-flight
// delivery_jobs already on the queue still execute. The endpoint is
// idempotent: deleting an already-revoked route returns the cached row.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createRouteRequestSchema,
  deleteRouteResponseSchema,
  makeListResponseSchema,
  patchRouteRequestSchema,
  routeSchema,
  type DeleteRouteResponse,
  type Route,
} from "../schemas/index.js";
import { z } from "zod";
import type { ApiClient } from "../lib/api-client.js";
import { listResult, successResult } from "../lib/dual-emit.js";
import { registerTool, type AnyToolDefinition } from "../lib/register.js";

const routeListResponseSchema = makeListResponseSchema(routeSchema);

const idArgSchema = {
  id: z.string().min(1).describe("Route id — `rt_<ULID>`"),
};

const paginationArgs = {
  cursor: z.string().min(1).optional().describe("Opaque pagination cursor"),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Items per page (1..100, default 50)"),
};
type PaginationInput = { cursor?: string; limit?: number };

export function createRouteTools(
  client: ApiClient,
): Record<string, AnyToolDefinition> {
  return {
    list_routes: {
      title: "List routes",
      description:
        "Page through the workspace's routes. A route wires one source " +
        "to one destination; the response includes `source_id`, " +
        "`destination_id`, `priority`, and `status`.",
      inputSchema: paginationArgs,
      outputSchema: routeListResponseSchema.shape,
      handler: async (input) => {
        const { cursor, limit } = input as PaginationInput;
        const res = await client.get<z.infer<typeof routeListResponseSchema>>(
          "/routes",
          { cursor, limit },
        );
        const parsed = routeListResponseSchema.parse(res.body);
        return listResult("route(s)", parsed);
      },
    },
    get_route: {
      title: "Get a route by id",
      description:
        "Fetch one route row. 404 if no match. The response includes " +
        "`source_id`, `destination_id`, `priority`, and current `status`.",
      inputSchema: idArgSchema,
      outputSchema: routeSchema.shape,
      handler: async (input) => {
        const res = await client.get<Route>(`/routes/${input.id}`);
        const parsed = routeSchema.parse(res.body);
        return successResult(
          `Route ${parsed.id} (${parsed.name}) — source: ${parsed.source_id ?? "(unbound)"} → destination: ${parsed.destination_id}. Status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    create_route: {
      title: "Create a route",
      description:
        "Wire a source to a destination. Both `source_id` and " +
        "`destination_id` are required and must already exist in the " +
        "workspace; the server re-verifies workspace ownership and " +
        "returns 400 `invalid-reference` on any cross-workspace id. " +
        "`workflow_id` is optional — when omitted, the source's default " +
        "workflow is used. To fan one source out to N destinations, " +
        "create N routes.",
      inputSchema: createRouteRequestSchema.shape,
      outputSchema: routeSchema.shape,
      handler: async (input) => {
        const body = createRouteRequestSchema.parse(input);
        const res = await client.post<Route>("/routes", body);
        const parsed = routeSchema.parse(res.body);
        return successResult(
          `Created route ${parsed.id} — source ${parsed.source_id ?? "(unbound)"} → destination ${parsed.destination_id}.`,
          parsed,
        );
      },
    },
    update_route: {
      title: "Update a route (partial)",
      description:
        "Partial update — only supplied fields are written. `status` " +
        "flips between `active|paused`; flipping to `revoked` goes " +
        "through `delete_route` so the soft-delete gets its own audit " +
        "row. `destination_id` MAY be patched (the new id is " +
        "re-verified against the workspace). `source_id` is NOT " +
        "patchable — moving a route across sources would orphan the " +
        "workflow link; create a new route instead.",
      inputSchema: {
        ...idArgSchema,
        ...patchRouteRequestSchema.shape,
      },
      outputSchema: routeSchema.shape,
      handler: async (input) => {
        const { id, ...patchInput } = input as { id: string } & Record<
          string,
          unknown
        >;
        const body = patchRouteRequestSchema.parse(patchInput);
        const res = await client.patch<Route>(`/routes/${id}`, body);
        const parsed = routeSchema.parse(res.body);
        return successResult(
          `Updated route ${parsed.id} — status: ${parsed.status}.`,
          parsed,
        );
      },
    },
    delete_route: {
      title: "Delete a route (soft-delete → revoked)",
      description:
        "Soft-delete a route. Flips status to `revoked`; future fan-out " +
        "skips revoked routes. In-flight delivery_jobs already on the " +
        "queue still execute. Idempotent — deleting an already-revoked " +
        "route returns the cached row with `status:\"revoked\"`. The " +
        "referenced source and destination are NOT touched.",
      inputSchema: idArgSchema,
      outputSchema: deleteRouteResponseSchema.shape,
      handler: async (input) => {
        const res = await client.delete<DeleteRouteResponse>(
          `/routes/${input.id}`,
        );
        const parsed = deleteRouteResponseSchema.parse(res.body);
        return successResult(
          `Route ${parsed.id} soft-deleted (status: ${parsed.status}).`,
          parsed,
        );
      },
    },
  };
}

export function registerRouteTools(server: McpServer, client: ApiClient): void {
  for (const [name, def] of Object.entries(createRouteTools(client))) {
    registerTool(server, name, def);
  }
}
