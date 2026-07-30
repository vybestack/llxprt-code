# Repository Test Runner Inventory

This document is the checked-in inventory required by issue #2578 acceptance
criterion #1. It accounts for every repository test file and identifies its
Bun execution command (or explains why it still requires Vitest).

## Summary

| Area                          | Total test files | Bun-native    | Vitest (retained) | Deferred to future slices |
| ----------------------------- | ---------------- | ------------- | ----------------- | ------------------------- |
| packages/a2a-server           | 15               | 15            | 0                 | 0                         |
| packages/agents               | 348              | 0             | 0                 | 348                       |
| packages/auth                 | 37               | 37            | 0                 | 0                         |
| packages/cli                  | 650              | 2             | 0                 | 648                       |
| packages/core                 | 322              | 322           | 0                 | 0                         |
| packages/ide-integration      | 10               | 0             | 0                 | 10                        |
| packages/lsp                  | 0                | all           | 0                 | 0                         |
| packages/mcp                  | 46               | 0             | 0                 | 46                        |
| packages/policy               | 6                | 6             | 0                 | 0                         |
| packages/providers            | 478              | 1             | 0                 | 477                       |
| packages/settings             | 13               | 0             | 0                 | 13                        |
| packages/storage              | 24               | 0             | 0                 | 24                        |
| packages/telemetry            | 11               | 11 (manifest) | 0                 | 0                         |
| packages/test-utils           | 5                | 2             | 1                 | 2                         |
| packages/tools                | 62               | 0             | 0                 | 62                        |
| packages/vscode-ide-companion | 6                | 0             | 0                 | 6                         |
| scripts/tests                 | 97               | 0             | 0                 | 97                        |
| evals                         | 2                | 0             | 0                 | 2                         |
| integration-tests             | 26               | 0             | 0                 | 26                        |

## Fully migrated workspaces (Bun-native as primary `test` script)

These workspaces run `bun test` directly as their `test`/`test:ci` scripts.

### packages/a2a-server

**Command:** `bun test --preload ./bun-preload-storage-isolation.ts --path-ignore-patterns dist --reporter=junit --reporter-outfile=junit.xml`

All 15 test files are Bun-native. Uses a storage-isolation preload that calls
`isolateStorageRoots()` before any test module imports Storage.

### packages/core

**Command:** `bun test --path-ignore-patterns dist --reporter=junit --reporter-outfile=junit.xml`

All 322 core test files are Bun-native (310 original files + 1 new split file
`SessionLockManager.property.test.ts`). The workspace `test`/`test:ci` scripts
use `bun test` directly. A `bunfig.toml` preloads the `augment-bun-vi.ts` compat
shim and a workspace-specific `bun-preload.ts` that replicates the vitest
setupFiles (storage isolation, provider runtime bootstrap).

Migration changes:
- 5 files refactored to remove `vi.resetModules()` (Bun does not support module
  resetting; refactored to test-reset exports or module-level imports)
- 8 files refactored to remove `resolves.not.toThrow()` (broken in Bun —
  rewritten to direct `await` calls)
- 27 files migrated from `@fast-check/vitest` to bare `fast-check` with
  `fc.assert(fc.property(...))` pattern
- Config test files refactored to use sync mock factories (Bun's `mock.module`
  does not drain microtasks in async factories)
