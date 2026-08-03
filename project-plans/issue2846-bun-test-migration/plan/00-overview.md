# Plan Overview: Migrate tools, mcp, storage to Bun-native test execution

## Plan ID

`PLAN-20260803-ISSUE2846`

## Issue

GitHub #2846 — Migrate tools, mcp, and storage workspaces to Bun-native test
execution (#2578 sub-issue).

## Verified Repository Facts (branch `issue2846`)

### Test file counts (vitest-importing)

| Workspace | Verified Count | Issue stated |
|-----------|---------------|--------------|
| tools     | 65            | 62           |
| mcp       | 43            | 46           |
| storage   | 27            | 24           |
| **Total** | **135**       | 132          |

The acceptance criterion is every vitest-importing test file regardless of
count drift.

### Special-pattern files requiring refactoring

| Pattern | File | Details |
|---------|------|---------|
| vi.resetModules + vi.doMock/doUnmock | `packages/tools/src/utils/ast-grep-utils.lazy.test.ts` | 1 file, uses vi.resetModules in afterEach + vi.doMock/vi.doUnmock for ast-grep native grammar |
| vi.resetModules + vi.stubEnv | `packages/storage/src/secure-store/secure-store.fallback.test.ts` | 2 vi.resetModules calls for XDG_DATA_HOME env re-import |
| resolves.not.toThrow | `packages/mcp/src/auth/token-storage/file-token-storage.test.ts` | line 493 |
| vi.mock (tools) | 6 files | exa-web-search, direct-web-fetch, codesearch, memoryTool, fileUtils, shell-helpers-schema |
| vi.mock (mcp) | 23 files | auth + client test files |
| vi.mock (storage) | 3 files | storage.agentsSecurity, storage, fileSystemService |

### SecureStore CI tests

Two vitest config files select SecureStore-specific test subsets with special
CI environment requirements:
- `vitest.config.native-keyring.ts` → `secure-store.native-keyring.test.ts`
- `vitest.config.fallback-behavior.ts` → `secure-store.fallback-behavior.test.ts`
  + `provider-key-storage.fallback.test.ts`

These run in the `secure_store_backend` CI job with dbus/gnome-keyring on
Linux. They stay on vitest via `test:vitest` because they need config-file
test selection and special CI env.

### Existing infrastructure (already in place)

- `test-setup/augment-bun-vi.ts` — Vitest API compatibility layer for Bun
- `scripts/run_bun_tests.ts` — per-file isolated process orchestrator
- `scripts/bun-test-manifest.ts` — explicit file allowlist per workspace
- `packages/*/test-setup-storage-isolation.ts` — exists in all three target
  packages already
- Root `bunfig.toml` with hoisted linker config

### Established migration pattern (from telemetry, providers, a2a-server)

1. Create `bunfig.toml` with `augment-bun-vi.ts` preload (+ storage isolation
   preload)
2. Change package.json `test`/`test:ci` to `bun run_bun_tests.ts`, keep
   `test:vitest` as fallback
3. Add workspace entry to `bun-test-manifest.ts` with all test files + preload
4. Refactor unsupported API usages (vi.resetModules, vi.doUnmock, etc.)
5. Verify test count parity

## Phases

This migration follows a test-infrastructure-first approach (not feature TDD).
There are no stubs or production code to write. The phases are:

| Phase | Title | Description |
|-------|-------|-------------|
| P01 | Preflight | Capture vitest baseline (test counts, pass/fail), verify all files |
| P02 | Config + manifest | Create bunfig.toml, update package.json scripts, add manifest entries |
| P03 | Pattern refactoring | Refactor vi.resetModules, resolves.not.toThrow, vi.doMock/doUnmock |
| P04 | Storage CI wiring | Update secure_store_backend CI job for vitest fallback path |
| P05 | Bun execution + parity | Run all three workspaces under Bun, verify parity |
| P06 | Full verification | Lint, typecheck, format, build, full test suite |

## Scope Boundaries

### In scope

- All 135 vitest-importing test files in tools/mcp/storage
- package.json script changes in 3 workspaces
- bunfig.toml creation in 3 workspaces
- bun-test-manifest.ts additions for 3 workspaces
- Pattern refactoring for vi.resetModules/resolves.not.toThrow/vi.doMock
- secure_store_backend CI job script update (exact execution needed)
- Test files that import `vi` from `'vitest'` in helper files
  (e.g., `oauthProviderTestSetup.ts`) — these work under Bun's vitest
  interception automatically

### Out of scope (REJECT if proposed)

- Any production source code changes
- Any dependency changes (add/remove/version)
- Any public API abstractions
- Any unrelated refactors or adjacent cleanup
- Any workflow changes beyond the exact CI execution for these 3 workspaces
- Newly skipped tests
- ESLint/TypeScript suppression directives
- Loosened lint/complexity/source-size rules
- test-d.ts typecheck files (these are vitest typecheck-only, not runtime
  tests; they stay in vitest.config.ts typecheck config)

## Deliverable

One PR containing all changes, with `Fixes #2846` or `Closes #2846`.
