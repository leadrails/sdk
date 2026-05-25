# `@leadrails/mcp`

[Model Context Protocol](https://modelcontextprotocol.io) server for [LeadRails](https://leadrails.dev/?ref=npm-mcp). Lets MCP-aware AI agents (Claude Desktop, Claude Code, Cursor, …) read and manage your LeadRails workspace — sources, destinations, routes, events — through the public REST API.

## Install

Most users point their MCP client straight at the binary via `npx` — no install step needed. To install globally:

```bash
pnpm add -g @leadrails/mcp
npm  install -g @leadrails/mcp
```

Requires Node.js 18+ (uses native WHATWG `fetch`).

## Env vars

| Variable             | Required | Default                          | Description                                                                                       |
| -------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LEADRAILS_API_KEY`  | yes      | —                                | API key from your workspace. Generate at <https://app.leadrails.dev/settings/api-keys>. Format: `lr_live_…` |
| `LEADRAILS_API_URL`  | no       | `https://api.leadrails.dev/v1`   | Override the API base URL (e.g. for staging, self-hosted, or local dev).                          |

The key is workspace-scoped: one key authenticates exactly one workspace. Agency operators managing multiple workspaces hold one key per workspace.

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_your_key_here"
      }
    }
  }
}
```

Then fully restart Claude Desktop (cmd+Q on macOS, not just close the window). The tools appear in the tools menu under `leadrails`.

## Claude Code

Edit `~/.claude.json` (or `.claude.json` in your project root):

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_your_key_here"
      }
    }
  }
}
```

## Cursor

Edit `~/.cursor/mcp.json` — same shape as the Claude examples.

## Available tools

23 tools across 5 resource families. Every tool returns both `structuredContent` (typed object) and a human-readable summary so any MCP-spec-conforming client gets a useful response.

| Resource     | Tools                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery    | `whoami`                                                                                                                               |
| Sources      | `list_sources`, `get_source`, `create_source`, `update_source`, `pause_source`, `resume_source`, `revoke_source`, `rotate_source_secret` |
| Destinations | `list_destinations`, `get_destination`, `create_destination`, `update_destination`, `pause_destination`, `test_destination`            |
| Routes       | `list_routes`, `get_route`, `create_route`, `update_route`, `delete_route`                                                             |
| Events       | `query_events`, `get_event`, `get_delivery_jobs_for_event` (Pro+ plan required)                                                        |

Ask your agent things like:

> "What's my LeadRails plan?" — invokes `whoami`
>
> "Create a Slack destination called 'New Leads' that posts to https://hooks.slack.com/…" — invokes `create_destination`
>
> "Wire source `src_01J…` to that new destination." — invokes `create_route`
>
> "Show me events from the last hour." — invokes `query_events` (Pro+)

The agent picks tools based on their descriptions; you don't have to name them.

## Programmatic usage

If you want to embed the server in your own process:

```ts
import { createServer } from "@leadrails/mcp/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = createServer({
  apiKey: process.env.LEADRAILS_API_KEY!,
  apiUrl: process.env.LEADRAILS_API_URL,
});
await server.connect(new StdioServerTransport());
```

For tests, inject a mock client:

```ts
import { createServer } from "@leadrails/mcp/server";
import type { ApiClient } from "@leadrails/mcp";

const mockClient: ApiClient = {
  baseUrl: "http://test",
  async get() { return { body: {}, status: 200, headers: new Headers() }; },
  async post() { return { body: {}, status: 200, headers: new Headers() }; },
  async patch() { return { body: {}, status: 200, headers: new Headers() }; },
  async delete() { return { body: {}, status: 200, headers: new Headers() }; },
};

const server = createServer({ client: mockClient });
```

## Troubleshooting

- **`LEADRAILS_API_KEY env var is required`** — verify your client config sets the env var. In Claude Desktop, after editing the config file you must fully restart the app.
- **`LeadRails rejected the API key (401)`** — the key was found but is invalid/revoked/malformed. Check that it starts with `lr_live_…` and that you're pointing at the right environment (`LEADRAILS_API_URL` matches the workspace the key was issued for).
- **`This endpoint requires a Pro plan or higher`** — the events tools are gated to Pro / Agency / Scale plans.
- **`LeadRails rate-limited this request (429)`** — per-key sustained quotas are 1 / 10 / 50 / 200 RPS for Free / Starter / Pro / Agency. The error includes a `Retry-After` hint.
- **Tool calls fail silently in Claude Desktop** — check `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs\mcp*.log` (Windows).

## Out of scope (v1)

- **Remote transport (Streamable HTTP)** — local stdio only.
- **Resources / Prompts** — v1 ships tools only.
- **Polyglot servers (Python / Go)** — TypeScript-only.

## License

MIT
