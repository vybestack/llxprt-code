# Repository Test Runner Inventory

This document is the checked-in inventory required by issue #2578 acceptance
criterion #1. It accounts for every repository test file and identifies its
Bun execution command (or explains why it still requires Vitest).

## Summary

There is no manifest. Roots are discovery-based: each root in
`scripts/bun-test-roots.ts` declares the directories to scan and the execution
settings (preload, tsconfig, timeout, retries, globalSetup), and the runner
walks the filesystem to resolve test files. A newly added test file is picked
up automatically and can never be silently dropped. Regenerate the per-root
counts with `bun scripts/run_bun_tests.ts --root <name> --dry-run` rather than
editing them by hand.

`scripts/check-test-file-coverage.ts` is the mechanism that keeps this
inventory honest. It walks the whole repository for test files and fails when
one exists on disk that no executor runs (AC8) or when two executors both run
the same file (AC7). Its covered set is derived from each executor's own
discovery code — the shared root resolver and the bespoke workspace runners —
rather than restated, so the guard does not duplicate the selection logic it
checks. What it proves: every test file on disk is claimed by at least one
executor, and no file is claimed by more than one. What it does not prove:
that those executors pass (that is the test suite's job) or that the executor
table itself is complete (that is proven by the ownership test's bespoke-runner
wiring assertions).

| Root                          | Bun-native files | Primary runner                    |
| ----------------------------- | ---------------- | --------------------------------- |
| packages/a2a-server           | 21               | Bun (shared runner)               |
| packages/agents (src)         | 340              | Bun (`run-bun-tests.ts`)          |
| packages/agents (test-bun)    | 6                | Bun (shared runner)               |
| packages/auth                 | 42               | Bun (`run-bun-tests.ts`)          |
| packages/cli                  | 670              | Bun (`run-bun-tests.ts`)          |
| packages/core                 | 352              | Bun (`run-bun-tests.ts`)          |
| packages/ide-integration      | 10               | Bun (shared runner)               |
| packages/lsp                  | 13               | Bun (shared runner)               |
| packages/mcp                  | 43               | Bun (shared runner)               |
| packages/policy               | 12               | Bun (shared runner)               |
| packages/providers            | 544              | Bun (shared runner)               |
| packages/settings             | 15               | Bun (shared runner)               |
| packages/storage              | 38               | Bun (shared runner)               |
| packages/telemetry            | 13               | Bun (shared runner)               |
| packages/test-utils           | 11               | Bun (shared runner)               |
| packages/tools                | 88               | Bun (shared runner)               |
| packages/vscode-ide-companion | 7                | Bun (shared runner)               |
| scripts/tests                 | 225              | Bun (shared runner)               |
| test-setup                    | 3                | Bun (shared runner)               |
| evals                         | 1                | Bun (shared runner, credentialed) |
| integration-tests             | 32               | Bun (shared runner, credentialed) |

`cli` and `core` no longer have shared roots: their bespoke discovery runners
(`packages/{cli,core}/run-bun-tests.ts`) discover every test file, so a shared
root would be strictly redundant. The `agents` shared root now covers only
`test-bun`; its `src` tests run through the bespoke runner, so nothing in
`agents/src` runs twice.

`telemetry` and `cli` are redundant-with-a-reason: `telemetry` migrated under
#2836 and its shared root is already glob/discovery-driven; `cli` migrated
under #2843 and its bespoke runner discovers everything with no allowlist and
no exclusion list.

### Where Vitest still executes

| Path                                                             | Invoked by                                      |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| `packages/storage` `test:vitest`                                 | `secure_store_backend` in `ci.yml`, and nightly |
| `packages/test-utils/src/quota-guard-vitest-integration.test.ts` | itself — it is the test _of_ Vitest integration |

Everything else that mentions `vitest` is either an unused `test:vitest`
escape hatch (`auth`, `lsp`, `mcp`, `providers`, `storage`, `tools`) or the
`vitest` import specifier, which Bun resolves through its own injected
handler.

## Fully migrated workspaces (Bun-native as primary `test` script)

These workspaces run Bun as their `test`/`test:ci` scripts. Most now delegate
to the shared runner
(`bun ../../scripts/run_bun_tests.ts --workspace <name> --junit junit.xml`),
which resolves files by discovery and gives one isolated process per file; a
few predate it and call `bun test` directly, and `cli`/`core`/`agents`/`auth`
run their own bespoke `run-bun-tests.ts`.

### packages/a2a-server

**Command:** `bun ../../scripts/run_bun_tests.ts --workspace a2a-server --junit junit.xml`

All 21 test files are Bun-native. Uses a storage-isolation preload that calls
`isolateStorageRoots()` before any test module imports Storage, plus the
workspace preload.

### packages/agents

**Command:** `bun run-bun-tests.ts`

All 340 test files are Bun-native and the workspace `test`/`test:ci` scripts run
Bun. **Vitest is gone from this workspace entirely** — no `test:vitest` fallback,
no `vitest.config.ts`, no `vitest` devDependency, and no test file imports it.
The test API comes straight from `bun:test`.

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

The `bunfig.toml` preloads `test-setup-storage-isolation.ts`,
which isolates Storage roots and sets `LLXPRT_TEST_DISABLE_OS_KEYRING=1` so
suites use the encrypted-file fallback instead of the developer's real OS
keychain. The real keyring stays covered by the dedicated `secure_store_backend`
CI job.

### packages/core

**Command:** `bun run-bun-tests.ts`

All 352 core test files are Bun-native. The workspace `test`/`test:ci` scripts
use `bun run-bun-tests.ts`, which discovers every `*.{test,spec}.{ts,tsx}`
file under `src` and `test`. A `bunfig.toml` preloads a workspace-specific
`bun-preload.ts` that replicates the
vitest setupFiles (storage isolation, provider runtime bootstrap).

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

**Command:** `bun run-bun-tests.ts`

All 42 auth test files are Bun-native. The workspace `test`/`test:ci` scripts
use `bun run-bun-tests.ts`, which discovers every `*.{test,spec}.{ts,tsx}`
file under `src`. A `bunfig.toml` preloads a
workspace-specific `bun-preload.ts` for storage isolation.

Migration changes:

- 1 file refactored to remove `resolves.not.toThrow()`
- `proxy-socket-client.test.ts` refactored: removed `if (server)` conditionals
  (lint), added socket tracking for cleanup, replaced fake-timer-dependent
  idle timeout test with direct `gracefulClose()` call
- `oauth-errors.spec.ts` un-skipped 2 tests (removed `vi.useFakeTimers`,
  replaced with zero-delay async waits)

### packages/lsp

**Command:** `bun ../../scripts/run_bun_tests.ts --workspace lsp --junit junit.xml`

All 13 test files (under `test/`) are Bun-native and discovered by the shared
`lsp` root. No Vitest imports remain. The workspace previously used a bare
`bun test`; it now uses the shared runner, which gives one isolated process per
file, matching the form used by sibling workspaces.

### packages/policy

**Command:** `bun ../../scripts/run_bun_tests.ts --workspace policy --junit junit.xml`

All 12 test files are Bun-native and discovered by the shared `policy` root.
There is no `src/research` directory and no exclusion list — discovery walks
`packages/policy` and runs every matching file.

### packages/test-utils (partially migrated in this PR)

**Bun-native files (2):**

- `src/quota-guard.test.ts` (44 tests)
- `src/util.test.ts` (7 tests)

**Root entry:** `bun scripts/run_bun_tests.ts --workspace test-utils`

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

## Shared-runner test files (discovery-based)

These workspaces run their Bun-native tests through the shared runner
(`scripts/run_bun_tests.ts`), which resolves files by walking each root's
declared directories in `scripts/bun-test-roots.ts`. There is no per-file list:
every `*.{test,spec,bun}.{ts,tsx,js}` file under a root's scanned directories
runs. The `Bun Native Test Compatibility` job that once re-checked the manifest
no longer exists — its resolution role is subsumed by the coverage guard above,
which additionally proves resolution is _complete_.

### packages/agents (`test-bun`, 6 files)

The workspace runs all of its `src/**/*.{test,spec}.{ts,tsx}` files through
`bun run-bun-tests.ts` (see above). The shared `agents` root now scans only
`test-bun`, so the `test-bun/*.bun.ts` fixtures — Bun-only suites the bespoke
runner's `*.test.*` / `*.spec.*` discovery does not match — run through the
shared runner instead. Nothing in `agents/src` runs twice.

### packages/cli — bespoke runner (670 files)

`cli` migrated under #2843. Its `test` / `test:ci` scripts run
`packages/cli/run-bun-tests.ts`, which discovers every
`*.{test,spec,bun}.{ts,tsx}` file under `src`, `test`, `test-bun` and
`test-utils` with no allowlist and no exclusion list. The JSP/1 observation
producer suite (issue #2779) and the sandbox SSH agent preflight suite
(issue #1699) — both Bun-native from the start — are discovered alongside
every other file rather than maintained as a separate list. `cli` has no
shared root: it would be strictly redundant with the bespoke runner.

### packages/core — fully migrated (see above)

### packages/providers (discovery-driven, 544 files)

The providers workspace primary `test` script is fully discovery-driven
(`bun ../../scripts/run_bun_tests.ts --workspace providers`). The shared root
walks `packages/providers` and runs every `*.{test,spec,bun}.{ts,tsx,js}` file
in its own isolated process. The root has grown well beyond the single file
listed at issue #2578 time; see `scripts/bun-test-roots.ts` for the
authoritative root table. Notable #2946 additions:

- `src/__tests__/BaseProvider.proxyKeyStorage.test.ts`
- `src/gemini/GeminiProvider.auth.test.ts`

### packages/storage (7 files)

Seven storage secure-store test files are genuinely Bun-native: they live under
`test-bun/` with the `.bun.ts` suffix and import from `bun:test`, following the
same convention as `packages/tools/test-bun`. They are discovered by the shared
`storage` root (`scripts/run_bun_tests.ts --workspace storage`, isolated process
per file) and use the `test-setup-storage-isolation.ts` preload (the same setup
file the Vitest config uses) so `isolateStorageRoots()` runs before any test
module imports the `Storage` singleton.

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

`src/config/extensions/settingsStorage.test.ts` is Bun-native and discovered by
the cli bespoke runner alongside every other cli test file, following the CLI's
convention of keeping such files under `src/`.

It previously replaced the entire storage module with a stand-in `SecureStore`
via `vi.mock`. Rather than reproduce that in bun:test, the production class now
accepts optional `SecureStoreOptions`, so the test drives the REAL `SecureStore`
against a temp fallback dir, temp lock dir, and an in-memory keyring adapter.
Only the OS keychain — the one part a test genuinely cannot touch — is
substituted. Consequently CONFLICT, TIMEOUT, and error classification are now
exercised through SecureStore's actual code paths instead of hand-thrown
error-shaped objects.

### packages/telemetry (13 files)

All 13 telemetry test files are verified Bun-native and discovered by the
shared `telemetry` root (`scripts/run_bun_tests.ts --workspace telemetry`,
isolated process per file). The root is glob/discovery-driven, so telemetry is
redundant-with-a-reason: it migrated under #2836 and no Vitest selection runs
it.

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

### test-setup (3 files at repo root)

- `test-setup/stub-helpers.bun.test.ts`
- `test-setup/vitest-parity.test.ts`

## Remaining workspaces (future migration slices)

Every workspace now runs its full suite under Bun (see the bespoke runners for
`cli`, `core`, `agents`, `auth` and the shared runner for the rest, including
`lsp`).
`settings`, `ide-integration`, `vscode-ide-companion`, `a2a-server`, `policy`,
`telemetry`, `test-utils`, `scripts/tests`, `evals` and `integration-tests`
were migrated by #2847, which also deleted their `vitest.config.ts` files.

## Enumerated Vitest retention (acceptance criterion #8)

Two categories exist. The first still executes; the second does not execute at
all.

**Still executes:**

1. **`packages/storage` `test:vitest`** — the `secure_store_backend` job (and
   its nightly twin) needs the two backend-specific configs
   (`vitest.config.native-keyring.ts`, `vitest.config.fallback-behavior.ts`)
   to force a keyring backend per leg.

2. **`packages/test-utils/src/quota-guard-vitest-integration.test.ts`** —
   spawns `vitest run` subprocesses to test Vitest's own runtime semantics.
   A meta-test of the runner, not an application test. Note that the
   production quota hook it once mirrored now lives in
   `integration-tests/setup-quota-guard.ts` and always throws under Bun, so
   this file no longer characterises the shipped behaviour.

**Does not execute:**

3. **Per-workspace `test:vitest` scripts** — `auth`, `lsp`, `mcp`,
   `providers`, `storage` and `tools` keep one as an escape hatch. No
   workflow and no `test` script invokes them. `packages/core` has none: its
   script was removed with the Bun exclusion list (issue #2968). `packages/cli`
   migrated fully to Bun under #2843 and has no Vitest selection at all.

4. **The `vitest` import specifier** — migrated test files still import
   `describe`/`it`/`expect` from `'vitest'`, which Bun resolves through its
   own injected handler. `vitest` therefore stays in `devDependencies`.

## Canonical Bun-native test command

```bash
# All native Bun test files (discovery-based, all non-credentialed roots):
bun scripts/run_bun_tests.ts

# A specific workspace:
bun scripts/run_bun_tests.ts --workspace telemetry

# List what would run without executing (--dry-run):
bun scripts/run_bun_tests.ts --dry-run
```

For the full repository test suite (including the storage Vitest leg and the
quota-guard Vitest-integration meta-test):

```bash
npm run test
```

## Test API

Tests import `bun:test` directly; no compatibility layer is installed. The
helpers Bun does not provide - `waitFor`, the async fake-timer wrappers,
`setEnv`/`setGlobal` and `automock` - come from
`@vybestack/llxprt-code-test-utils`, and `bun-test-corrections.d.ts` supplies
the one correction Bun's own type declarations need.

See `dev-docs/bun.md` for the mocking rules, in particular that a `vi.mock`
registration only applies within the file that declares it.
