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

## Dry-run is a simulation, not reality

**A dry-run / `--dry-run` / lint / typecheck / smoke is a simulation
of the real action. It runs a different program against the same
input.** When the dry-run passes, that proves the simulation
succeeds. It does NOT prove the real action will succeed.

This sounds obvious. It is not, because every dry-run is sold as
"the real thing without side effects" — that framing is a lie.

We have learned this the hard way twice now:

- **0.1.0**: `tsc` compiled. `pnpm test` passed. Both lied — neither
  exercised the published artifact in plain Node ESM.
- **0.1.1**: `jsr publish --dry-run` passed. It lied — the real
  `jsr publish` runs a constraint-resolution validation the dry-run
  does not, and that validation rejected the publish.

### The rule

For any irreversible action (publishing to a public registry,
deploying to production, sending a customer-visible event) where
no staging environment exists:

1. **Do not treat the dry-run as authoritative.** Treat it as
   "necessary but not sufficient."
2. **Find a way to do the REAL action in a way that doesn't
   matter.** For npm/JSR: publish a pre-release version
   (`0.1.2-rc.0`, `0.1.2-rc.1`, ...). RC versions are real
   publishes — they exercise every code path the stable publish
   would — but consumers don't pick them up by default.
3. **Only after a real pre-release publish succeeds** end-to-end,
   bump to the stable version and publish that.
4. **rc numbers are free.** Iterate `rc.0` → `rc.1` → `rc.2` as
   needed. Burning rc numbers is fine; burning stable version
   numbers is not.

### The publish flow

1. Bump the version in `packages/<pkg>/package.json` AND
   `packages/<pkg>/jsr.json` to `<x.y.z>-rc.0` (the two must agree).
   If the next-package depends on the sdk-package, bump
   `peerDependencies` and `dependencies` ranges to `^<x.y.z>-rc.0`.
2. `pnpm -r build` from the repo root — produces the `dist/`
   artifacts that npm consumers ship from.
3. npm: `cd packages/<pkg> && pnpm publish --tag rc --access public`.
   The `--tag rc` ensures the rc version does NOT become `latest`.
4. JSR: `cd packages/<pkg> && pnpm dlx jsr publish`.
5. Publish `@leadrails/sdk` BEFORE `@leadrails/next`. Otherwise
   `@leadrails/next`'s peer-dep range resolves to a version that
   doesn't exist on the registry yet.
6. Validate the rc: install `@leadrails/sdk@<rc>` and
   `@leadrails/next@<rc>` into a clean tmpdir and run a smoke
   script. (Future: `pnpm smoke:rc` automating this.)
7. **Only if the rc validates**: bump versions to `<x.y.z>` (drop
   the `-rc.N`), repeat steps 3-4 without `--tag rc`. The stable
   version becomes `latest`.
8. If the rc fails: iterate the rc number, fix, retry. Do NOT
   bump to a stable version until an rc has cleanly shipped.

## JSR-specific facts that bit us

Document these so the next contributor does not relearn:

1. **JSR does NOT read `peerDependencies` for constraint resolution.**
   When the SDK source has `import "@leadrails/sdk"`, JSR's publisher
   resolves the version constraint by reading `dependencies` (and
   falling back to `devDependencies`). `peerDependencies` is invisible
   to this resolver. Consequence: a workspace package that ships an
   adapter ONLY via `peerDependencies` will fail JSR publish with
   `missingConstraint`. The fix is to ALSO list the cross-package dep
   in `dependencies` with a literal range (`^0.1.2-rc.0`). The
   `peerDependencies` entry remains for npm's peer-install semantics.
2. **JSR's `--dry-run` does not validate constraint resolution.** A
   `--dry-run` that succeeds can be followed by a real publish that
   fails with `missingConstraint`. Trust only real (rc) publishes for
   this class of failure.
3. **The `workspace:` protocol is a pnpm convention, not a JSR one.**
   `jsr publish` does NOT rewrite `workspace:*` / `workspace:^` /
   `workspace:~` at publish time. Any of these in a published dep
   field will either fail or produce a broken manifest. Use literal
   version ranges (`^0.1.2-rc.0`) instead. The
   `scripts/check-workspace-deps.mjs` gate enforces this for the
   `dependencies` / `peerDependencies` / `optionalDependencies`
   fields; `devDependencies` is explicitly excluded — but if JSR
   falls back to `devDependencies` to resolve a bare specifier (point
   1 above), even `workspace:*` there will surface as
   `missingConstraint`. Pragma: do not list a workspace package in
   `devDependencies` if it is also a real runtime dep — put it in
   `dependencies` with a real range and let pnpm link the workspace
   copy via range satisfaction.

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

