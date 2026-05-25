// Server factory for `@leadrails/mcp`.
//
// `createServer(...)` returns an `McpServer` instance with all 23 tools
// registered (whoami + 8 source + 6 destination + 5 route + 3 event).
// The factory does NOT attach a transport — that's the caller's job
// (bin/leadrails-mcp.js attaches `StdioServerTransport`; future code
// paths might attach Streamable-HTTP for the v2 remote server). This
// keeps the unit tests trivial: instantiate the server, hand it a
// mock client, assert the tool handlers behave correctly.
//
// v1 invariants honored here:
//
//   - SSOT: every tool consumes Zod schemas from the vendored
//     `./schemas/` module (mirrors `@leadrails/schema/public` from the
//     LeadRails monorepo).
//   - The MCP server is a normal /v1 client — no admin shortcuts, no
//     direct D1 access. The `ApiClient` only knows about the /v1
//     surface.
//   - Tool names are snake_case verb-first, no `leadrails_` prefix
//     (Claude namespaces by server name).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createApiClient,
  type ApiClient,
  type ApiClientOptions,
} from "./lib/api-client.js";
import { registerDestinationTools } from "./tools/destinations.js";
import { registerEventTools } from "./tools/events.js";
import { registerMeTools } from "./tools/me.js";
import { registerRouteTools } from "./tools/routes.js";
import { registerSourceTools } from "./tools/sources.js";

/**
 * Options accepted by `createServer`. Mirrors `ApiClientOptions` plus
 * lets callers pre-build a client (tests inject a mock; production
 * uses env-derived options).
 */
export interface ServerOptions {
  apiKey?: string | undefined;
  apiUrl?: string | undefined;
  /**
   * Pre-built API client. If supplied, `apiKey` + `apiUrl` are
   * ignored. Tests use this to inject a fetch mock.
   */
  client?: ApiClient | undefined;
  /** Override server name (defaults to "@leadrails/mcp"). */
  serverName?: string | undefined;
  /** Override server version (defaults to package.json version). */
  serverVersion?: string | undefined;
}

/**
 * Build a fully-registered MCP server. Caller attaches the transport
 * separately:
 *
 *   const server = createServer({ apiKey: process.env.LEADRAILS_API_KEY });
 *   await server.connect(new StdioServerTransport());
 */
export function createServer(options: ServerOptions = {}): McpServer {
  const client =
    options.client ??
    createApiClient(toApiClientOptions(options));

  const server = new McpServer({
    name: options.serverName ?? "@leadrails/mcp",
    version: options.serverVersion ?? PACKAGE_VERSION,
  });

  registerMeTools(server, client);
  registerSourceTools(server, client);
  registerDestinationTools(server, client);
  registerRouteTools(server, client);
  registerEventTools(server, client);

  return server;
}

/**
 * Convenience for tests that just want to inspect the registered
 * tools without poking at the server's private fields. Re-exports
 * the names tools register so docs / probes can iterate over them.
 */
export const REGISTERED_TOOL_NAMES = [
  "whoami",
  "list_sources",
  "get_source",
  "create_source",
  "update_source",
  "pause_source",
  "resume_source",
  "revoke_source",
  "rotate_source_secret",
  "list_destinations",
  "get_destination",
  "create_destination",
  "update_destination",
  "pause_destination",
  "test_destination",
  "list_routes",
  "get_route",
  "create_route",
  "update_route",
  "delete_route",
  "query_events",
  "get_event",
  "get_delivery_jobs_for_event",
] as const;

export type RegisteredToolName = (typeof REGISTERED_TOOL_NAMES)[number];

/**
 * Package version. Kept as a constant so build-time tools (bundlers,
 * the published `dist/index.js`) can statically replace it. Bumped
 * alongside `package.json`'s `version` field on every release.
 */
const PACKAGE_VERSION = "0.1.1";

function toApiClientOptions(options: ServerOptions): ApiClientOptions {
  if (!options.apiKey) {
    throw new Error(
      "LeadRails MCP: missing API key. Set LEADRAILS_API_KEY or pass " +
        "{ apiKey } to createServer().",
    );
  }
  const out: ApiClientOptions = { apiKey: options.apiKey };
  if (options.apiUrl !== undefined) {
    out.apiUrl = options.apiUrl;
  }
  return out;
}
