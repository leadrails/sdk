# leadrails-sdk — contributor notes

This repo publishes two packages to npm AND to JSR:

| Package | Path |
|---|---|
| `@leadrails/sdk` | `packages/sdk` |
| `@leadrails/next` | `packages/next` (depends on `@leadrails/sdk`) |

User-facing docs live in the per-package READMEs and the website. This
file is the rules an AI agent or new contributor needs to know to avoid
breaking the publish flow.

## Cross-package dependencies and the JSR publish constraint

**Never put a workspace package in `dependencies` if it can live in
`peerDependencies` alone.** When you must, use a literal version
range (`^0.1.0`), NOT the `workspace:` protocol.

### Why

JSR's publisher (`jsr publish` / the JSR web flow) reads
`dependencies` from `package.json` and forwards each cross-package
reference into the published manifest as an `npm:` specifier. Every
specifier must carry an explicit version constraint or the publish
is rejected with:

```
missingConstraint: specifier 'npm:@leadrails/sdk' is missing a version constraint
```

The `workspace:` protocol is **a pnpm convention, not a JSR one**.
`pnpm publish` rewrites `workspace:^` → `^0.1.0` at publish time;
`jsr publish` does NOT — it reads `package.json` literally. See
[denoland/deno#24612](https://github.com/denoland/deno/issues/24612)
and [jsr-io/jsr#448](https://github.com/jsr-io/jsr/issues/448).

| Source in `dependencies` | What `jsr publish` sees | Outcome |
|---|---|---|
| `workspace:*` | literal `workspace:*`, or `*` after partial resolve | REJECTED — `missingConstraint` |
| `workspace:^` | literal `workspace:^` — JSR doesn't rewrite | REJECTED or produces a broken manifest |
| `workspace:~` | same as above | same as above |
| `^0.1.0` (literal) | `^0.1.0` | ACCEPTED. pnpm still links the local workspace copy because the version satisfies the range. |
| (absent, listed only in `peerDependencies`) | nothing — JSR resolves the import via the peer entry | ACCEPTED (preferred for adapter packages) |

### Preferred pattern

For **adapter packages** (e.g. `@leadrails/next` depends on
`@leadrails/sdk`): list the cross-package dep in `peerDependencies`
ONLY. Consumers install the SDK; the adapter doesn't bundle a copy.

For **transitive runtime deps** that aren't peers (rare in this
repo — `server-only` is one): list with a literal range in
`dependencies`. Bump the range manually when the dep majors.

### Where this rule applies

Every `dependencies` / `peerDependencies` / `optionalDependencies`
entry in `packages/*/package.json` that references another package in
this workspace.

`devDependencies` are not published, so `workspace:*` there is fine.

### Enforcement

Two layers:

1. **CI** (`.github/workflows/ci.yml`) runs `pnpm check:workspace-deps`
   on every push and PR. The workflow fails the build if any published
   dep field has `workspace:*`. This is the real gate — CI cannot be
   bypassed.
2. **lefthook** pre-push hook runs the same check locally so you find
   out before pushing. Installed automatically by the root `prepare`
   script on `pnpm install`. Can be bypassed with `git push
   --no-verify`, but CI will still catch it.

The check itself is [scripts/check-workspace-deps.mjs](scripts/check-workspace-deps.mjs).
It scans `packages/*/package.json` and only flags
`dependencies` / `peerDependencies` / `optionalDependencies` —
`devDependencies` can use `workspace:*` freely (they're not published).

## Publishing flow (current)

1. Bump the version in `packages/<pkg>/package.json` AND
   `packages/<pkg>/jsr.json` (the two must agree).
2. `pnpm -r build` from the repo root — produces the `dist/` artifacts
   that npm consumers ship from (`publishConfig.main` / `.types`).
3. npm: `cd packages/<pkg> && pnpm publish --access public`.
4. JSR: `cd packages/<pkg> && pnpm dlx jsr publish` (or use the JSR
   web flow that the OAuth approval page provides).
5. Publish `@leadrails/sdk` BEFORE `@leadrails/next`. Otherwise
   `@leadrails/next`'s pinned `^0.1.0` peer-dep range resolves to a
   version that doesn't exist on the registry yet.

## README-as-test-contract

**Every claim in a published README must have a corresponding CI
gate.** If we cannot mechanically verify a claim, it does not
belong in user-facing copy.

This is the rule we should have had before shipping `@leadrails/sdk@0.1.0`,
which claimed "Works in Node ≥18, Bun, Deno, Cloudflare Workers,
Vercel Edge" while actually only working in Next.js Server
Components (extension-less imports failed Node ESM resolution AND
`import "server-only"` threw outside Server Component bundles).
Both bugs were silent — every gate said yes. Three months of
publishes would have shipped before a customer noticed.

The fix is not "test more"; it is "every claim is a contract."

### Current contracts and their gates

| Claim in README | Gate |
|---|---|
| HMAC signing produces correct bytes | `packages/sdk/src/sign.test.ts` cross-checks against `node:crypto` |
| Request shape (headers, signature base string) | `packages/sdk/src/send.test.ts` reconstructs and asserts |
| `NEXT_PUBLIC_*` secret refusal | `packages/sdk/src/client.test.ts` |
| "Works in Node ≥18" | `scripts/smoke-node-esm.mjs` packs and loads in plain Node ESM |
| Public exports are stable | smoke script asserts presence of every documented export |
| Browser bundles cannot import the SDK | `package.json` `exports.browser` → throwing stub (not yet smoke-tested) |
| Server-side enforcement | three layers, see "Server-side enforcement" below |

### Claims NOT yet gated

These appear in user-facing copy but have no CI proof. Either add
the gate or remove the claim:

- "Works in Bun" — no Bun runner in CI.
- "Works in Deno" — no Deno runner in CI.
- "Works in Cloudflare Workers" — wrangler smoke would catch any
  workerd-specific resolution issue.
- "Works in Vercel Edge" — would need a deployable preview.

Pre-paying-customers, these are honest aspirations rather than
load-bearing claims. If a customer adopts the SDK in one of these
runtimes, ADD THE GATE BEFORE THE NEXT RELEASE.

## Server-side enforcement

Three layers. None of them are `server-only` (we removed it from
the SDK in 0.1.1 because its react-server condition broke every
non-Next.js runtime).

1. **`package.json` `exports.browser` → `./dist/browser-stub.js`** —
   every modern bundler (webpack, vite, esbuild, turbopack, rollup)
   resolves this condition when targeting a browser. The stub
   throws on import, so a browser bundle that transitively imports
   `@leadrails/sdk` fails at bundle time with a clear error.
2. **Runtime `typeof window !== "undefined"` check** at the top of
   `packages/sdk/src/index.ts` — last-resort guard if a runtime
   somehow loads the non-browser entry from a browser context.
3. **`@leadrails/next/lint/{eslint,oxlint}` preset** bans imports
   of `@leadrails/sdk` outside server-side file conventions
   (Route Handlers, Server Actions). Lint-time, before bundle.

`@leadrails/next` is Next.js-specific, so its source files DO
still use `import "server-only"` (a fourth layer in that package
specifically). Do not add `import "server-only"` to `@leadrails/sdk`
without removing the multi-runtime claim from its README.

If you add a new entry point to `@leadrails/sdk`:

- Top of the file: the same `typeof window` guard (or import from
  a shared place once we have one).
- `package.json` `publishConfig.exports`: add a `browser` condition
  pointing at the throwing stub.

## Module resolution

`tsconfig.base.json` uses `moduleResolution: "NodeNext"` +
`module: "NodeNext"` — every relative import in source MUST end with
`.js` (yes, even in `.ts` files). tsc enforces this at compile time;
catching it pre-publish is the whole point.

If you see `error TS2835: Relative import paths need explicit file
extensions...`, just add `.js`. Don't reach for `moduleResolution:
"Bundler"` to make the error go away — that produces dist files
that break in plain Node ESM, which is how we shipped 0.1.0.

## Versioning

- Pre-1.0: minor bumps may break the SDK surface. Document breakage in
  the per-package CHANGELOG (TODO — not created yet).
- The wire contract (`lead_event.v1`) is stable independent of the SDK
  version. Breaking the wire contract means publishing
  `lead_event.v2`, not bumping the SDK major.

## When the publish breaks

| Symptom | Likely cause |
|---|---|
| `missingConstraint` on JSR | `workspace:*` somewhere in `dependencies`. See rule above. |
| `EPUBLISHCONFLICT` on npm | The version on `package.json` already exists on the registry. Bump and retry. |
| `slow-types` errors on JSR | A public export has an inferred (not annotated) return type. Annotate explicitly. |
| `@leadrails/next` install fails for users with "no matching version" | You published `@leadrails/next` before `@leadrails/sdk`. Publish SDK first. |
