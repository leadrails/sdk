#!/usr/bin/env node
// Copy `bin/leadrails-mcp.js` to `dist/bin/leadrails-mcp.js` after the
// TypeScript build emits `dist/index.js` + friends. The published
// package layout per `package.json` publishConfig is:
//
//   dist/
//     index.js
//     server.js
//     lib/*.js
//     tools/*.js
//     bin/
//       leadrails-mcp.js   <- this file, copied verbatim
//
// We don't use TS for the bin shim because it's a one-line `import +
// main().catch()` — running it through tsc adds .js.map files and a
// declarations file for no benefit. Plain copy keeps the published
// artifact diff-friendly.

import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const pkgRoot = join(__dirname, "..");
const src = join(pkgRoot, "bin", "leadrails-mcp.js");
const dest = join(pkgRoot, "dist", "bin", "leadrails-mcp.js");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);

// chmod +x so the published file is executable on POSIX. npm respects
// the bit on publish; without it the binstub won't run.
try {
  const { chmodSync } = await import("node:fs");
  chmodSync(dest, 0o755);
} catch {
  // best-effort; Windows ignores the bit anyway.
}

console.log(`copied ${src} → ${dest}`);
