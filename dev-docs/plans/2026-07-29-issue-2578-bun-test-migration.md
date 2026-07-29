# Issue #2578: Migrate all remaining repository tests to direct Bun execution

## Status: SLICE 1 of N (bounded vertical slice)

This is a large migration (~2,025 vitest test files across 13 remaining
workspaces + scripts/tests + evals + integration-tests). It cannot be completed
in a single PR within the scope budget (40 files / 2,500 lines). This document
defines the acceptance matrix, non-goals, bounded vertical slices, and scope
ledger.

## Acceptance Matrix

| #   | Behavior                                                       | Evidence                                                      |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| AC1 | Inventory accounts for every repository test file              | `dev-docs/test-runner-inventory.md`                           |
| AC2 | Standard full test command runs all tests under Bun            | `npm run test` → workspace test scripts use `bun test`        |
| AC3 | No migrated test is launched by Vitest or needs precompiled JS | Workspace test scripts use `bun test` directly on .ts files   |
| AC4 | Existing test coverage preserved (no silent drops/skips)       | Pass/fail counts match between vitest and bun per workspace   |
| AC5 | Workspace setup, pretest guards, JUnit, coverage functional    | bunfig.toml preload + junit reporter configured per workspace |
| AC6 | CI runs complete Bun-native suite on required platforms        | CI workflow updated; fails if test file omitted from manifest |
| AC7 | Compatibility helpers linked to concrete tests                 | Each shim addition references the test file that needs it     |
| AC8 | Remaining Vitest usage enumerated and proven unrelated         | Documented in inventory                                       |
| AC9 | One canonical command for complete suite                       | Documented in CONTRIBUTING.md and dev-docs/bun.md             |

## Explicit Non-Goals

1. Implementing complete behavioral parity with Vitest.
2. Supporting hypothetical or pathological API inputs not used by repository tests.
3. Creating a reusable third-party Vitest emulation library.
4. Refactoring production code unrelated to enabling a concrete test under Bun.
5. Removing Vitest from non-test tooling (e.g. evals, integration-tests, scripts
   that spawn nested vitest processes).
6. Removing the `vitest` devDependency from root package.json — it remains
   needed for evals, integration-tests, and the quota-guard-vitest-integration
   acceptance test.

## Bounded Vertical Slices

### Slice 1 (THIS PR): Telemetry + test-utils + compat shim fix

**Scope:** Fix `vi.clearAllTimers()` compatibility gap, migrate the two smallest
remaining workspaces (telemetry: 11 files, test-utils: 5 files), build the
checked-in inventory, and update manifest + documentation.

**Rationale:** These are the smallest workspaces and exercise the compat shim
under real conditions before tackling larger ones. The shim fix is required
by 15 test files across the repo.

**Files changed:** ~15 files (within 40-file budget)

### Slice 2 (FUTURE PR): ide-integration (10) + vscode-ide-companion (6) + storage (24)

### Slice 3 (FUTURE PR): settings (13) + mcp (46)

### Slice 4 (FUTURE PR): tools (62) + auth (37)

### Slice 5 (FUTURE PR): agents (348)

### Slice 6 (FUTURE PR): core (322)

### Slice 7 (FUTURE PR): providers (478) + cli (650)

### Slice 8 (FUTURE PR): scripts/tests (97) + evals (2) + integration-tests (26)

## Scope Ledger

| Item                           | Status   | Notes                                     |
| ------------------------------ | -------- | ----------------------------------------- |
| vi.clearAllTimers compat fix   | Slice 1  | Used by 15 test files                     |
| telemetry workspace migration  | Slice 1  | 11 test files                             |
| test-utils workspace migration | Slice 1  | 5 test files (1 vitest-specific retained) |
| Checked-in inventory           | Slice 1  | dev-docs/test-runner-inventory.md         |
| bun-test-manifest update       | Slice 1  | Add telemetry + test-utils entries        |
| Documentation update           | Slice 1  | dev-docs/bun.md                           |
| Remaining 11 workspaces        | Deferred | ~1,996 files - future PRs                 |
| scripts/tests (97 files)       | Deferred | Future PR                                 |
| evals (2 files)                | Deferred | Future PR                                 |
| integration-tests (26 files)   | Deferred | Future PR                                 |

## Enumerated Vitest Retention (AC8)

The following Vitest usage is retained and proven unrelated to repository test
suite execution:

1. **`packages/test-utils/src/quota-guard-vitest-integration.test.ts`** — This
   test proves the quota-guard's vitest-specific acceptance semantics (skip on
   retry, preserve original failure) by spawning real nested `vitest` processes.
   It is a vitest acceptance test, not a repository unit test. It must run under
   vitest because it tests vitest itself.

2. **`evals/`** — Uses `vitest.config.ts` for eval runs. Separate from the
   repository test suite.

3. **`integration-tests/`** — End-to-end tests using vitest. Separate from the
   repository unit test suite.

4. **`scripts/tests/`** — Script harness tests including vitest config tests and
   orchestrator smoke tests. Deferred to a future slice.

## Review Finding Classification Policy

- **Blocker-Fix**: Must fix before merge (test failures, CI breakage)
- **In-scope-Fix**: Fix in this PR if within scope budget
- **Reject**: Out of scope or factually incorrect
- **Defer**: Valid but belongs in a future slice
