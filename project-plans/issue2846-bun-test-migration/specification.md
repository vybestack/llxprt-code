# Feature Specification: Migrate tools, mcp, and storage workspaces to Bun-native test execution

## Plan ID

`PLAN-20260803-ISSUE2846`

## Purpose

Migrate every test file that currently imports from `vitest` in the
`packages/tools`, `packages/mcp`, and `packages/storage` workspaces to
Bun-native test execution, delivered in a single PR. This is a test-
infrastructure migration: no production behavior changes, no new features.
The goal is that the `test` npm script in each of the three workspaces
runs `bun test` (via the `scripts/run_bun_tests.ts` orchestrator) instead
of `vitest run`, with vitest retained only as a `test:vitest` fallback.

## Parent issue

Sub-issue of #2578 (Migrate all remaining repository tests to direct Bun
execution).

## Issue number drift

The issue body states 62 tools / 46 mcp / 24 storage = 132 test files.
Verified repository counts (this branch) are:

- **tools**: 65 vitest-importing test files
- **mcp**: 43 vitest-importing test files
- **storage**: 27 vitest-importing test files
- **Total**: 135 test files

The acceptance criterion is **every** vitest-importing test file in these
three workspaces, regardless of count drift. The count is evidence of
completeness, not a hard scope limit.

## Architectural Decisions

- **Pattern**: Vitest-compatibility layer via Bun's built-in `vitest` module
  interception + `test-setup/augment-bun-vi.ts` preload augmentation
- **Orchestration**: `scripts/run_bun_tests.ts` runs each test file in an
  isolated process, one file at a time (`--max-concurrency 1`)
- **Manifest**: `scripts/bun-test-manifest.ts` explicitly lists every
  migrated file per workspace (explicit allowlist, not glob discovery)
- **Preload**: Each workspace that needs Storage isolation wires a
  `bunfig.toml` `[test].preload` or manifest-level `preload` entry
- **Technology Stack**: Bun (runtime), `bun:test` (test runner), Vitest API
  surface via augment-bun-vi.ts (compatibility)

## Established Migration Pattern (from a2a-server, telemetry, providers)

### What changes per workspace

1. **`bunfig.toml`** created at workspace root:
   ```toml
   [test]
   preload = ["../../test-setup/augment-bun-vi.ts"]
   ```
   Workspaces needing Storage isolation add their preload:
   ```toml
   [test]
   preload = ["../../test-setup/augment-bun-vi.ts", "./test-setup-storage-isolation.ts"]
   ```

