# `@leadrails/mcp`

[![npm version](https://img.shields.io/npm/v/@leadrails/mcp.svg?style=flat-square)](https://www.npmjs.com/package/@leadrails/mcp)
[![npm downloads](https://img.shields.io/npm/dm/@leadrails/mcp.svg?style=flat-square)](https://www.npmjs.com/package/@leadrails/mcp)
[![license: MIT](https://img.shields.io/npm/l/@leadrails/mcp.svg?style=flat-square)](https://github.com/leadrails/sdk/blob/main/LICENSE)

[Model Context Protocol](https://modelcontextprotocol.io) server for [LeadRails](https://leadrails.dev/?ref=npm-mcp). Lets MCP-aware AI agents (Claude Desktop, Claude Code, Cursor, VS Code, Codex, Cline, Zed, Windsurf, …) read and manage your LeadRails workspace — sources, destinations, routes, events — through the public `/v1` REST API. Runs locally over stdio with a workspace API key; talks to `https://api.leadrails.dev/v1` like any third-party SDK (no admin shortcuts).

Requires Node.js 18+ (uses native WHATWG `fetch`).

## Install

### Quick install (one click)

<a href="https://cursor.com/install-mcp?name=leadrails&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBsZWFkcmFpbHMvbWNwIl0sImVudiI6eyJMRUFEUkFJTFNfQVBJX0tFWSI6Ijx5b3VyX2tleT4ifX0%3D"><img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor"></a>
<a href="https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522leadrails%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540leadrails%252Fmcp%2522%255D%252C%2522env%2522%253A%257B%2522LEADRAILS_API_KEY%2522%253A%2522%2524%257Binput%253Aleadrails_api_key%257D%2522%257D%252C%2522inputs%2522%253A%255B%257B%2522type%2522%253A%2522promptString%2522%252C%2522id%2522%253A%2522leadrails_api_key%2522%252C%2522description%2522%253A%2522LeadRails%2520API%2520key%2522%252C%2522password%2522%253Atrue%257D%255D%257D"><img src="https://img.shields.io/badge/VS_Code-Install-blue?style=flat-square&logo=visualstudiocode" alt="Install in VS Code"></a>
<a href="https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522leadrails%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540leadrails%252Fmcp%2522%255D%252C%2522env%2522%253A%257B%2522LEADRAILS_API_KEY%2522%253A%2522%2524%257Binput%253Aleadrails_api_key%257D%2522%257D%252C%2522inputs%2522%253A%255B%257B%2522type%2522%253A%2522promptString%2522%252C%2522id%2522%253A%2522leadrails_api_key%2522%252C%2522description%2522%253A%2522LeadRails%2520API%2520key%2522%252C%2522password%2522%253Atrue%257D%255D%257D"><img src="https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode" alt="Install in VS Code Insiders"></a>

The Cursor button drops a placeholder `<your_key>` into your config — replace it with a real key after the install dialog. The VS Code buttons prompt for the key on first run and store it in your secret store.

### Universal installer

[`add-mcp`](https://www.npmjs.com/package/add-mcp) auto-detects Claude Code, Claude Desktop, Cursor, VS Code, Codex, Cline, Copilot, Zed, Windsurf, OpenCode, and Continue, then writes the right config for each:

```bash
npx add-mcp @leadrails/mcp
```

You'll still need to set `LEADRAILS_API_KEY` afterward; the installer prints the exact path it edited.

### Per-client setup

<details>
<summary><strong>Claude Code (CLI)</strong></summary>

```bash
claude mcp add leadrails -e LEADRAILS_API_KEY=lr_live_xxx -- npx -y @leadrails/mcp
```

To scope to a single project, add `--scope project` (writes `.claude.json` in the project root instead of the user config).
</details>

<details>
<summary><strong>Claude Desktop (macOS / Windows / Linux)</strong></summary>

Edit the config file for your platform:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_xxx",
        "LEADRAILS_API_URL": "https://api.leadrails.dev/v1"
      }
    }
  }
}
```

Then fully quit Claude Desktop (cmd+Q on macOS, not just close the window) and reopen. The tools appear under `leadrails` in the tools menu.
</details>

<details>
<summary><strong>Cursor (manual)</strong></summary>

Edit `~/.cursor/mcp.json` (or `<project>/.cursor/mcp.json` for project-local scope):

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_xxx"
      }
    }
  }
}
```

Restart Cursor. Tools appear under `Settings → MCP`.
</details>

<details>
<summary><strong>VS Code (manual)</strong></summary>

Either edit your user `settings.json` and add an `mcp.servers` block, or create `.vscode/mcp.json` in your workspace:

```jsonc
{
  "servers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "${input:leadrails_api_key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "leadrails_api_key",
      "description": "LeadRails API key",
      "password": true
    }
  ]
}
```

VS Code prompts for the key on first start and caches it in the OS keychain.
</details>

<details>
<summary><strong>Codex CLI</strong></summary>

```bash
codex mcp add leadrails -e LEADRAILS_API_KEY=lr_live_xxx -- npx -y @leadrails/mcp
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.leadrails]
command = "npx"
args = ["-y", "@leadrails/mcp"]
env = { LEADRAILS_API_KEY = "lr_live_xxx" }
```
</details>

<details>
<summary><strong>Continue</strong></summary>

Add to `~/.continue/config.yaml`:

```yaml
mcpServers:
  - name: leadrails
    command: npx
    args:
      - -y
      - "@leadrails/mcp"
    env:
      LEADRAILS_API_KEY: lr_live_xxx
```
</details>

<details>
<summary><strong>Cline</strong></summary>

Edit `~/Documents/Cline/MCP/cline_mcp_settings.json` (or use the Cline `MCP Servers` panel → `Configure MCP Servers`):

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_xxx"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```
</details>

<details>
<summary><strong>Zed</strong></summary>

Add to your Zed `settings.json` under `context_servers`:

```json
{
  "context_servers": {
    "leadrails": {
      "command": {
        "path": "npx",
        "args": ["-y", "@leadrails/mcp"],
        "env": {
          "LEADRAILS_API_KEY": "lr_live_xxx"
        }
      }
    }
  }
}
```
</details>

<details>
<summary><strong>Windsurf</strong></summary>

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "leadrails": {
      "command": "npx",
      "args": ["-y", "@leadrails/mcp"],
      "env": {
        "LEADRAILS_API_KEY": "lr_live_xxx"
      }
    }
  }
}
```
</details>

## Get an API key

Visit [app.leadrails.dev/settings/api-keys](https://app.leadrails.dev/settings/api-keys), click **Create new key**, and set the scope + rate limit. Keys are workspace-scoped — one key authenticates exactly one workspace. Agency operators managing multiple workspaces hold one key per workspace.

Keys are shown once at creation. Treat them like passwords; rotate via the same panel if one leaks.

## Available tools

23 tools across five resource families. Every tool returns both a typed `structuredContent` object and a human-readable summary, so any MCP-spec-conforming client gets a useful response.

| Resource     | Tool                            | Maps to                                              |
| ------------ | ------------------------------- | ---------------------------------------------------- |
| Workspace    | `whoami`                        | `GET /v1/me`                                         |
| Sources      | `list_sources`                  | `GET /v1/sources`                                    |
|              | `get_source`                    | `GET /v1/sources/{id}`                               |
|              | `create_source`                 | `POST /v1/sources`                                   |
|              | `update_source`                 | `PATCH /v1/sources/{id}`                             |
|              | `pause_source`                  | `POST /v1/sources/{id}/pause`                        |
|              | `resume_source`                 | `PATCH /v1/sources/{id}` (`status: active`)          |
|              | `revoke_source`                 | `POST /v1/sources/{id}/revoke` (terminal)            |
|              | `rotate_source_secret`          | `POST /v1/sources/{id}/rotate-secret`                |
| Destinations | `list_destinations`             | `GET /v1/destinations`                               |
|              | `get_destination`               | `GET /v1/destinations/{id}`                          |
|              | `create_destination`            | `POST /v1/destinations`                              |
|              | `update_destination`            | `PATCH /v1/destinations/{id}`                        |
|              | `pause_destination`             | `POST /v1/destinations/{id}/pause`                   |
|              | `test_destination`              | `POST /v1/destinations/{id}/test`                    |
| Routes       | `list_routes`                   | `GET /v1/routes`                                     |
|              | `get_route`                     | `GET /v1/routes/{id}`                                |
|              | `create_route`                  | `POST /v1/routes`                                    |
|              | `update_route`                  | `PATCH /v1/routes/{id}`                              |
|              | `delete_route`                  | `DELETE /v1/routes/{id}` (soft delete)               |
| Events       | `query_events`                  | `GET /v1/events` (Pro+ plan)                         |
|              | `get_event`                     | `GET /v1/events/{id}` (Pro+ plan)                    |
|              | `get_delivery_jobs_for_event`   | `GET /v1/events/{id}/delivery-jobs` (Pro+ plan)      |

Ask your agent things like:

> "What's my LeadRails plan?" — invokes `whoami`
>
> "Create a Slack destination called 'New Leads' that posts to https://hooks.slack.com/…" — invokes `create_destination`
>
> "Wire source `src_01J…` to that new destination." — invokes `create_route`
>
> "Show me events from the last hour." — invokes `query_events` (Pro+)

The agent picks tools based on their descriptions; you don't need to name them.

## Environment variables

| Name                | Required | Default                          | Description                                                                                       |
| ------------------- | -------- | -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `LEADRAILS_API_KEY` | yes      | —                                | API key from your workspace. Generate at [app.leadrails.dev/settings/api-keys](https://app.leadrails.dev/settings/api-keys). Format: `lr_live_…` |
| `LEADRAILS_API_URL` | no       | `https://api.leadrails.dev/v1`   | Override the API base URL (e.g. for staging, self-hosted, or local dev).                          |

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

- **`LEADRAILS_API_KEY env var is required`** — verify your client config sets the env var. In Claude Desktop, after editing the config file you must fully quit the app (not just close the window) before the env var is picked up.
- **`LeadRails rejected the API key (401)`** — the key was found but is invalid, revoked, or malformed. Check that it starts with `lr_live_…` and that `LEADRAILS_API_URL` matches the environment the key was issued for.
- **`This endpoint requires a Pro plan or higher` (403)** — the `/v1/events` tools are gated to Pro / Agency / Scale plans. Upgrade at [app.leadrails.dev/settings/billing](https://app.leadrails.dev/settings/billing).
- **`LeadRails rate-limited this request (429)`** — per-key sustained quotas are 1 / 10 / 50 / 200 RPS for Free / Starter / Pro / Agency. The error includes a `Retry-After` hint.
- **Tool calls fail silently in Claude Desktop** — check `~/Library/Logs/Claude/mcp*.log` (macOS) or `%APPDATA%\Claude\logs\mcp*.log` (Windows).
- **`npx` re-downloads the package every run** — pin a version to use the npm cache: `npx -y @leadrails/mcp@0.1.1`. Or install globally: `pnpm add -g @leadrails/mcp`.

## Out of scope (v1)

- **Remote transport (Streamable HTTP)** — local stdio only.
- **MCP Resources / Prompts** — v1 ships tools only.
- **Polyglot servers (Python / Go)** — TypeScript-only.

## Links

- LeadRails: <https://leadrails.dev>
- Docs: <https://docs.leadrails.dev>
- Issues: <https://github.com/leadrails/sdk/issues>
- npm: <https://www.npmjs.com/package/@leadrails/mcp>
- MCP spec: <https://modelcontextprotocol.io>

## License

MIT
