#!/usr/bin/env node
// Fails if any packages/*/package.json uses the `workspace:` protocol
// inside a published dependency field. JSR's publisher does NOT
// rewrite the workspace protocol (only pnpm does, and only on
// `pnpm publish`). Using `workspace:*` produces `missingConstraint`;
// using `workspace:^` / `workspace:~` either fails the same way or
// publishes a broken manifest. Use a literal version range
// (`^0.1.0`) or move the dep to `peerDependencies` only.
//
// See AGENTS.md → 'Cross-package dependencies and the JSR publish
// constraint' for the full reasoning.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PUBLISHED_FIELDS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

const files = execSync("git ls-files 'packages/*/package.json'", {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const violations = [];

for (const file of files) {
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  for (const field of PUBLISHED_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        violations.push({ file, field, name, spec });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("");
  console.error("  ERROR: 'workspace:' protocol found in a published dependency field.");
  console.error("  JSR does NOT rewrite the workspace protocol — only pnpm does,");
  console.error("  and only on `pnpm publish`. `jsr publish` reads package.json");
  console.error("  literally, so the published manifest will be broken or rejected.");
  console.error("");
  console.error("  Fix: use a literal range (e.g. '^0.1.0'), or move the dep to");
  console.error("  `peerDependencies` only if the consumer is expected to provide it.");
  console.error("");
  for (const v of violations) {
    console.error(`    ${v.file} → ${v.field}.${v.name} = "${v.spec}"`);
  }
  console.error("");
  console.error("  See AGENTS.md → 'Cross-package dependencies and the JSR publish constraint'.");
  console.error("");
  process.exit(1);
}
