#!/usr/bin/env node
// Pack-and-load smoke test for @leadrails/sdk.
//
// Builds the SDK → packs it into a tarball → installs the tarball
// into a clean tmpdir → loads the package in plain Node ESM and
// exercises the documented API surface.
//
// This is the gate that would have caught the 0.1.0 extension-less
// import bug. Any future regression in:
//   - extension correctness (Node ESM strict resolution)
//   - the package.json exports map
//   - the `files` field (something we ship excludes a required file)
//   - the publishConfig (the published exports differ from dev exports)
// will fail this script. See AGENTS.md → "README-as-test-contract".

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const sdkDir = join(repoRoot, "packages/sdk");

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

// 1. Build the SDK (in case the dev hasn't already).
log("building @leadrails/sdk...");
run("pnpm --filter @leadrails/sdk build", { cwd: repoRoot });

// 2. Pack into a tarball. pnpm pack writes to the package dir and
//    prints the (relative) filename to stdout. We resolve it to an
//    absolute path so the subsequent install from tmpdir works.
log("packing @leadrails/sdk...");
const packOutput = run("pnpm pack", { cwd: sdkDir }).trim();
const tarballName = packOutput.split("\n").map((s) => s.trim()).filter(Boolean).pop();
if (!tarballName || !tarballName.endsWith(".tgz")) {
  throw new Error(`Could not locate tarball in pnpm pack output:\n${packOutput}`);
}
const tarballPath = join(sdkDir, tarballName);
log(`tarball: ${tarballPath}`);

// 3. Spin up a clean tmpdir with type:module so Node treats .mjs/.js
//    inside as ESM.
const tmp = mkdtempSync(join(tmpdir(), "leadrails-sdk-smoke-"));
log(`tmpdir: ${tmp}`);

try {
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({ name: "smoke", version: "0.0.0", type: "module", private: true }, null, 2),
  );

  // 4. Install the tarball using npm (avoids any pnpm symlink magic —
  //    we want to validate the artifact as a vanilla consumer would see it).
  log("installing tarball with npm...");
  run(`npm install --silent --no-audit --no-fund "${tarballPath}"`, { cwd: tmp });

  // 5. Write a smoke script that exercises the documented API.
  const smokeScript = `
import * as sdk from "@leadrails/sdk";

const required = [
  "createClient",
  "sendLeadEvent",
  "leadEvent",
  "LeadRailsError",
  "LeadRailsApiError",
  "LeadRailsAuthError",
  "LeadRailsConfigError",
];

for (const name of required) {
  if (!(name in sdk)) {
    console.error(\`MISSING EXPORT: \${name}\`);
    process.exit(1);
  }
}
console.log("[smoke] all documented exports are present");

// Construct a client with credentials so the required-field guards
// don't trip. We do NOT call .send() — that would attempt a real
// network request; the smoke is about loadability, not E2E.
const client = sdk.createClient({
  clientId: "cli_smoke",
  sourceId: "src_smoke",
  keyId: "key_smoke",
  signingSecret: "smoke-test-secret-not-real",
});
if (typeof client.send !== "function") {
  console.error("createClient() did not return a client with a .send method");
  process.exit(1);
}
console.log("[smoke] createClient() returned a usable client");

// Exercise the leadEvent factory (pure function, no I/O).
const event = sdk.leadEvent({
  source: { source_system: "smoke" },
  lead: { email: "smoke@example.com" },
});
if (event.schema_version !== "lead_event.v1") {
  console.error("leadEvent() returned wrong schema_version:", event.schema_version);
  process.exit(1);
}
console.log("[smoke] leadEvent() produced a valid event");
console.log("[smoke] PASS");
`;
  writeFileSync(join(tmp, "smoke.mjs"), smokeScript);

  // 6. Run it. Inherit stdio so the smoke's output goes straight to
  //    the user.
  log("running smoke in plain Node ESM...");
  execSync("node smoke.mjs", { cwd: tmp, stdio: "inherit" });

  log("smoke test PASSED");
} finally {
  // 7. Always clean up the tmpdir, even on failure.
  rmSync(tmp, { recursive: true, force: true });
  // Also remove the tarball — pnpm pack leaves it in the package dir.
  for (const f of readdirSync(sdkDir)) {
    if (f.endsWith(".tgz")) rmSync(join(sdkDir, f), { force: true });
  }
}