2. **`package.json` scripts** updated:
   ```json
   {
     "test": "bun ../../scripts/run_bun_tests.ts --workspace <name> --junit junit.xml",
     "test:bun": "bun ../../scripts/run_bun_tests.ts --workspace <name>",
     "test:ci": "bun ../../scripts/run_bun_tests.ts --workspace <name> --junit junit.xml",
     "test:vitest": "vitest run"
   }
   ```
   (Storage's SecureStore CI tests keep their own script entry — see below.)

3. **`scripts/bun-test-manifest.ts`** updated with the workspace entry listing
   every test file.

4. **Test files**: No import changes needed for files using `import { describe,
     it, expect, vi } from 'vitest'` — Bun's built-in `vitest` interception +
     augment-bun-vi.ts handles this. Files using APIs that augment-bun-vi.ts
     does NOT support (vi.resetModules, vi.doUnmock, vi.unmock) must be
     refactored.

### What does NOT change

- Test assertion logic, test names, test cases
- Production source code
- Dependencies (no additions/removals/version changes)
- vitest.config.ts files (retained for `test:vitest` fallback)

## Formal Requirements

### REQ-001: Bun-native test execution for all in-scope test files

**Full Text**: Every test file in `packages/tools/`, `packages/mcp/`, and
`packages/storage/` that currently imports from `vitest` MUST execute under
Bun's native test runner via the manifest-based orchestrator.

**Behavior**:
- GIVEN: A test file in the three workspaces importing from `'vitest'`
- WHEN: `bun ../../scripts/run_bun_tests.ts --workspace <tools|mcp|storage>` runs
- THEN: That file is listed in the manifest and executes under `bun test`

### REQ-002: Package.json script migration

**Full Text**: The `test` script in all three workspace package.json files
MUST use `bun ../../scripts/run_bun_tests.ts --workspace <name>` (vitest
retained only as `test:vitest` fallback).

### REQ-003: No test dropped, filtered, newly skipped, or deferred

**Full Text**: Every currently-passing vitest test file MUST appear in the
manifest. No test file may be omitted, `.skip`'d that wasn't already
`.skip`'d under vitest, or deferred to a future PR. Pre-existing
`.skip`/`it.skipIf` annotations are preserved as-is.

### REQ-004: vi.resetModules refactoring

**Full Text**: All `vi.resetModules()` usages MUST be refactored to
Bun-compatible patterns. Bun does not support module reset; the
augment-bun-vi.ts layer throws on `vi.resetModules()`. Files using it:

- `packages/tools/src/utils/ast-grep-utils.lazy.test.ts` (1 usage, with
  `vi.doMock`/`vi.doUnmock`)
- `packages/storage/src/secure-store/secure-store.fallback.test.ts` (2 usages,
  with `vi.stubEnv`)

### REQ-005: resolves.not.toThrow rewriting

**Full Text**: All `resolves.not.toThrow()` usages MUST be rewritten to
Bun-compatible assertion patterns. Bun's `expect.resolves` does not support
`.not.toThrow()`. The single usage:

- `packages/mcp/src/auth/token-storage/file-token-storage.test.ts` line 493:
  `await expect(storage.clearAll()).resolves.not.toThrow();`

### REQ-006: vi.mock / vi.doMock migration

**Full Text**: All `vi.mock()` and `vi.doMock()` usages must work under Bun's
augment-bun-vi.ts compatibility layer. The layer intercepts `vi.mock`/`vi.doMock`
and translates them to Bun's `mock.module()`. Known incompatibilities that
require refactoring:

- Async mock factories that use `await import()` inside the factory body
  (deadlock — must use sync `importActualSync` from test-utils or `require`)
- `vi.doUnmock` / `vi.unmock` (throw — unsupported)

Files affected: 6 tools files, 23 mcp files, 3 storage files (vi.mock). The
ast-grep-utils.lazy.test.ts uses vi.doMock+vi.doUnmock+vi.resetModules.

### REQ-007: Storage isolation preloads

**Full Text**: Storage tests require Storage-root isolation before any test
module imports Storage singletons. Under Vitest, `test-setup-storage-isolation.ts`
runs as a `setupFiles` entry. Under Bun, the equivalent must run as a preload
(manifest-level `preload` or `bunfig.toml [test].preload`).

All three target workspaces already have a `test-setup-storage-isolation.ts`
file importing `isolateStorageRoots` from the storage package. The Bun
migration wires this as a preload.

### REQ-008: SecureStore CI configuration preservation

**Full Text**: The SecureStore native-keyring and fallback-behavior tests
have special CI configurations that MUST be preserved:

1. **`secure_store_backend` CI job** (`.github/workflows/ci.yml`):
   - Matrix: ubuntu-latest × {keyring, fallback}
   - keyring mode: installs dbus-x11, gnome-keyring, libsecret-1-0; runs
     inside `dbus-run-session` with a unlocked GNOME keyring
   - Invokes `npm run test:ci --workspace @vybestack/llxprt-code-storage
     -- --config vitest.config.native-keyring.ts` (or fallback-behavior)
   - Reads `SECURE_STORE_MODE` and `KEYRING_PASSWORD` env vars

2. **vitest.config.native-keyring.ts**: includes only
   `secure-store.native-keyring.test.ts`
3. **vitest.config.fallback-behavior.ts**: includes
   `secure-store.fallback-behavior.test.ts` and
   `provider-key-storage.fallback.test.ts`

These two vitest configs must continue to work under the `test:vitest`
fallback script. The CI job that runs them must be updated to use the
appropriate script invocation. Since these are vitest-specific config files
that select a subset of tests with special CI environment requirements
(dbus/gnome-keyring), they stay on vitest via `test:vitest`.

### REQ-009: CI wiring for all three workspaces

**Full Text**: CI must run all three workspaces' tests under Bun on all
required platforms. The `rest` shard in `scripts/test-shards.ts` owns
`tools`, `storage`, `mcp`, and other packages. The CI test job runs
`bun scripts/test.ts --shard rest` which expands to per-workspace test
invocations. Since the workspace `test` scripts are being changed to `bun
../../scripts/run_bun_tests.ts`, the shard runner will automatically invoke
Bun for these workspaces.

The `secure_store_backend` CI job must continue to run the SecureStore
backend tests with its special environment, using the vitest fallback path
since those tests need vitest's config-file selection mechanism.

### REQ-010: Test count parity verification

**Full Text**: After migration, verify test count parity between vitest and
bun for each workspace. The number of passing tests under `bun test` must
match the number under `vitest run` (accounting for pre-existing skips).

## Technical Environment

- **Type**: Monorepo test-infrastructure migration
- **Runtime**: Bun (pinned via `.bun-version`)
- **Test runner**: `bun:test` with Vitest API compatibility
- **Platforms**: ubuntu-latest (PR CI), macOS-latest (PR CI for `rest` shard),
  Windows (nightly only per issue #2876)

## Integration Points

### Existing Code That Will Use This Feature

- `scripts/run_bun_tests.ts` — orchestrator that reads the manifest and spawns
  per-file `bun test` processes
- `scripts/bun-test-manifest.ts` — the manifest file to update with three new
  workspace entries
- `scripts/test.ts` — the shard orchestrator that invokes `npm run test` per
  workspace (will now invoke `bun run_bun_tests.ts` for these workspaces)
- `.github/workflows/ci.yml` — the `rest` shard test job and the
  `secure_store_backend` job

### Existing Code To Be Replaced

- `packages/tools/package.json` `test` script: `vitest run` → bun orchestrator
- `packages/mcp/package.json` `test` script: `vitest run` → bun orchestrator
- `packages/storage/package.json` `test` script: `vitest run` → bun orchestrator

### Files To Create

- `packages/tools/bunfig.toml`
- `packages/mcp/bunfig.toml`
- `packages/storage/bunfig.toml`

### Files To Modify

- `packages/tools/package.json` (scripts)
- `packages/mcp/package.json` (scripts)
- `packages/storage/package.json` (scripts)
- `scripts/bun-test-manifest.ts` (add three workspace entries)
- `.github/workflows/ci.yml` (secure_store_backend job script update)
- Test files needing pattern refactoring (vi.resetModules, resolves.not.toThrow,
  vi.doUnmock)

## Constraints

- No production source code changes
- No dependency additions, removals, or version changes
- No newly skipped tests
- No ESLint/TypeScript suppression directives added
- No lint/complexity/source-size rules loosened
- Single PR containing all three workspaces
- No public API abstractions created
- No unrelated refactors
- No workflow changes beyond exact CI execution needed for these three
  workspaces
