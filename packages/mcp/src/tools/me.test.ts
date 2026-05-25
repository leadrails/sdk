// Unit tests for the `whoami` tool. Verifies:
//   - GET /me is called (no body, no idempotency key).
//   - The Zod response schema is enforced (bad data → throws).
//   - Dual-emit shape: both `structuredContent` and a `content[0].text`
//     summary string are returned.
//   - The summary surfaces plan + events_read so an LLM doesn't need
//     to parse the JSON to make a routing decision.

import { describe, it, expect } from "vitest";
import { createMeTools } from "./me.js";
import type { ApiClient, ApiResponse } from "../lib/api-client.js";
import { ApiError } from "../lib/api-client.js";

/**
 * Build a partial-typed mock client. Each handler returns `unknown`
 * which is cast to `ApiResponse<never>` so the generic signature on
 * the real client compiles — the tool-level `parse()` validates the
 * body shape after the call, so wider typing inside the mock is fine.
 */
function mockClient(getImpl: () => unknown): ApiClient {
  const noop = async (): Promise<never> => {
    throw new Error("unexpected call");
  };
  return {
    baseUrl: "http://test/v1",
    async get(): Promise<ApiResponse<never>> {
      const body = await getImpl();
      return {
        status: 200,
        headers: new Headers(),
        body: body as never,
      };
    },
    post: noop,
    patch: noop,
    delete: noop,
  };
}

describe("whoami", () => {
  it("returns structuredContent + summary for a Pro plan workspace", async () => {
    const tools = createMeTools(
      mockClient(() => ({
        client_id: "cli_01J123",
        name: "Why Not Labs",
        plan: "pro",
        scopes: ["*"],
        rate_limit: {
          limit: 3000,
          period: 60,
          remaining: 2999,
          reset: 1700000060,
        },
        capabilities: {
          events_read: true,
          webhooks_outbound: false,
          agency_endpoints: false,
          fine_grained_scopes: false,
        },
        request_id: "req_01J123",
      })),
    );
    const whoami = tools.whoami!;
    const result = await whoami.handler({});
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        client_id: "cli_01J123",
        name: "Why Not Labs",
        plan: "pro",
        capabilities: expect.objectContaining({ events_read: true }),
      }),
    );
    expect(result.content).toHaveLength(1);
    const text = result.content[0]!.text;
    expect(text).toContain("cli_01J123");
    // The human-readable summary surfaces the workspace name so an LLM
    // doesn't have to read the JSON to greet the user by workspace.
    // Closes #67.
    expect(text).toContain("Why Not Labs");
    expect(text).toContain("pro");
    expect(text).toContain("Events read: yes");
    // The trailing JSON dump is present.
    expect(text).toContain('"client_id": "cli_01J123"');
  });

  it("surfaces events_read=no in the summary for Free / Starter plans", async () => {
    const tools = createMeTools(
      mockClient(() => ({
        client_id: "cli_01J123",
        name: "Starter Workspace",
        plan: "starter",
        scopes: ["*"],
        rate_limit: {
          limit: 600,
          period: 60,
          remaining: 600,
          reset: 1700000060,
        },
        capabilities: {
          events_read: false,
          webhooks_outbound: false,
          agency_endpoints: false,
          fine_grained_scopes: false,
        },
        request_id: "req_01J124",
      })),
    );
    const result = await tools.whoami!.handler({});
    expect(result.content[0]!.text).toContain("Events read: no");
  });

  it("throws when the wire response doesn't match meResponseSchema", async () => {
    const tools = createMeTools(
      mockClient(() => ({
        // Missing required fields → Zod rejects.
        client_id: "cli_01J123",
      })),
    );
    await expect(tools.whoami!.handler({})).rejects.toThrow();
  });

  it("propagates ApiError instances unchanged for the SDK wrapper to format", async () => {
    const tools = createMeTools(
      mockClient(() => {
        throw new ApiError({
          message: "GET /me failed: bad token",
          status: 401,
          body: { type: "about:blank", detail: "Bearer rejected" },
        });
      }),
    );
    await expect(tools.whoami!.handler({})).rejects.toBeInstanceOf(ApiError);
  });
});