## JSR package quality scorecard

JSR scores every published package on these criteria and displays
the result publicly. We treat the full scorecard as a publish-
readiness gate — every box should be green (or yellow with an
explicit, justified reason) before we publish a new version.

| Criterion | How we satisfy it | Where it's enforced |
|---|---|---|
| README in repo root or module doc | `README.md` at repo root + per-package `README.md`. | File presence (manual). |
| Examples in README | "Quick example" / "Usage" code blocks. | Manual review. |
| Module docs in every entrypoint | Top-of-file comment in each entry `.ts`. | Manual review. |
| ≥80% of exports documented (`/** ... */`) | Every `export` should have a TSDoc comment, including type-only exports. Interface-level docs are required even when members are individually documented — JSR's counter sees the interface as a separate symbol. | Manual review (TODO: lint rule). |
| No slow types | Annotate return types explicitly; avoid relying on TS inference at API boundaries. | `jsr publish --dry-run` (runs `deno doc` fast-check). |
| Has a package description | Set in the JSR package settings web UI: `https://jsr.io/<pkg>/settings`. NOT the same as `jsr.json` `description` — JSR's search uses the settings value. | Web UI (manual). |
| ≥1 runtime marked compatible | JSR package settings → "Runtime compatibility" toggles. Only mark runtimes we have a gate for. Today: Node ≥18 (via `pnpm smoke`). | Web UI (manual). |
| ≥2 runtimes marked compatible | Same place. Add the next runtime when we add the smoke gate for it (Bun → `bun smoke.mjs`; Deno → `deno run`; Workers → `wrangler dev`). | Web UI (manual) + new smoke jobs in `.github/workflows/ci.yml`. |
| Provenance | Publish from a GitHub Actions workflow with OIDC. JSR records the workflow run; consumers can verify the package came from the claimed commit. | `.github/workflows/publish.yml` (TODO — see "Provenance setup" below). |

### Pre-publish checklist (run before every `pnpm publish` / `jsr publish`)

1. `pnpm typecheck && pnpm test && pnpm smoke` — local gates green.
2. Every new export has a TSDoc comment (`/** ... */`). Interface-level
   docs included, even when individual members are documented.
3. `pnpm dlx jsr publish --dry-run` from each package — slow-types
   advisory (necessary, not sufficient — see "Dry-run is a simulation").
4. After publishing an rc and validating, check the JSR package page
   for both packages and confirm the scorecard didn't regress.

### Provenance setup (deferred but tracked)

To unlock the "Has provenance" check, we need to publish from CI
rather than from a developer laptop:

- GitHub Actions workflow (`.github/workflows/publish.yml`) triggered
  on a release tag.
- `permissions: id-token: write` so the workflow can mint an OIDC
  token JSR and npm both trust.
- `npm publish --provenance --access public` (npm side).
- `npx jsr publish` (JSR auto-detects OIDC when run inside Actions).

Until that workflow exists, publishes from local machines will
always show "Has provenance: ✗" on the scorecard. That's a known
deferred item.

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
| `missingConstraint` on JSR (and `--dry-run` passed) | The bare specifier resolves only via `peerDependencies`, which JSR does not read. Also list the dep in `dependencies` with a literal range. See "JSR-specific facts that bit us" above. |
| `missingConstraint` on JSR (workspace protocol) | `workspace:*` / `workspace:^` / `workspace:~` in a published dep field, OR in `devDependencies` for a package JSR falls back to. Use literal version ranges. |
| `EPUBLISHCONFLICT` on npm | The version on `package.json` already exists on the registry. Bump and retry. |
| `slow-types` errors on JSR | A public export has an inferred (not annotated) return type. Annotate explicitly. |
| `@leadrails/next` install fails for users with "no matching version" | You published `@leadrails/next` before `@leadrails/sdk`. Publish SDK first. |
