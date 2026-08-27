# Issue #3305 — `@vybestack/llxprt-code-mcp` value-imports core at runtime but declares it only as a devDependency

## Problem (verified on `main`, commit `354957220`)

`packages/mcp/package.json` lists `@vybestack/llxprt-code-core` in `devDependencies`
only, while production source performs value imports from it. Verified evidence:

1. Value (non-type) imports from core in `packages/mcp/src` production files:
   `getErrorMessage`, `debugLogger`, `DebugLogger`, `coreEvents`,
   `openBrowserSecurely`, `AuthProviderType`, `safeJsonStringify`.
   Most of the "19 files" in the issue body already use `import type`; the
   remaining value imports are genuine runtime imports and cannot be converted.
2. `npm pack` of `packages/mcp` produces a tarball whose shipped
   `dist/mcp/**` contains bare runtime specifiers:
   `@vybestack/llxprt-code-core/utils/errors.js`,
   `.../utils/debugLogger.js`, `.../utils/events.js`,
   `.../debug/DebugLogger.js`, `.../debug/index.js`,
   `.../utils/safeJsonStringify.js`, `.../utils/secure-browser-launcher.js`,
   `.../config/configTypes.js`, and more.
3. `scripts/bind-release-deps.ts` rewrites `file:` specifiers in *all* dependency
   sections, including `devDependencies`. So the published manifest ends up with
   `devDependencies: { "@vybestack/llxprt-code-core": "0.11.0" }` — never
   installed by a consumer running `npm i @vybestack/llxprt-code-mcp`.
4. Reproduced the consumer failure hermetically: extracting the packed tarball
   into an OS-temp `node_modules` populated only from the manifest's declared
   `dependencies` fails with
   `Cannot find module '@vybestack/llxprt-code-core/utils/debugLogger.js'`.

## Decision on the cycle

`core` already declares `@vybestack/llxprt-code-mcp` in `dependencies` and
value-imports it (`config/config.ts`, `code_assist/oauth-credential-storage.ts`,
`config/lspIntegration.ts`, `src/index.ts` re-exports). Extracting the shared
leaf utilities into a new package is a large cross-package refactor that is out
of scope for this issue.

**Chosen option: declare the cycle.** Move `@vybestack/llxprt-code-core` into
`packages/mcp` `dependencies` so the declared graph matches the real runtime
graph, and document the cycle as deliberate. Verified that
`npm install --package-lock-only --ignore-scripts` succeeds with the cycle
declared (npm resolves workspace cycles), and `scripts/check-storage-package-cycle.ts`
is unaffected (storage has no workspace dependencies).

---

## Accepted behavior (acceptance criteria)

### AC1 — `packages/mcp` declares its runtime dependency on core

`packages/mcp/package.json` declares `@vybestack/llxprt-code-core` in
`dependencies` (with the `file:../core` workspace protocol, matching its
siblings) and no longer declares it in `devDependencies`.

### AC2 — Repo-wide packaging guard

A guard verifies that, for **every NPM-published workspace package**, no
production source file imports a package that is absent from that package's
`dependencies` / `peerDependencies` / `optionalDependencies`.

Definitions the guard must use:

- **Published workspace package**: a directory listed in root `workspaces` whose
  manifest is not `private: true` and whose name is not in
  `NON_NPM_RELEASE_PACKAGES` (`scripts/utils/release-packages.ts`).
- **Production source file**: a file reachable by transitive *relative* import
  from the package's published entrypoints, derived from the manifest
  (`main` / `module` / `types` / `exports`, preferring the `bun` source
  condition). Reuse `deriveAllEntryPaths` / `resolveRelativeModule` from
  `scripts/tests/workspace-source-helpers.ts`. Reachability is the definition —
  do **not** introduce an ad-hoc "looks like a test" path allowlist to make
  violations disappear.
- **Runtime import**: a bare specifier from a static `import`/`export ... from`,
  a bare `import()` call, or a bare `require()` call, excluding `import type` /
  `export type` and excluding type-only named bindings
  (`import { type X } from ...`). Use the TypeScript AST, not regex
  (`scripts/check-storage-import-boundary.ts` is the model).
