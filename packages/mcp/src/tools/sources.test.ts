// Unit tests for source tools. Mocked HTTP layer. Covers:
//   - list_sources pagination wiring.
//   - get_source detail summary.
//   - create_source body shape.
//   - update_source forwards id in URL and the rest in body.
//   - pause_source / resume_source / revoke_source / rotate_source_secret
//     hit the correct paths.
//   - rotate_source_secret summary warns about the single-shot reveal.

import { describe, it, expect } from "vitest";
import { createSourceTools } from "./sources.js";
import type { ApiClient, ApiResponse } from "../lib/api-client.js";

interface CallRecord {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

function buildClient(
  handler: (call: CallRecord) => unknown,
): { client: ApiClient; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const ok = (body: unknown): ApiResponse<unknown> => ({
    body,
    status: 200,
    headers: new Headers(),
  });
  const client: ApiClient = {
    baseUrl: "http://test/v1",
    async get(path: string, query?: Record<string, string | number | undefined>) {
      const call: CallRecord = { method: "GET", path };
      if (query !== undefined) call.query = query;
      calls.push(call);
      return ok(handler(call)) as ApiResponse<never>;
    },
    async post(path: string, body?: unknown) {
      const call: CallRecord = { method: "POST", path };
      if (body !== undefined) call.body = body;
      calls.push(call);
      return ok(handler(call)) as ApiResponse<never>;
    },
    async patch(path: string, body: unknown) {
      calls.push({ method: "PATCH", path, body });
      return ok(handler({ method: "PATCH", path, body })) as ApiResponse<never>;
    },
    async delete(path: string) {
      calls.push({ method: "DELETE", path });
      return ok(handler({ method: "DELETE", path })) as ApiResponse<never>;
    },
  };
  return { client, calls };
}

function fakeSource(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "src_01J123",
    client_id: "cli_01J999",
    name: "WP plugin",
    source_type: "wp_plugin",
    status: "active",
    allowed_site_url: null,
    auth_mode: "hmac_v1",
    schema_version: "lead_event.v1",
    created_at: "2026-05-22T00:00:00Z",
    updated_at: "2026-05-22T00:00:00Z",
    ...over,
  };
}

describe("source tools", () => {
  it("list_sources forwards cursor + limit and wraps the envelope", async () => {
    const { client, calls } = buildClient(() => ({
      data: [fakeSource()],
      has_more: true,
      next_cursor: "cur_abc",
    }));
    const tools = createSourceTools(client);
    const result = await tools.list_sources!.handler({
      cursor: "cur_prev",
      limit: 25,
    });
    expect(calls[0]).toMatchObject({
      method: "GET",
      path: "/sources",
      query: { cursor: "cur_prev", limit: 25 },
    });
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        has_more: true,
        next_cursor: "cur_abc",
      }),
    );
    expect(result.content[0]!.text).toContain("Listed 1 source");
    expect(result.content[0]!.text).toContain("more available");
  });

  it("get_source hits /sources/{id}", async () => {
    const { client, calls } = buildClient(() => fakeSource());
    const tools = createSourceTools(client);
    const result = await tools.get_source!.handler({ id: "src_01J123" });
    expect(calls[0]?.path).toBe("/sources/src_01J123");
    expect(result.structuredContent).toMatchObject({ id: "src_01J123" });
  });

  it("create_source posts a body and surfaces the rotate-secret hint", async () => {
    const { client, calls } = buildClient(() =>
      fakeSource({ name: "Contact form" }),
    );
    const tools = createSourceTools(client);
    const result = await tools.create_source!.handler({
      name: "Contact form",
      source_type: "wp_plugin",
    });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/sources",
      body: { name: "Contact form", source_type: "wp_plugin" },
    });
    expect(result.content[0]!.text).toContain(
      "rotate_source_secret",
    );
  });

  it("update_source PATCHes with id removed from the body", async () => {
    const { client, calls } = buildClient(() =>
      fakeSource({ status: "paused" }),
    );
    const tools = createSourceTools(client);
    await tools.update_source!.handler({
      id: "src_01J123",
      status: "paused",
      name: "Renamed",
    });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/sources/src_01J123",
      body: { status: "paused", name: "Renamed" },
    });
    // The id field is in the URL, NOT in the body.
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.id).toBeUndefined();
  });

  it("pause_source POSTs to /sources/{id}/pause", async () => {
    const { client, calls } = buildClient(() => fakeSource({ status: "paused" }));
    const tools = createSourceTools(client);
    await tools.pause_source!.handler({ id: "src_01J123" });
    expect(calls[0]?.path).toBe("/sources/src_01J123/pause");
  });

  it("resume_source PATCHes status: active", async () => {
    const { client, calls } = buildClient(() => fakeSource({ status: "active" }));
    const tools = createSourceTools(client);
    await tools.resume_source!.handler({ id: "src_01J123" });
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/sources/src_01J123",
      body: { status: "active" },
    });
  });

  it("revoke_source POSTs and surfaces the irreversible warning", async () => {
    const { client, calls } = buildClient(() => fakeSource({ status: "revoked" }));
    const tools = createSourceTools(client);
    const result = await tools.revoke_source!.handler({ id: "src_01J123" });
    expect(calls[0]?.path).toBe("/sources/src_01J123/revoke");
    expect(result.content[0]!.text).toContain("REVOKED");
  });

  it("rotate_source_secret returns the single-shot reveal and warns the user", async () => {
    const { client, calls } = buildClient(() => ({
      key_id: "key_01J123",
      signing_secret: "AAAA-BBBB-CCCC",
      created_at: "2026-05-22T00:00:00Z",
    }));
    const tools = createSourceTools(client);
    const result = await tools.rotate_source_secret!.handler({
      id: "src_01J123",
    });
    expect(calls[0]?.path).toBe("/sources/src_01J123/rotate-secret");
    expect(result.structuredContent).toMatchObject({
      key_id: "key_01J123",
      signing_secret: "AAAA-BBBB-CCCC",
    });
    expect(result.content[0]!.text).toMatch(/cannot be recovered/i);
  });
});
