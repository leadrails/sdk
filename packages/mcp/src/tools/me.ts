// `whoami` tool — wraps `GET /v1/me`.
//
// `/v1/me` is THE discovery surface: it returns the
// workspace id, plan, scopes, rate-limit snapshot, and the
// `capabilities` flag map. Agents call this on cold start to learn
// which other tools will work — for example, `query_events` is only
// usable when `capabilities.events_read === true` (Pro+).
//
// `me` exports two factory functions:
//
//   - `createMeTools(client)`  — returns a Record<name, ToolDefinition>
//                                so unit tests can call the handlers
//                                directly without instantiating an
//                                `McpServer`.
//   - `registerMeTools(server, client)` — iterates the record and
//                                calls `server.registerTool(...)`.
//
// Every other tool file follows the same shape.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { meResponseSchema, type MeResponse } from "../schemas/index.js";
import type { ApiClient } from "../lib/api-client.js";
import { successResult } from "../lib/dual-emit.js";
import { registerTool, type ToolDefinition } from "../lib/register.js";

export function createMeTools(
  client: ApiClient,
): Record<string, ToolDefinition<Record<string, never>, typeof meResponseSchema.shape>> {
  return {
    whoami: {
      title: "Who am I (current API key + workspace)",
      description:
        "Returns the workspace id, plan, scopes, rate-limit budget, and " +
        "capability flags for the LEADRAILS_API_KEY this MCP server is " +
        "configured with. Call this first when starting a session so other " +
        "tools can branch on capabilities (e.g. events_read for /v1/events).",
      inputSchema: {},
      outputSchema: meResponseSchema.shape,
      handler: async () => {
        const res = await client.get<MeResponse>("/me");
        const parsed = meResponseSchema.parse(res.body);
        // Workspace name is the human-friendly anchor; we keep the
        // opaque client_id in parentheses so log-grep / support flows
        // still have the ULID to copy. Closes #67.
        const summary =
          `Authenticated as workspace ${JSON.stringify(parsed.name)} ` +
          `(${parsed.client_id}) on the ${parsed.plan} plan. ` +
          `Events read: ${parsed.capabilities.events_read ? "yes" : "no (Pro+ required)"}. ` +
          `Scopes: ${parsed.scopes.join(", ") || "(none)"}.`;
        return successResult(summary, parsed);
      },
    },
  };
}

export function registerMeTools(server: McpServer, client: ApiClient): void {
  for (const [name, def] of Object.entries(createMeTools(client))) {
    registerTool(server, name, def);
  }
}