- **Exempt specifiers**: Node builtins (with or without the `node:` prefix),
  `bun:` specifiers, relative/absolute paths, and self-references to the
  package's own name.
- **Package name extraction**: `@scope/name` for scoped specifiers, first path
  segment otherwise; subpaths are stripped.

### AC3 — Every violation the guard reports is fixed

Running the guard on the current tree surfaces undeclared runtime imports beyond
`mcp`. Probe results (regex pre-scan; final list is whatever the AST + entrypoint
reachability guard actually reports):

| Package | Undeclared specifier | Source |
|---|---|---|
| `packages/telemetry` | `zod` | `src/perf/perfRecords.ts` |
| `packages/telemetry` | `@opentelemetry/context-async-hooks` | `src/telemetry/sdk.ts` |
| `packages/providers` | `@vybestack/llxprt-code-telemetry` | `src/logging/telemetryEmitter.ts` |
| `packages/agents` | `typescript` | `src/api/apiSurfaceParser.ts` |
| `packages/cli` | `semver` | `src/commands/extensions/validate.ts`, `src/ui/utils/updateCheck.ts` |
| `packages/cli` | `strip-json-comments` | `src/auth/oauth-settings-adapter.ts`, `src/config/trustedFolders.ts`, `src/config/settingsLoader.ts` |

