# Repository Test Runner Inventory

This document is the checked-in inventory required by issue #2578 acceptance
criterion #1. It accounts for every repository test file and identifies its
Bun execution command (or explains why it still requires Vitest).

## Summary

Counts are the manifest's own resolution — regenerate with
`bun scripts/run_bun_tests.ts --root <name> --dry-run` rather than editing them
by hand.

| Root                          | Bun-native files | Primary runner               |
| ----------------------------- | ---------------- | ---------------------------- |
| packages/a2a-server           | 21               | Bun (manifest)               |
| packages/agents               | all              | Bun (`run-bun-tests.ts`)     |
| packages/auth                 | all              | Bun (`run-bun-tests.ts`)     |
| packages/cli                  | 24               | **Vitest** (#2578)           |
| packages/core                 | 1                | Bun (`run-bun-tests.ts`)     |
| packages/ide-integration      | 10               | Bun (manifest)               |
| packages/lsp                  | all              | Bun (`bun test`)             |
| packages/mcp                  | 43               | Bun (manifest)               |
| packages/policy               | 12               | Bun (manifest)               |
| packages/providers            | 492              | Bun (manifest)               |
| packages/settings             | 15               | Bun (manifest)               |
| packages/storage              | 32               | Bun (manifest)               |
| packages/telemetry            | 13               | Bun (manifest)               |
| packages/test-utils           | 11               | Bun (manifest)               |
| packages/tools                | 73               | Bun (manifest)               |
| packages/vscode-ide-companion | 7                | Bun (manifest)               |
| scripts/tests                 | 212 (+1 slow)    | Bun (manifest)               |
| test-setup                    | 2                | Bun (manifest)               |
| evals                         | 1                | Bun (manifest, credentialed) |
| integration-tests             | 31               | Bun (manifest, credentialed) |

`core` carries a small manifest entry alongside a different primary runner.
Those files are excluded from the primary selection, so nothing runs twice
within a workspace.

### Where Vitest still executes

| Path                                                                     | Invoked by                                      |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| `packages/cli` `test` / `test:ci` (+ integration, covered, fast, legacy) | the `cli` shard via `scripts/test.ts`           |
| `packages/storage` `test:vitest`                                         | `secure_store_backend` in `ci.yml`, and nightly |
| `packages/test-utils/src/quota-guard-vitest-integration.test.ts`         | itself — it is the test _of_ Vitest integration |

Everything else that mentions `vitest` is either an unused `test:vitest`
escape hatch (`auth`, `lsp`, `mcp`, `providers`, `storage`, `tools`) or the
`vitest` import specifier, which Bun resolves through its own injected
handler.

## Fully migrated workspaces (Bun-native as primary `test` script)

These workspaces run Bun as their `test`/`test:ci` scripts. Most now delegate
to the shared manifest runner
(`bun ../../scripts/run_bun_tests.ts --workspace <name> --junit junit.xml`),
which gives one isolated process per file; a few predate it and call
`bun test` directly.

### packages/a2a-server

**Command:** `bun ../../scripts/run_bun_tests.ts --workspace a2a-server --junit junit.xml`

All 21 test files are Bun-native. Uses a storage-isolation preload that calls
`isolateStorageRoots()` before any test module imports Storage, plus the
shared Vitest-compatibility shim.

### packages/agents

**Command:** `bun run-bun-tests.ts`

All 331 test files are Bun-native and the workspace `test`/`test:ci` scripts run
Bun. **Vitest is gone from this workspace entirely** — no `test:vitest` fallback,
no `vitest.config.ts`, no `vitest` devDependency, and no test file imports it.
The test API comes from `src/testApi.ts`, which re-exports `bun:test` with the
corrections the compat shim actually installs at runtime.

The Stryker mutation gate (`test:mutation:api`) was dropped with it: Stryker has
no Bun runner, and its Vitest runner cannot execute suites that import
`bun:test`.

`run-bun-tests.ts` discovers every `src/**/*.{test,spec}.{ts,tsx}` file and runs
each in its own `bun test` process. Per-file processes are required rather than
merely preferred: Bun's `mock.module` registry is process-wide, and 69 agents
files register module mocks. There is deliberately no exclusion list.

Two Bun behaviours the runner works around:

- Bun 1.3.14 ignores a `[test] timeout` key in `bunfig.toml` and falls back to
  its 5s default, so the 30s budget matching the previous Vitest `testTimeout`
  is passed as `--timeout` on the command line.
- File concurrency is kept below the core count (half the cores, clamped to
  [2, 4], overridable via `LLXPRT_AGENTS_TEST_CONCURRENCY`), because every file
  re-executes the whole agents module graph in a fresh process.

Each child writes its own Bun JUnit report and the runner merges them, so CI
keeps per-test names rather than a file-level summary.

The `bunfig.toml` preloads the compat shim and `test-setup-storage-isolation.ts`,
which isolates Storage roots and sets `LLXPRT_TEST_DISABLE_OS_KEYRING=1` so
suites use the encrypted-file fallback instead of the developer's real OS
keychain. The real keyring stays covered by the dedicated `secure_store_backend`
CI job.

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

These files run under Bun via `scripts/run_bun_tests.ts` separately from their
workspace's primary selection — either because that workspace's primary `test`
script still uses Vitest for the bulk of its files, or because the files are
Bun-only fixtures the primary selection does not match.

### packages/agents (3 files)

The workspace runs all of its `*.test.ts` / `*.spec.ts` files through
`bun run-bun-tests.ts` (see above). These entries stay in the manifest so the
`Bun Native Test Compatibility` job also covers them, and because the two
`test-bun/*.bun.ts` files are Bun-only fixtures that the workspace runner's
`*.test.*` / `*.spec.*` discovery does not match.

- `src/core/CompressionProfileResolver.proxyKeyStorage.test.ts`
- `test-bun/generatingModelStamp.issue2511.bun.ts`
- `test-bun/subagentAnthropicTextSettings.issue1738.bun.ts`

### packages/cli (12 files)

- `src/__tests__/cliSessionDispatch.characterization.test.tsx`
- `src/utils/sandbox-containers.test.ts`
- `src/zed-integration/zed-session-lifecycle.test.ts`
- `test-utils/augment-bun-vi-cleanup.bun.ts`

The JSP/1 observation producer suite (issue #2779) is Bun-native from the start
rather than migrated. These eight files are excluded from the Vitest selection
in `packages/cli/vitest.test-groups.ts`, so they run under `bun test` only and
do not change `SELECTED_FILE_COUNT`:

- `src/observation/jspBounds.test.ts`
- `src/observation/jspProducer.test.ts`
- `src/observation/jspProducerState.test.ts`
- `src/observation/jspRedaction.test.ts`
- `src/observation/jspSchema.test.ts`
- `src/observation/jspTransport.test.ts`
- `src/observation/jspWiring.test.ts`
- `src/observation/observationTap.test.ts`

The sandbox SSH agent preflight suite (issue #1699) follows the same pattern —
Bun-native from the start and excluded from the Vitest selection:

- `src/utils/sandbox-ssh-agent-preflight.test.ts`

It partially mocks `node:child_process` through an async `importOriginal`
factory rather than a bare `vi.mock` automock: automocking walks every export
and throws on `ChildProcess`'s private `#stdin` getter under Bun's native
runner.

### packages/core — fully migrated (see above)

### packages/providers (manifest-driven, ~474 files)

The providers workspace primary `test` script is fully manifest-driven
(`bun ../../scripts/run_bun_tests.ts --workspace providers`). All listed
manifest files run under Bun in isolated processes. The manifest has grown
well beyond the single file listed at issue #2578 time; see
`scripts/bun-test-manifest.ts` for the authoritative file list. Notable
#2946 additions:

- `src/__tests__/BaseProvider.proxyKeyStorage.test.ts`
- `src/gemini/GeminiProvider.auth.test.ts`

### packages/storage (7 files)

Seven storage secure-store test files are genuinely Bun-native: they live under
`test-bun/` with the `.bun.ts` suffix and import from `bun:test`, following the
same convention as `packages/tools/test-bun`. They run via
`scripts/run_bun_tests.ts --workspace storage` (isolated process per file) and
use the `test-setup-storage-isolation.ts` preload (the same setup file the
Vitest config uses) so `isolateStorageRoots()` runs before any test module
imports the `Storage` singleton.

Because the `.bun.ts` suffix does not match Vitest's default
`*.{test,spec}.*` include pattern, these files are invisible to `vitest run` —
they are executed only by Bun, with no dual-runner shim involved.

The workspace primary `test` script still uses Vitest (`vitest run`) for the
remaining 24 storage test files, which are untouched by this work.

Neither of the two files that previously needed Vitest module mocking still
does. `storage.test.ts` mocked `fs` only to stub `mkdirSync`, but the sole
caller of `mkdirSync` is `ensureProjectTempDirExists()`, which that file never
invokes — the mock was dead weight and was removed rather than reproduced.

- `test-bun/credential-write-lock.bun.ts`
- `test-bun/keyring-write-verification.bun.ts`
- `test-bun/machine-secret.bun.ts`
- `test-bun/machine-secret.concurrent-write.bun.ts`
- `test-bun/secure-store.bun.ts`
- `test-bun/secure-store.concurrent-write.bun.ts`
- `test-bun/storage.bun.ts`

### packages/cli — extension settings storage

`src/config/extensions/settingsStorage.test.ts` is Bun-native and registered in
the manifest, following the CLI's existing convention of keeping such files
under `src/` and excluding them from the Vitest selection (see `baseExclude` in
`vitest.test-groups.ts`).

It previously replaced the entire storage module with a stand-in `SecureStore`
via `vi.mock`. Rather than reproduce that in bun:test, the production class now
accepts optional `SecureStoreOptions`, so the test drives the REAL `SecureStore`
against a temp fallback dir, temp lock dir, and an in-memory keyring adapter.
Only the OS keychain — the one part a test genuinely cannot touch — is
substituted. Consequently CONFLICT, TIMEOUT, and error classification are now
exercised through SecureStore's actual code paths instead of hand-thrown
error-shaped objects.

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

## Remaining workspaces (future migration slices)

Two workspaces still execute their full suite under Vitest, tracked by #2578:

1. **packages/cli** (~659 files)

Every other root listed in the summary is Bun-native. `settings`,
`ide-integration`, `vscode-ide-companion`, `a2a-server`, `policy`,
`telemetry`, `test-utils`, `scripts/tests`, `evals` and `integration-tests`
were migrated by #2847, which also deleted their `vitest.config.ts` files.

## Enumerated Vitest retention (acceptance criterion #8)

Two categories exist. The first still executes and is scoped to #2578; the
second does not execute at all.

**Still executes:**

1. **`packages/cli`** — primary `test`/`test:ci` scripts, run by its shard
   through `scripts/test.ts`.

2. **`packages/storage` `test:vitest`** — the `secure_store_backend` job (and
   its nightly twin) needs the two backend-specific configs
   (`vitest.config.native-keyring.ts`, `vitest.config.fallback-behavior.ts`)
   to force a keyring backend per leg.

3. **`packages/test-utils/src/quota-guard-vitest-integration.test.ts`** —
   spawns `vitest run` subprocesses to test Vitest's own runtime semantics.
   A meta-test of the runner, not an application test. Note that the
   production quota hook it once mirrored now lives in
   `integration-tests/setup-quota-guard.ts` and always throws under Bun, so
   this file no longer characterises the shipped behaviour.

**Does not execute:**

4. **Per-workspace `test:vitest` scripts** — `auth`, `lsp`, `mcp`,
   `providers`, `storage` and `tools` keep one as an escape hatch. No
   workflow and no `test` script invokes them. `packages/core` has none: its
   script was removed with the Bun exclusion list (issue #2968).

5. **The `vitest` import specifier** — migrated test files still import
   `describe`/`it`/`expect` from `'vitest'`, which Bun resolves through its
   own injected handler. `vitest` therefore stays in `devDependencies`.

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
