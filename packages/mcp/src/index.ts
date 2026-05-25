// `@leadrails/mcp` — public package surface.
//
// Two consumer paths:
//
//   1. `npx @leadrails/mcp` (or installed binary): runs `bin/leadrails-mcp.js`
//      which calls `main()` below. Wires `StdioServerTransport`, reads
//      `LEADRAILS_API_KEY` + `LEADRAILS_API_URL` from env, and blocks
//      on the MCP loop.
//
//   2. Programmatic embedding (uncommon — most MCP clients spawn the
//      binary): `import { createServer } from "@leadrails/mcp"` returns
//      an unattached `McpServer`. Attach your own transport.
//
// The default export is `main()` so a wrapper script can do
// `await (await import("@leadrails/mcp")).default()` if it ever needs to.

import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

export { createServer, REGISTERED_TOOL_NAMES } from "./server.js";
export type { RegisteredToolName, ServerOptions } from "./server.js";
export { ApiError, createApiClient, DEFAULT_API_URL } from "./lib/api-client.js";
export type { ApiClient, ApiClientOptions } from "./lib/api-client.js";

/**
 * CLI entry point. Reads env vars, builds the server, attaches stdio.
 *
 * Returns the connected server so unit tests can call `main()` with
 * env vars set and assert it doesn't throw. Production code calls
 * this and process.exit follows when the parent closes stdin.
 */
export async function main(): Promise<void> {
  const apiKey = process.env["LEADRAILS_API_KEY"];
  const apiUrl = process.env["LEADRAILS_API_URL"];

  if (!apiKey) {
    process.stderr.write(
      "LeadRails MCP: LEADRAILS_API_KEY env var is required.\n" +
        "Generate a key at https://app.leadrails.dev/settings/api-keys\n" +
        "Then export it before launching the server:\n" +
        "  export LEADRAILS_API_KEY=lr_live_...\n",
    );
    process.exit(1);
  }

  const serverOptions: { apiKey: string; apiUrl?: string } = { apiKey };
  if (apiUrl) {
    serverOptions.apiUrl = apiUrl;
  }
  const server = createServer(serverOptions);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export default main;
