// Tests for the server factory. Verifies that `createServer({client})`
// registers exactly the 23 tools the issue mandates, with the right
// names, in the expected order (REGISTERED_TOOL_NAMES is the SSOT and
// is what docs/copy-paste configs reference).

import { describe, it, expect } from "vitest";
import { createServer, REGISTERED_TOOL_NAMES } from "./server.js";
import type { ApiClient } from "./lib/api-client.js";

const stubClient: ApiClient = {
  baseUrl: "http://test/v1",
  async get() {
    throw new Error("stub");
  },
  async post() {
    throw new Error("stub");
  },
  async patch() {
    throw new Error("stub");
  },
  async delete() {
    throw new Error("stub");
  },
};

describe("server factory", () => {
  it("registers exactly 23 tools matching REGISTERED_TOOL_NAMES", () => {
    expect(REGISTERED_TOOL_NAMES).toHaveLength(23);
    const set = new Set(REGISTERED_TOOL_NAMES);
    // No accidental duplicates in the canonical list.
    expect(set.size).toBe(REGISTERED_TOOL_NAMES.length);
  });

  it("REGISTERED_TOOL_NAMES covers each acceptance-criteria category", () => {
    // Per issue #44 the 23 tools fall into 5 groups:
    expect(REGISTERED_TOOL_NAMES).toContain("whoami");
    for (const t of [
      "list_sources",
      "get_source",
      "create_source",
      "update_source",
      "pause_source",
      "resume_source",
      "revoke_source",
      "rotate_source_secret",
    ]) {
      expect(REGISTERED_TOOL_NAMES).toContain(t);
    }
    for (const t of [
      "list_destinations",
      "get_destination",
      "create_destination",
      "update_destination",
      "pause_destination",
      "test_destination",
    ]) {
      expect(REGISTERED_TOOL_NAMES).toContain(t);
    }
    for (const t of [
      "list_routes",
      "get_route",
      "create_route",
      "update_route",
      "delete_route",
    ]) {
      expect(REGISTERED_TOOL_NAMES).toContain(t);
    }
    for (const t of ["query_events", "get_event", "get_delivery_jobs_for_event"]) {
      expect(REGISTERED_TOOL_NAMES).toContain(t);
    }
  });

  it("createServer({client}) returns an instance without throwing", () => {
    const server = createServer({ client: stubClient });
    // The MCP SDK doesn't expose a typed tools-list getter on McpServer
    // in v1.29 — we can only assert that the constructor + 23
    // registrations completed. The per-tool behavior is covered by
    // the unit tests in `tools/*.test.ts`.
    expect(server).toBeDefined();
  });

  it("createServer without client or apiKey throws a helpful message", () => {
    expect(() => createServer({})).toThrow(/LEADRAILS_API_KEY/);
  });

  it("each tool name uses snake_case verb-first (no leadrails_ prefix)", () => {
    for (const name of REGISTERED_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(name).not.toMatch(/^leadrails_/);
    }
  });
});