- `configTestHarness.ts` updated to use real classes instead of `vi.fn().prototype`
  (Bun's `vi.fn()` has no `.prototype` property)
- 1 file split (`SessionLockManager.test.ts` → `.test.ts` + `.property.test.ts`)
  to satisfy `max-lines` lint rule
- 1 file (`workspaceContext.ts`) patched with `resolveSymlinksInPath()` for
  Bun `realpathSync` compatibility (production code)

### packages/auth

**Command:** `bun test --path-ignore-patterns dist --reporter=junit --reporter-outfile=junit.xml`

All 37 auth test files are Bun-native. The workspace `test`/`test:ci` scripts
use `bun test` directly. A `bunfig.toml` preloads the compat shim and a
workspace-specific `bun-preload.ts` for storage isolation.

Migration changes:
- 1 file refactored to remove `resolves.not.toThrow()`
- `proxy-socket-client.test.ts` refactored: removed `if (server)` conditionals
  (lint), added socket tracking for cleanup, replaced fake-timer-dependent
  idle timeout test with direct `gracefulClose()` call
- `oauth-errors.spec.ts` un-skipped 2 tests (removed `vi.useFakeTimers`,
  replaced with zero-delay async waits)

### packages/lsp

**Command:** `bun test`

All test files are Bun-native. No Vitest imports remain.

### packages/policy

**Command:** `bun test --path-ignore-patterns research`

All 6 test files are Bun-native. The `research/` directory is excluded via
`--path-ignore-patterns` because it contains non-test source.

### packages/test-utils (partially migrated in this PR)

**Bun-native files (2):**

- `src/quota-guard.test.ts` (44 tests)
- `src/util.test.ts` (7 tests)

**Manifest entry:** `bun scripts/run_bun_tests.ts --workspace test-utils`

**Vitest-retained file (1):**

- `src/quota-guard-vitest-integration.test.ts` — This file spawns nested
  `vitest run` subprocesses to test vitest's own runtime semantics
  (ctx.skip, beforeEach hooks, exit codes). It cannot run under Bun because
  it tests vitest itself. Retained on Vitest per acceptance criterion #8.

**Deferred files (2) — Bun runtime compatibility:**

- `src/process-run.test.ts` — Spawns child processes with signal handling
  (SIGTERM/SIGKILL). Bun's child_process emits duplicate output events
  compared to Node.js, causing assertion failures. Deferred until the
  runtime difference is resolved or the test is adapted.
- `src/interactive-run.test.ts` — Uses `@lydell/node-pty` for interactive
  PTY-based testing. Has timing-sensitive behavior under Bun's event loop.
  Deferred for the same runtime reasons as process-run.

## Manifest-based Bun-native test files

These files run under Bun via `scripts/run_bun_tests.ts` but their workspace
primary `test` script still uses Vitest for the bulk of files.

### packages/cli (2 files)

- `src/__tests__/cliSessionDispatch.characterization.test.tsx`
- `test-utils/augment-bun-vi-cleanup.bun.ts`

### packages/core — fully migrated (see above)

### packages/providers (1 file)

- `src/BaseProvider.test.ts`

### packages/telemetry (11 files)

All 11 telemetry test files are verified Bun-native and run via
`scripts/run_bun_tests.ts --workspace telemetry` (isolated process per file).

The workspace primary `test` script still uses Vitest because
`@opentelemetry/core`'s CJS `require("@opentelemetry/api")` does not resolve
`createContextKey` correctly when all telemetry files run in a single Bun
process on Linux CI. Running each file in its own process (the manifest
approach) avoids this interop issue. Once the upstream Bun CJS/ESM interop
issue is resolved, the workspace `test` script can switch to `bun test`.

- `src/debug/ConfigurationManager.test.ts`
- `src/debug/DebugLogger.test.ts`
- `src/debug/FileOutput.test.ts`
- `src/telemetry/canonicalConsumer.behavior.test.ts`
- `src/telemetry/events/api-events.neutral.test.ts`
- `src/telemetry/loggers.localAggregation.test.ts`
- `src/telemetry/metrics.test.ts`
- `src/telemetry/sessionMetricsAggregator.advanced.test.ts`
- `src/telemetry/sessionMetricsAggregator.test.ts`
- `src/telemetry/tool-call-decision.test.ts`
- `src/telemetry/types.test.ts`

### test-setup (2 files at repo root)

- `test-setup/augment-bun-vi.test.ts`
- `test-setup/stub-helpers.bun.test.ts`

## Deferred workspaces (future migration slices)

The following workspaces still execute their full suite under Vitest. Each
will be migrated in a bounded vertical slice:

1. **packages/test-utils** (remaining 2 PTY-based files) — Slice 2
2. **packages/settings** (13 files) — Slice 3
3. **packages/ide-integration** (10 files) — Slice 4
4. **packages/storage** (24 files) — Slice 5
5. **packages/vscode-ide-companion** (6 files) — Slice 6
6. **packages/mcp** (46 files) — Slice 7
7. **packages/tools** (62 files) — Slice 8
8. **packages/providers** (477 files) — Slice 10
9. **packages/agents** (348 files) — Slice 11
10. **packages/cli** (648 files) — Slice 12
11. **scripts/tests** (97 files) — Slice 13
12. **evals** (2 files) — Slice 14
13. **integration-tests** (26 files) — Slice 15

## Enumerated Vitest retention (acceptance criterion #8)

The following Vitest usage is proven unrelated to execution of the repository
test suite and is retained:

1. **`packages/test-utils/src/quota-guard-vitest-integration.test.ts`** — Tests
   vitest's runtime semantics by spawning `vitest run` subprocesses. This is
   a meta-test of the test runner itself, not an application test.

2. **Per-workspace `test:vitest` scripts** — Each migrated workspace retains a
   `test:vitest` script so the Vitest path remains available as a fallback
   during the migration transition. These will be removed once the full
   migration is complete.

3. **`scripts/tests/vitest.config.ts`** — The scripts-tests harness (97 files)
   still runs under Vitest. Migration is deferred to Slice 13.

4. **`evals/vitest.config.ts`** — The evals suite (2 files) still runs under
   Vitest. Migration is deferred to Slice 14.

5. **`integration-tests/`** — The integration test suite (26 files) still
   runs under Vitest. Migration is deferred to Slice 15.

## Canonical Bun-native test command

```bash
# All native Bun test files (manifest-based):
bun scripts/run_bun_tests.ts

# A specific workspace:
bun scripts/run_bun_tests.ts --workspace telemetry
```

For the full repository test suite (including vitest-only workspaces during
the migration transition):

```bash
npm run test
```

## Compatibility shim

The root `bunfig.toml` preloads `test-setup/augment-bun-vi.ts`, which augments
Bun's built-in `vi` object with Vitest-compatible methods. This allows test
files that `import from 'vitest'` to run under Bun without code changes.

Methods provided by the shim:

- `vi.hoisted`, `vi.mocked`, `vi.stubEnv`, `vi.unstubAllEnvs`,
  `vi.stubGlobal`, `vi.unstubAllGlobals`
- `vi.importActual`, `vi.waitFor`
- `vi.advanceTimersByTimeAsync`, `vi.runAllTimersAsync`,
  `vi.runOnlyPendingTimersAsync`
- `vi.clearAllTimers` (guarded no-op when fake timers inactive)
- `vi.mock` / `vi.doMock` (overridden to pass `importOriginal` to factories)
