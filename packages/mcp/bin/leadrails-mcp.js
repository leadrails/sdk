#!/usr/bin/env node
// CLI entrypoint for the `@leadrails/mcp` MCP server.
//
// Resolves the package's main module (which exports `main()`) and
// invokes it. Errors are printed to stderr with a non-zero exit code
// so the parent process (Claude Desktop, Claude Code, Cursor) can show
// the user a useful "configuration broke" message instead of a silent
// failure.
//
// Published distribution:
//   - This file lives at `dist/bin/leadrails-mcp.js` after `pnpm build`.
//   - The `publishConfig.bin` field in `package.json` points there.
//   - It imports `../index.js`, i.e. the built `dist/index.js`.
//
// Local development:
//   - The same source ships at `bin/leadrails-mcp.js` for parity.
//   - Local invocation goes through tsx-flavored runners (or the build
//     output); we don't directly `node bin/leadrails-mcp.js` because
//     `../src/index.js` doesn't exist until you build.

import { main } from "../index.js";

main().catch((err) => {
  process.stderr.write(`LeadRails MCP fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
