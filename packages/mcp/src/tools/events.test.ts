// Unit tests for event tools. Mocked HTTP layer. Covers:
//   - query_events forwards filter params + pagination.
//   - get_event surfaces normalized_status in the summary.
//   - get_delivery_jobs_for_event counts delivered jobs in the summary.
//   - error path: when the API returns a `plan-required` problem, the
//     thrown `ApiError` round-trips with isPlanRequired set so the
//     shared error formatter in `lib/dual-emit.ts` can surface the
//     upgrade hint (the actual formatting is unit-tested in
//     `lib/dual-emit.test.ts`).

import { describe, it, expect } from "vitest";
import { createEventTools } from "./events.js";
import { ApiError } from "../lib/api-client.js";
import type { ApiClient, ApiResponse } from "../lib/api-client.js";

function buildClient(
  responses: Record<string, unknown>,
): { client: ApiClient; calls: Array<{ method: string; path: string; query?: unknown }> } {
  const calls: Array<{ method: string; path: string; query?: unknown }> = [];
  const ok = (body: unknown): ApiResponse<unknown> => ({
    body,
    status: 200,
    headers: new Headers(),
  });
  const noop = async (): Promise<never> => {
    throw new Error("unexpected mutation in events suite");
  };
  const client: ApiClient = {
    baseUrl: "http://test/v1",
    async get(path: string, query?: Record<string, string | number | undefined>) {
      calls.push({ method: "GET", path, query });
      const body = responses[path];
      if (body === undefined) {
        throw new Error(`mock: no response for ${path}`);
      }
      return ok(body) as ApiResponse<never>;
    },
    post: noop,
    patch: noop,
    delete: noop,
  };
  return { client, calls };
}

function fakeEvent(over: Record<string, unknown> = {}) {
  return {
    id: "evt_01J123",
    client_id: "cli_01J999",
    source_id: "src_01J123",
    schema_version: "v1",
    idempotency_key: "idem_01J123",
    normalized_status: "normalized",
    received_at: "2026-05-22T12:00:00Z",
    remote_ip: null,
    user_agent: null,
    referer: null,
    origin: null,
    site_url: null,
    workflow_name: "default",
    ...over,
  };
}

function fakeJob(over: Record<string, unknown> = {}) {
  return {
    id: "job_01J123",
    event_id: "evt_01J123",
    client_id: "cli_01J999",
    route_id: "rt_01J123",
    destination_id: "dst_01J123",
    adapter_type: "slack",
    status: "delivered",
    attempt_count: 1,
    max_attempts: 5,
    next_attempt_at: null,
    last_error_code: null,
    last_error_message: null,
    created_at: "2026-05-22T12:00:01Z",
    updated_at: "2026-05-22T12:00:02Z",
    delivered_at: "2026-05-22T12:00:02Z",
    attempts: [],
    ...over,
  };
}

describe("event tools", () => {
  it("query_events forwards filters + pagination", async () => {
    const { client, calls } = buildClient({
      "/events": {
        data: [fakeEvent()],
        has_more: false,
        next_cursor: null,
      },
    });
    const tools = createEventTools(client);
    await tools.query_events!.handler({
      source_id: "src_01J123",
      from: "2026-05-01T00:00:00Z",
      limit: 100,
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/events",
      query: {
        source_id: "src_01J123",
        from: "2026-05-01T00:00:00Z",
        limit: 100,
      },
    });
  });

  it("get_event mentions normalized_status in the summary", async () => {
    const { client } = buildClient({
      "/events/evt_01J123": { data: fakeEvent({ normalized_status: "failed" }) },
    });
    const tools = createEventTools(client);
    const result = await tools.get_event!.handler({ id: "evt_01J123" });
    expect(result.content[0]!.text).toContain("normalized_status=failed");
  });

  it("get_delivery_jobs_for_event counts delivered jobs", async () => {
    const { client } = buildClient({
      "/events/evt_01J123/delivery-jobs": {
        data: [
          fakeJob({ status: "delivered" }),
          fakeJob({
            id: "job_01J124",
            destination_id: "dst_01J124",
            status: "pending",
            delivered_at: null,
          }),
        ],
      },
    });
    const tools = createEventTools(client);
    const result = await tools.get_delivery_jobs_for_event!.handler({
      id: "evt_01J123",
    });
    expect(result.content[0]!.text).toContain("2 delivery job(s); 1 delivered");
  });

  it("throws ApiError when /v1/events returns plan-required", async () => {
    const client: ApiClient = {
      baseUrl: "http://test/v1",
      async get() {
        throw new ApiError({
          message: "GET /events failed: Pro plan required",
          status: 403,
          body: {
            type: "https://docs.leadrails.dev/errors/plan-required",
            title: "Plan required",
            detail: "Events read requires Pro, Agency, or Scale.",
          },
        });
      },
      async post() {
        throw new Error("unexpected");
      },
      async patch() {
        throw new Error("unexpected");
      },
      async delete() {
        throw new Error("unexpected");
      },
    };
    const tools = createEventTools(client);
    await expect(
      tools.query_events!.handler({}),
    ).rejects.toMatchObject({ status: 403, isPlanRequired: true });
  });
});
