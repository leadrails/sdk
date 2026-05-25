// Local-dev shim. Run via `pnpm dev` (uses tsx). Mirrors what the
// published `bin/leadrails-mcp.js` does — calls `main()` and forwards
// any thrown error to stderr with a non-zero exit code. Lives in
// `src/` so it shares tsconfig + path resolution with the rest of the
// package; the published artifact ships only `bin/leadrails-mcp.js`,
// not this shim.

import { main } from "./index.js";

main().catch((err) => {
  process.stderr.write(`LeadRails MCP fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
