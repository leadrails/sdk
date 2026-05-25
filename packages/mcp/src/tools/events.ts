// Event-resource tools — wraps `/v1/events/*`.
//
// v1 `/events` surface. Events are the read-only audit trail of
// every accepted lead intake; `delivery_jobs` are the per-destination
// dispatches that fan out from an event. The public surface is
// read-only — mutations happen via the HMAC-signed intake POST.
//
// PLAN-GATED. The /v1/events endpoints require Pro+ plans
// (Pro / Agency / Scale). On Free or Starter, the server returns an
// RFC-9457 `plan-required` problem with status 403. The shared
// `errorResult(...)` helper in `lib/dual-emit.ts` catches this and
// surfaces a structured upgrade hint in the human summary so an LLM
// can offer "upgrade your plan to query events" instead of saying
// "internal error."
//
// Three tools registered here:
//
//   query_events                  — paged + filterable
//   get_event                     — fetch one by id
//   get_delivery_jobs_for_event   — flat list of fan-out jobs
//
// Wire shapes come from the vendored `../schemas/events` module
// (mirrors `@leadrails/schema/public/events` from the LeadRails
// monorepo). The schemas are prefixed `v1*` in that module — both the
// API route handlers and these tools validate against the same Zod
// types.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  v1EventDeliveryJobsResponseSchema,
  v1EventResponseSchema,
  v1EventsListResponseSchema,
  type V1EventDeliveryJobsResponse,
  type V1EventResponse,
  type V1EventsListResponse,
} from "../schemas/index.js";
import { z } from "zod";
import type { ApiClient } from "../lib/api-client.js";
import { successResult } from "../lib/dual-emit.js";
import { registerTool, type AnyToolDefinition } from "../lib/register.js";

const idArgSchema = {
  id: z.string().min(1).describe("Event id — `evt_<ULID>`"),
};

export function createEventTools(
  client: ApiClient,
): Record<string, AnyToolDefinition> {
  return {
    query_events: {
      title: "Query events (Pro+ plan required)",
      description:
        "Page through the workspace's lead events. Filterable by " +
        "`source_id`, `destination_id`, `status` (`delivered|failed|" +
        "pending`), `from`, `to` (ISO-8601). Requires a Pro, Agency, or " +
        "Scale plan; on Free / Starter the response is an RFC-9457 " +
        "`plan-required` problem with an upgrade hint. Combine with " +
        "`get_delivery_jobs_for_event` to see fan-out outcomes for a " +
        "specific event.",
      inputSchema: {
        source_id: z
          .string()
          .min(1)
          .optional()
          .describe("Filter to events from a specific source"),
        destination_id: z
          .string()
          .min(1)
          .optional()
          .describe("Filter to events that fanned out to a destination"),
        status: z
          .enum(["delivered", "failed", "pending"])
          .optional()
          .describe(
            "Filter by delivery-side status: delivered | failed | pending " +
              "(pending collapses pending/enqueued/processing/retrying).",
          ),
        from: z
          .string()
          .optional()
          .describe("ISO-8601 lower bound on received_at (inclusive)"),
        to: z
          .string()
          .optional()
          .describe("ISO-8601 upper bound on received_at (exclusive)"),
        cursor: z
          .string()
          .min(1)
          .optional()
          .describe("Opaque pagination cursor"),
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Items per page (1..100, default 50)"),
      },
      outputSchema: v1EventsListResponseSchema.shape,
      handler: async (input) => {
        const args = input as {
          source_id?: string;
          destination_id?: string;
          status?: string;
          from?: string;
          to?: string;
          cursor?: string;
          limit?: number;
        };
        const res = await client.get<V1EventsListResponse>("/events", {
          source_id: args.source_id,
          destination_id: args.destination_id,
          status: args.status,
          from: args.from,
          to: args.to,
          cursor: args.cursor,
          limit: args.limit,
        });
        const parsed = v1EventsListResponseSchema.parse(res.body);
        const cursorSummary = parsed.next_cursor
          ? ` next_cursor=${parsed.next_cursor}.`
          : " (last page).";
        return successResult(
          `Found ${parsed.data.length} event(s).${cursorSummary}`,
          parsed,
        );
      },
    },
    get_event: {
      title: "Get an event by id (Pro+ plan required)",
      description:
        "Fetch one accepted lead-event row. The returned `data` object " +
        "projects the wire-stable subset of `lead_events` columns: id, " +
        "client_id, source_id, schema_version, idempotency_key, " +
        "normalized_status, received_at, plus HTTP context (remote_ip, " +
        "user_agent, referer, origin, site_url, workflow_name). " +
        "Requires Pro, Agency, or Scale.",
      inputSchema: idArgSchema,
      outputSchema: v1EventResponseSchema.shape,
      handler: async (input) => {
        const res = await client.get<V1EventResponse>(`/events/${input.id}`);
        const parsed = v1EventResponseSchema.parse(res.body);
        const evt = parsed.data;
        return successResult(
          `Event ${evt.id} from source ${evt.source_id} received at ${evt.received_at} ` +
            `(normalized_status=${evt.normalized_status}).`,
          parsed,
        );
      },
    },
    get_delivery_jobs_for_event: {
      title: "List delivery jobs for an event (Pro+ plan required)",
      description:
        "Fetch every `delivery_job` the system enqueued for one event " +
        "(one per matching route at intake time), each embedded with its " +
        "ordered `attempts[]` history. The response includes the current " +
        "scheduler `status`, `attempt_count` (capped at `max_attempts=5`), " +
        "last `last_error_code` / `last_error_message`, and " +
        "`next_attempt_at` for jobs still pending. Useful for diagnosing " +
        "why a destination did NOT receive a lead. Not paginated — one " +
        "event fans out to O(routes) jobs and the existing fanout caps " +
        "are well under the page size. Requires Pro, Agency, or Scale.",
      inputSchema: idArgSchema,
      outputSchema: v1EventDeliveryJobsResponseSchema.shape,
      handler: async (input) => {
        const res = await client.get<V1EventDeliveryJobsResponse>(
          `/events/${input.id}/delivery-jobs`,
        );
        const parsed = v1EventDeliveryJobsResponseSchema.parse(res.body);
        const delivered = parsed.data.filter(
          (j) => j.status === "delivered",
        ).length;
        return successResult(
          `Event ${input.id} produced ${parsed.data.length} delivery job(s); ${delivered} delivered.`,
          parsed,
        );
      },
    },
  };
}

export function registerEventTools(server: McpServer, client: ApiClient): void {
  for (const [name, def] of Object.entries(createEventTools(client))) {
    registerTool(server, name, def);
  }
}
