// Unit tests for destination tools. Mocked HTTP layer. Covers:
//   - list_destinations → GET /destinations with pagination params.
//   - get_destination   → GET /destinations/{id} returning the detail
//                          shape (with `config` + `sensitive_keys`).
//   - create_destination → POST body shape, adapter_type stays open
//                          string until server validates against
//                          `ADAPTERS[adapter_type].configSchema`.
//   - update_destination → PATCH path + id removed from body.
//   - pause_destination  → POST /destinations/{id}/pause.
//   - test_destination   → POST /destinations/{id}/test and summarizes
//                          success vs failure.

import { describe, it, expect } from "vitest";
import { createDestinationTools } from "./destinations.js";
import type { ApiClient, ApiResponse } from "../lib/api-client.js";

function buildClient(
  responses: Record<string, unknown>,
): { client: ApiClient; calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> } {
  const calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> = [];
  const reply = (path: string): ApiResponse<unknown> => {
    if (responses[path] === undefined) {
      throw new Error(`mock: no response configured for ${path}`);
    }
    return {
      body: responses[path],
      status: 200,
      headers: new Headers(),
    };
  };
  const client: ApiClient = {
    baseUrl: "http://test/v1",
    async get(path: string, query?: Record<string, string | number | undefined>) {
      calls.push({ method: "GET", path, query });
      return reply(path) as ApiResponse<never>;
    },
    async post(path: string, body?: unknown) {
      calls.push({ method: "POST", path, body });
      return reply(path) as ApiResponse<never>;
    },
    async patch(path: string, body: unknown) {
      calls.push({ method: "PATCH", path, body });
      return reply(path) as ApiResponse<never>;
    },
    async delete(path: string) {
      calls.push({ method: "DELETE", path });
      return reply(path) as ApiResponse<never>;
    },
  };
  return { client, calls };
}

function fakeListItem(over: Record<string, unknown> = {}) {
  return {
    id: "dst_01J123",
    client_id: "cli_01J999",
    name: "New Leads",
    adapter_type: "slack",
    status: "active",
    created_at: "2026-05-22T00:00:00Z",
    updated_at: "2026-05-22T00:00:00Z",
    ...over,
  };
}

function fakeDetail(over: Record<string, unknown> = {}) {
  return {
    ...fakeListItem(),
    config: { webhook_url: "https://hooks.slack.com/services/x/y/z" },
    sensitive_keys: ["webhook_url"],
    // `provider_metadata` is a required-but-nullable field on the v1
    // destination detail wire schema. The admin-api always
    // serializes it (set to null for adapters that don't opt into
    // the cache); test fixtures match the wire shape.
    provider_metadata: null,
    ...over,
  };
}

describe("destination tools", () => {
  it("list_destinations returns the list-row shape (no config)", async () => {
    const { client, calls } = buildClient({
      "/destinations": {
        data: [fakeListItem()],
        has_more: false,
        next_cursor: null,
      },
    });
    const tools = createDestinationTools(client);
    const result = await tools.list_destinations!.handler({ limit: 10 });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/destinations",
      query: { limit: 10 },
    });
    const structured = result.structuredContent as {
      data: Array<Record<string, unknown>>;
    };
    expect(structured.data[0]).not.toHaveProperty("config");
  });

  it("get_destination returns the detail shape with config + sensitive_keys", async () => {
    const { client } = buildClient({
      "/destinations/dst_01J123": fakeDetail(),
    });
    const tools = createDestinationTools(client);
    const result = await tools.get_destination!.handler({ id: "dst_01J123" });
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.config).toBeDefined();
    expect(structured.sensitive_keys).toEqual(["webhook_url"]);
  });

  it("create_destination POSTs with the open `config` payload", async () => {
    const { client, calls } = buildClient({
      "/destinations": fakeDetail({
        name: "New Slack",
        adapter_type: "slack",
        config: { webhook_url: "https://hooks.slack.com/services/a/b/c" },
      }),
    });
    const tools = createDestinationTools(client);
    await tools.create_destination!.handler({
      name: "New Slack",
      adapter_type: "slack",
      config: { webhook_url: "https://hooks.slack.com/services/a/b/c" },
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/destinations",
      body: {
        name: "New Slack",
        adapter_type: "slack",
        config: { webhook_url: "https://hooks.slack.com/services/a/b/c" },
      },
    });
  });

  it("update_destination strips id from the PATCH body", async () => {
    const { client, calls } = buildClient({
      "/destinations/dst_01J123": fakeDetail({ status: "paused" }),
    });
    const tools = createDestinationTools(client);
    await tools.update_destination!.handler({
      id: "dst_01J123",
      status: "paused",
      name: "Renamed",
    });
    expect(calls[0]?.body).toMatchObject({ status: "paused", name: "Renamed" });
    expect((calls[0]?.body as Record<string, unknown>).id).toBeUndefined();
  });

  it("pause_destination hits /pause", async () => {
    const { client, calls } = buildClient({
      "/destinations/dst_01J123/pause": fakeDetail({ status: "paused" }),
    });
    const tools = createDestinationTools(client);
    await tools.pause_destination!.handler({ id: "dst_01J123" });
    expect(calls[0]?.path).toBe("/destinations/dst_01J123/pause");
  });

  it("test_destination summarizes a successful probe", async () => {
    const { client } = buildClient({
      "/destinations/dst_01J123/test": {
        ok: true,
        classification: "success",
      },
    });
    const tools = createDestinationTools(client);
    const result = await tools.test_destination!.handler({ id: "dst_01J123" });
    expect(result.content[0]!.text).toContain("OK");
  });

  it("test_destination surfaces error_message on a failed probe", async () => {
    const { client } = buildClient({
      "/destinations/dst_01J123/test": {
        ok: false,
        classification: "transient_failure",
        error_code: "timeout",
        error_message: "Slack returned 503 after 5s",
      },
    });
    const tools = createDestinationTools(client);
    const result = await tools.test_destination!.handler({ id: "dst_01J123" });
    expect(result.content[0]!.text).toContain("FAILED");
    expect(result.content[0]!.text).toContain("transient_failure");
    expect(result.content[0]!.text).toContain("Slack returned 503");
  });
});
