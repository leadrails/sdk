// Unit tests for route tools. Mocked HTTP layer. Covers:
//   - list_routes pagination wiring.
//   - get_route summary mentions the source + destination.
//   - create_route POSTs the requested body (source + destination).
//   - update_route PATCHes with id removed from body.
//   - delete_route returns the full route row with status:"revoked".

import { describe, it, expect } from "vitest";
import { createRouteTools } from "./routes.js";
import type { ApiClient, ApiResponse } from "../lib/api-client.js";

function buildClient(
  responses: Record<string, unknown>,
): { client: ApiClient; calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> } {
  const calls: Array<{ method: string; path: string; body?: unknown; query?: unknown }> = [];
  const reply = (path: string): ApiResponse<unknown> => ({
    body: responses[path] ?? (() => { throw new Error(`mock: no response for ${path}`); })(),
    status: 200,
    headers: new Headers(),
  });
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

function fakeRoute(over: Record<string, unknown> = {}) {
  return {
    id: "rt_01J123",
    client_id: "cli_01J999",
    name: "Default fan-out",
    source_id: "src_01J123",
    destination_id: "dst_01J123",
    workflow_id: "wf_01J123",
    status: "active",
    priority: 100,
    filter_rules_json: null,
    mapping_version: "default",
    mapping_json: null,
    created_at: "2026-05-22T00:00:00Z",
    updated_at: "2026-05-22T00:00:00Z",
    ...over,
  };
}

describe("route tools", () => {
  it("list_routes forwards pagination", async () => {
    const { client, calls } = buildClient({
      "/routes": { data: [fakeRoute()], has_more: false, next_cursor: null },
    });
    const tools = createRouteTools(client);
    await tools.list_routes!.handler({ limit: 100 });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/routes",
      query: { limit: 100 },
    });
  });

  it("get_route summary names the source and destination", async () => {
    const { client } = buildClient({
      "/routes/rt_01J123": fakeRoute(),
    });
    const tools = createRouteTools(client);
    const result = await tools.get_route!.handler({ id: "rt_01J123" });
    expect(result.content[0]!.text).toContain("src_01J123");
    expect(result.content[0]!.text).toContain("dst_01J123");
  });

  it("create_route POSTs source + destination", async () => {
    const { client, calls } = buildClient({
      "/routes": fakeRoute(),
    });
    const tools = createRouteTools(client);
    await tools.create_route!.handler({
      name: "New fan-out",
      source_id: "src_01J123",
      destination_id: "dst_01J123",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/routes",
      body: {
        name: "New fan-out",
        source_id: "src_01J123",
        destination_id: "dst_01J123",
      },
    });
  });

  it("update_route PATCHes with id removed from body", async () => {
    const { client, calls } = buildClient({
      "/routes/rt_01J123": fakeRoute({ status: "paused" }),
    });
    const tools = createRouteTools(client);
    await tools.update_route!.handler({
      id: "rt_01J123",
      status: "paused",
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/routes/rt_01J123",
      body: { status: "paused" },
    });
    expect((calls[0]?.body as Record<string, unknown>).id).toBeUndefined();
  });

  it("delete_route returns the full route row with status:revoked", async () => {
    const { client, calls } = buildClient({
      "/routes/rt_01J123": fakeRoute({ status: "revoked" }),
    });
    const tools = createRouteTools(client);
    const result = await tools.delete_route!.handler({ id: "rt_01J123" });
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      path: "/routes/rt_01J123",
    });
    expect(result.structuredContent).toMatchObject({
      id: "rt_01J123",
      status: "revoked",
    });
  });
});