Fixes are **declaration-only** `package.json` edits: add each specifier to the
owning package's `dependencies` with a range consistent with the root manifest
(`publish-integrity.test.ts` requires the root range to be a *subset* of the
workspace range, so reuse the root's range verbatim). Do not change any
production code to make the guard pass.

Special case: `@vybestack/llxprt-code-test-utils` is in
`NON_NPM_RELEASE_PACKAGES` and can never be a runtime dependency of a published
package. If entrypoint reachability still reaches a file importing it
(`packages/agents/src/core/coreToolScheduler-test-helpers.ts`,
`packages/cli/src/test-utils/render.tsx`), **stop and report** rather than
inventing an exclusion — that would be a genuine published-surface bug needing
its own decision.

### AC4 — The `core` ↔ `mcp` cycle is documented as deliberate

A short document records that the cycle is declared on purpose, why the
alternative (extracting shared leaf utilities into a new package) was not taken,
and what would remove it. Both manifests declare their side of the edge.

### AC5 — The published `mcp` tarball installs standalone and imports cleanly

A test packs `packages/mcp`, materializes a consumer whose module resolution is
constrained to the packed manifest's declared dependencies, imports the package
entrypoint, and asserts it loads.

---

## Tests that prove the behavior

All tests are Bun tests (`bun:test`), TypeScript, under `scripts/tests/`.

### T1 — `scripts/tests/runtime-dependency-declarations.test.ts` (AC2)

Behavioral unit tests for the guard's exported functions against **synthetic
temp-dir fixtures** (mirroring `published-closure-regressions.test.ts`):

1. A fixture package whose entrypoint value-imports an undeclared bare package →
   one violation naming the file, line, specifier, and package.
2. The same fixture with the package declared in `dependencies` → no violation.
3. Declared in `peerDependencies` → no violation.
4. Declared in `optionalDependencies` → no violation.
5. Declared **only** in `devDependencies` → violation (this is the #3305 shape).
6. `import type { X } from 'undeclared'` → no violation.
7. `export type { X } from 'undeclared'` → no violation.
8. `import { type X } from 'undeclared'` (inline type-only binding) → no violation.
9. `import 'undeclared'` (bare side-effect import) → violation.
10. `await import('undeclared')` with a literal specifier → violation.
11. `require('undeclared')` → violation.
12. Node builtins `fs`, `node:fs`, and `bun:test` → no violation.
13. A subpath specifier `undeclared/sub/path.js` → violation reported against
    package `undeclared`; `@scope/pkg/sub.js` → reported against `@scope/pkg`.
14. Self-reference to the package's own name → no violation.
15. A file that exists in the package but is **not reachable** from any
    entrypoint → its imports are not scanned.
16. `private: true` and `NON_NPM_RELEASE_PACKAGES` workspaces are skipped.

### T2 — `scripts/tests/runtime-dependency-declarations.repo.test.ts` (AC1, AC3)

Runs the guard against the **real repository** and asserts zero violations, with
the failure message listing every offender. Plus a targeted, self-documenting
assertion that `packages/mcp/package.json` declares
`@vybestack/llxprt-code-core` in `dependencies` and not in `devDependencies`
(so a regression names #3305 directly).

### T3 — `scripts/tests/mcp-standalone-consumer.test.ts` (AC5)

Hermetic, no network:

1. `npm pack packages/mcp --pack-destination <tmp>` (OS temp dir via
   `mkdtempSync(join(tmpdir(), ...))`, **outside the repo** — a temp dir inside
   the repo lets Node/Bun walk up into the repo's own `node_modules` and the
   test silently passes; this was observed during investigation).
2. Extract the tarball; copy `package/` to
   `<tmp>/node_modules/@vybestack/llxprt-code-mcp` (copy, not symlink, so the
   package's realpath is inside the sandbox and its resolution is constrained).
3. For each name in the *packed manifest's* `dependencies` + `peerDependencies`,
   symlink `<repoRoot>/node_modules/<name>` into `<tmp>/node_modules/<name>`.
   Nothing else is linked.
4. Run `bun -e "await import('@vybestack/llxprt-code-mcp')"` with `cwd: <tmp>`;
   assert exit code 0 and that stderr contains no `Cannot find module`.
   The `bun` export condition resolves to the packed `index.ts` source, so the
   test does not depend on `dist/` having been built.
5. Negative control in the same file: rebuild the sandbox omitting
   `@vybestack/llxprt-code-core` from the linked set and assert the import
   fails with `Cannot find module '@vybestack/llxprt-code-core/...`. This proves
   the sandbox actually constrains resolution rather than leaking to the repo.

Give the test a generous explicit timeout (`npm pack` of `mcp` writes ~1815
files) and always clean up the temp dir in a `finally`.

---

## Implementation

### Files added

- `scripts/check-runtime-dependency-declarations.ts` — executable guard
  (`#!/usr/bin/env bun`), exporting the pure analysis functions used by T1/T2
  and a `main()` that prints diagnostics and exits non-zero on violations.
  Follow the structure and reporting style of
  `scripts/check-cli-import-boundary.ts`; anchor the repo root to
  `import.meta.url`, not `process.cwd()`.
- `scripts/tests/runtime-dependency-declarations.test.ts` (T1)
- `scripts/tests/runtime-dependency-declarations.repo.test.ts` (T2)
- `scripts/tests/mcp-standalone-consumer.test.ts` (T3)
- `dev-docs/architecture/package-dependency-cycles.md` (AC4)

### Files changed

- `packages/mcp/package.json` — move `@vybestack/llxprt-code-core` from
  `devDependencies` to `dependencies` (AC1).
- `packages/telemetry/package.json`, `packages/providers/package.json`,
  `packages/agents/package.json`, `packages/cli/package.json` — add the
  undeclared runtime dependencies the guard reports (AC3).
- `package-lock.json` / `bun.lock` — regenerate.
- Root `package.json` — add `"lint:runtime-deps": "bun scripts/check-runtime-dependency-declarations.ts"`.
- `scripts/lint-all.sh` — run the new guard alongside the other guards.
- `.github/workflows/ci.yml` — add a `Run runtime-dependency declaration guard (#3305)`
  step next to the other `lint:*` guard steps.

### Constraints

- No new `.js` files; TypeScript + Bun only.
- No new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No ESLint severity downgrades, no new `ignores:` blocks, no complexity or
  file-size threshold increases.
- Copyright year on new files must be the current year (2026).
- No production code changes in `packages/*/src` — this issue is about
  declarations, guards, and documentation.

### Out of scope

- Extracting `getErrorMessage` / `DebugLogger` / `coreEvents` /
  `openBrowserSecurely` / `AuthProviderType` into a new shared leaf package.
- Converting the already-correct `import type` usages.
- Any change to `packages/*/src` production behavior.
- Removing the `core` ↔ `mcp` cycle.

---

## Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus the new guard directly: `npm run lint:runtime-deps`.
