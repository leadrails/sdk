# `@leadrails/mcp` — agent guide

You're inside the source tree of `@leadrails/mcp`. This file orients
you. The repo-root [`AGENTS.md`](../../AGENTS.md) covers cross-package
publish rules (workspace-protocol bans, JSR constraints) and the SSOT
discipline that applies repo-wide; read that first if you haven't yet.

## What this package is

A local MCP server, distributed as an npm binary, that wraps the
LeadRails `/v1` public REST API as 23 MCP tools spanning workspace
discovery + sources + destinations + routes + events.

- **Transport**: stdio only (v1). The binary at `bin/leadrails-mcp.js`
  spawns when a client invokes `npx -y @leadrails/mcp`, attaches a
  `StdioServerTransport`, and blocks on the MCP loop until the parent
  closes stdin.
- **Client surface**: native `fetch` (Node 18+) wrapping the public
  `/v1` API at `https://api.leadrails.dev/v1`. Bearer auth via
  `LEADRAILS_API_KEY`, RFC-9457 `application/problem+json` error
  envelope, mandatory `Idempotency-Key` UUID v4 on every mutating
  verb, paged-cursor pattern on list endpoints.
- **No admin shortcuts**. This is a normal `/v1` client. Same surface a
  third-party SDK would consume. No direct D1 access, no privileged
  routes, no rate-limit bypass.

## SSOT files

- **`src/schemas/`** — vendored wire-contract Zod schemas. Mirrors the
  monorepo's `packages/schema/src/public/` (the canonical source of
  truth lives there). Do NOT edit unless you're syncing with a new
  monorepo release.
- **`src/tools/`** — one file per resource family
  (`me`, `sources`, `destinations`, `routes`, `events`). Each exports
  a `create<Entity>Tools(client)` factory returning a
  `Record<name, ToolDefinition>`, and a `register<Entity>Tools(server, client)`
  helper that iterates the record and calls `server.registerTool(...)`.
  The factory return type makes the tools testable without
  instantiating an `McpServer`.
- **`src/lib/api-client.ts`** — the fetch wrapper. Bearer auth,
  per-mutation idempotency key, problem-document parsing,
  `ApiError` with `isPlanRequired` / `isRateLimited` helpers.
- **`src/lib/dual-emit.ts`** — wraps every tool result as both
  `structuredContent` (typed object) and a human-readable text summary.
- **`src/lib/register.ts`** — shared `registerTool` helper that
  adapts the factory record shape to the MCP SDK's `registerTool` API.
- **`src/server.ts`** — server bootstrap (`createServer`) plus the
  `REGISTERED_TOOL_NAMES` array. Keep that array in sync when you add
  or rename tools — README's tool table is derived from the same
  list.
- **`src/index.ts`** — public entry point. Exports `createServer`,
  `main()`, `ApiError`, `createApiClient`, types.
- **`bin/leadrails-mcp.js`** — CLI binstub. Calls `main()`.
- **`server.json`** — MCP Registry manifest. Schema:
  `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`.
  Bumped alongside `package.json`'s `version` on every release;
  included in the npm tarball so the registry can pick it up.

## How to add a new tool

1. **Schema first.** Add the wire schema in `src/schemas/<entity>.ts`
   (vendor from the monorepo's `packages/schema/src/public/` if it's
   for a new entity; otherwise extend the existing entity module).
   Re-export from `src/schemas/index.ts`.
2. **Tool factory.** Implement the tool in `src/tools/<entity>.ts`
   inside the existing `create<Entity>Tools` factory. Follow the
   established pattern: `title`, `description`, `inputSchema`,
   `outputSchema`, `handler`. Use `successResult` / `listResult` /
   `errorResult` from `lib/dual-emit.ts` for the dual-emit envelope.
3. **Register.** Add the tool name to `REGISTERED_TOOL_NAMES` in
   `src/server.ts`. The `register<Entity>Tools` helper picks it up
   automatically from the factory record.
4. **Test.** Add a vitest case next to the source as
   `src/tools/<entity>.test.ts`. Use the existing mock-client pattern.
5. **Docs.** Add a row to README's tool table and update the
   `Resource` group count in the intro paragraph if needed.

## How to release

The repo's GitHub Actions publish workflow polls npm + JSR for new
versions across `packages/*/package.json` (and `packages/*/jsr.json`)
on every push to `main`. To release:

1. Bump **all three** version fields in one commit:
   - `packages/mcp/package.json` → `"version"`
   - `packages/mcp/jsr.json`     → `"version"`
   - `packages/mcp/server.json`  → `"version"` AND `"packages[0].version"`
2. Bump the `PACKAGE_VERSION` constant in `src/server.ts` to match
   (the MCP server advertises this in its handshake).
3. Push to `main`. The publish workflow detects the new version on
   npm, runs the build, runs `pnpm pack`, and publishes with provenance
   attestation. JSR publish runs in the same workflow.

Manual `npm publish` / `pnpm publish` from a laptop is the
break-glass exception, not the default — the OIDC-attested workflow
is the only path that produces a trustable provenance badge.

## Test + build

From `/Users/austin/Documents/claude/leadrails-sdk` (repo root):

```bash
pnpm install                       # bootstrap (lockfile pinned)
pnpm typecheck                     # tsc --noEmit, repo-wide
pnpm test                          # vitest run, repo-wide
pnpm check:workspace-deps          # blocks workspace: protocol in published deps
pnpm -r build                      # builds sdk + next + mcp
pnpm --filter @leadrails/mcp build # mcp-only build
```

Smoke-test the built binary in isolation:

```bash
cd packages/mcp
pnpm pack --pack-destination /tmp
tar -tzf /tmp/leadrails-mcp-*.tgz | sort
# Verify: dist/, README.md, LICENSE, package.json, server.json present
```

## Conventions

- **`pnpm`** not `npm`.
- **`verbatimModuleSyntax: true`** — type-only imports must use
  `import type` syntax.
- **`NodeNext` module resolution** — relative imports in source need
  `.js` extensions (TS emits `.js` for the import map).
- **Tests next to source** as `<file>.test.ts`. Vitest globs them
  from the repo root.
- **No `Co-Authored-By` footers** in commits. Same for PR bodies.
- **No `axios`** — bare `fetch` plus the wrapper in
  `lib/api-client.ts`.

## What this package does NOT do

- It does NOT have admin shortcuts. Every tool calls `/v1` with the
  user's workspace API key — same surface as any third-party SDK.
- It does NOT depend on the private LeadRails monorepo. Schemas are
  vendored under `src/schemas/`; the only runtime deps are
  `@modelcontextprotocol/sdk` and `zod`.
- It does NOT cache anything. Every tool call is a fresh `/v1`
  request. The rate-limit budget the user sees is the real budget.
- It does NOT ship Resources or Prompts (MCP-spec primitives) — tools
  only in v1.

## Where the `/v1` API lives

The `/v1` API surface is implemented in the private
`why-not-labs/leadrails` monorepo at
`apps/admin-api-worker/src/routes/v1/`. The public OpenAPI 3.1 spec
is at <https://api.leadrails.dev/v1/openapi.json> and rendered at
<https://docs.leadrails.dev/>.

This MCP server does NOT talk to the monorepo directly — only to the
public API. If you find yourself wanting to add a tool that needs an
unpublished endpoint, the right move is to ship that endpoint in the
monorepo first (with OpenAPI docs + tests), then add the MCP tool here.
