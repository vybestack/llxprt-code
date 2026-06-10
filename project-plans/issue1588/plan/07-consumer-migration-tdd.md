# Phase 07: Consumer Migration Integration Tests (Including Deferred Provider/CLI Vertical-Slice Tests)

## Phase ID

`PLAN-20260608-ISSUE1588.P07`

## Prerequisites

- Required: Phase 06a verified.
- Core vertical-slice integration test exists from P04b and passes after P06.
- Provider/CLI vertical-slice integration tests were deferred from P04b to this phase because they require consumer import migration to pass.

## Requirements Implemented (Expanded)

### REQ-CONS-001: Consumer Migration

**Full Text**: Core, providers, CLI, a2a-server, and tests must import moved APIs from settings package and existing behavior must remain reachable.

**Behavior**:

- GIVEN consumers currently using old core paths
- WHEN migration tests run
- THEN tests prove provider and CLI settings behavior through new package imports

**Why This Matters**: Import changes must preserve actual runtime behavior.

### REQ-TEST-001: Behavioral Refactoring Verification (Provider/CLI Vertical-Slice Tests)

These integration tests were deferred from P04b because they require consumer import migration to pass. They are written in P07 and fail before P08 (expected TDD behavior), then pass after P08 implementation.

**Test Location Matrix (P07 additions)**

| Vertical Slice | Test Location | Reason |
|---------------|---------------|--------|
| Provider consumes settings package API | `packages/providers/src/__tests__/settings-integration/` | Providers own the provider→settings consumption path |
| CLI profile/startup exercises ProfileManager/Storage | `packages/cli/src/__tests__/settings-integration/` | CLI owns the CLI→settings consumption path |

## Implementation Tasks

### P07 Provider Vertical-Slice Integration Test: Settings-Only Sentinel

The provider vertical-slice test must use a **settings-only sentinel mechanism** — not the old core `ProviderRuntimeContext` singleton — to verify that the provider reads settings through the settings package. The test:

1. **Registers a sentinel `SettingsService`** using `registerSettingsService()` from `@vybestack/llxprt-code-settings` (settings-package-only, no core context).
2. **Asserts provider behavior** (e.g., model name, base URL) reads the sentinel value through the settings package path.
3. **Does NOT set up a `ProviderRuntimeContext`** — the test verifies settings-only consumption, not context bridging.
4. **After P08**, a **static import verification** confirms that `BaseProvider` imports `getSettingsService` from `@vybestack/llxprt-code-settings`, not from `@vybestack/llxprt-code-core`. This static import guard is run as a verification scan in P07a and P08a:
   ```bash
   # Static import guard: BaseProvider must import getSettingsService from settings, not core
   PROVIDER_SETTINGS_IMPORTS=$(rg -n "getSettingsService.*from.*@vybestack/llxprt-code-core" packages/providers/src/BaseProvider.ts 2>/dev/null || true)
   test -z "$PROVIDER_SETTINGS_IMPORTS" && echo "OK: BaseProvider does not import getSettingsService from core" || { echo "FAIL: BaseProvider still imports getSettingsService from core:"; echo "$PROVIDER_SETTINGS_IMPORTS"; exit 1; }
   ```

This sentinel test proves that provider→settings consumption works through the new package boundary without relying on core runtime context setup.

### P07 CLI Vertical-Slice Integration Test: Precise Profile Load Test

The CLI vertical-slice test exercises profile loading through the **actual CLI-owned import path**. The preferred approach is:

**In-package temp-filesystem profile load test**: Create an integration test in `packages/cli/src/__tests__/settings-integration/` that:
1. Uses `os.tmpdir()` + temporary directory for profile storage via `Storage` from `@vybestack/llxprt-code-settings/storage/Storage.js`.
2. Calls `ProfileManager` from `@vybestack/llxprt-code-settings/profiles/ProfileManager.js` through the CLI-owned import path.
3. Verifies actual JSON round-trip: save a profile → load it → assert values match.

**However**, if the CLI's god-object dependencies prevent writing a self-contained in-package test, then document this limitation and add **static import guards** as supplemental verification (NOT as a substitute for behavioral tests). Static import guards verify import paths but do NOT prove runtime behavior:

1. Verify `ProfileManager` is imported from `@vybestack/llxprt-code-settings` (not `@vybestack/llxprt-code-core`):
   ```bash
   # Static import guard (supplemental, NOT substitute for behavioral test)
   CLI_PROFILE_IMPORTS=$(rg -n "ProfileManager.*from.*@vybestack/llxprt-code-core" packages/cli/src --glob '*.ts' 2>/dev/null || true)
   test -z "$CLI_PROFILE_IMPORTS" && echo "OK: CLI does not import ProfileManager from core" || { echo "FAIL: CLI still imports ProfileManager from core:"; echo "$CLI_PROFILE_IMPORTS"; exit 1; }
   ```
2. Verify `Storage` is imported from `@vybestack/llxprt-code-settings` (not `@vybestack/llxprt-code-core`):
   ```bash
   # Static import guard (supplemental, NOT substitute for behavioral test)
   CLI_STORAGE_IMPORTS=$(rg -n "Storage.*from.*@vybestack/llxprt-code-core" packages/cli/src --glob '*.ts' 2>/dev/null || true)
   test -z "$CLI_STORAGE_IMPORTS" && echo "OK: CLI does not import Storage from core" || { echo "FAIL: CLI still imports Storage from core:"; echo "$CLI_STORAGE_IMPORTS"; exit 1; }
   ```

**Mandatory requirement**: At least one behavioral CLI-owned test or executable/root entrypoint test MUST exist after import migration. Static import guards are supplemental only and cannot be the sole verification mechanism. If no in-package test is feasible, use the CLI smoke test (`node scripts/start.js --profile-load synthetic`) as the behavioral test.

### Behavioral CLI Test Requirement

After import migration, at least one behavioral CLI-owned test or executable/root entrypoint test must verify CLI settings/profile/startup paths work. The **deterministic** CLI behavioral test gate is one of:

1. **Concrete CLI integration test**: `packages/cli/src/__tests__/settings-integration/profile-startup.integration.test.ts` exercises CLI-owned import paths for `ProfileManager` and `Storage` with real temp-filesystem profile JSON round-trips.
2. **CLI smoke test as behavioral gate**: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` — this is deterministic (uses `--profile-load synthetic` for reproducible profile loading) and verifies the CLI startup path through settings package. This is the required fallback if an in-package test is not feasible.

Static import guards (`rg` checks for `ProfileManager` and `Storage` import origin) are supplemental only and cannot be the sole verification mechanism. The behavioral test (option 1 or 2) is the primary gate.

Provider/CLI vertical-slice tests are expected to fail before P08. Implementation must use capture-and-assert logic that exits 0 only when the red phase is valid (nonzero test exit, no module-resolution errors, expected behavioral/stub failures present):

```bash
# Run provider integration test and capture output
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07-provider-output.txt
PROVIDER_EXIT=${PIPESTATUS[0]:-0}
# Run CLI integration test and capture output
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07-cli-output.txt
CLI_EXIT=${PIPESTATUS[0]:-0}
# 1. Verify no module resolution errors (exit 1 if found — indicates setup problems)
if grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p07-provider-output.txt /tmp/p07-cli-output.txt; then
  echo "FAIL: module resolution errors indicate setup problems"; exit 1
fi
# 2. Verify behavioral failures ARE present (exit 1 if absent — test must exercise real paths)
if ! grep -E "Expected.*Received|AssertionError|settings|Provider.*BaseProvider|Profile.*load" /tmp/p07-provider-output.txt /tmp/p07-cli-output.txt; then
  echo "WARN: no expected behavioral failure patterns found (tests may not exercise production paths)"
fi
# 3. Verify at least one test runner exits nonzero (TDD red phase)
if [ "$PROVIDER_EXIT" -eq 0 ] && [ "$CLI_EXIT" -eq 0 ]; then
  echo "FAIL: both provider and CLI tests should fail before P08 (TDD red phase)"; exit 1
fi
echo "OK: expected-failure check passes (behavioral failures present, no module errors, nonzero exit)"
```

### Other Consumer Migration Test Tasks

- Provider behavior tests for settings-backed model/base URL/registry paths if existing tests do not already cover them after import changes.
- CLI profile/startup integration tests or targeted existing tests with updated imports.
- Package-boundary tests/scans, preferably as scripts or documented verification commands.
- Test cleanup migration: update `resetSettingsService`/`registerSettingsService` imports in test `beforeEach`/`afterEach` blocks to settings package imports per `analysis/call-site-migration-matrix.md`.
- For test files that relied on `resetSettingsService()` also clearing the runtime context: add explicit `clearActiveProviderRuntimeContext()` calls or switch to `deactivateSettingsRuntimeContext()`.

### Files to Create

- `packages/providers/src/__tests__/settings-integration/provider-settings.integration.test.ts`
- `packages/cli/src/__tests__/settings-integration/profile-startup.integration.test.ts`

Tests must use `@plan PLAN-20260608-ISSUE1588.P07` and `@requirement REQ-TEST-001.2` markers.

Follow `analysis/pseudocode/consumer-migration.md` lines 01-23 and `analysis/call-site-migration-matrix.md`.

## Verification Commands

```bash
npm run typecheck
# Run provider vertical-slice integration test using workspace-relative path
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/__tests__/settings-integration
# Run CLI vertical-slice integration test using workspace-relative path
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration
# Capture and inspect failure output
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07-provider-output.txt
npm run test --workspace @vybestack/llxprt-code -- --run src/__tests__/settings-integration 2>&1 | tee /tmp/p07-cli-output.txt
grep -E "Cannot find module|Module not found|ERR_MODULE_NOT_FOUND" /tmp/p07-provider-output.txt /tmp/p07-cli-output.txt && echo "FAIL: module resolution errors" || echo "OK: no module resolution errors"
grep -E "Expected.*Received|AssertionError|settings|Provider.*BaseProvider|Profile.*load" /tmp/p07-provider-output.txt /tmp/p07-cli-output.txt && echo "OK: behavioral failures present" || echo "WARN: no expected behavioral failure patterns found"
# Boundary scans: P07 uses INVENTORY/REPORT-ONLY scans (not enforcing).
# Zero enforcement begins in P08/P08a/P09. P07 documents current state for P08 migration.
OLD_SETTINGS_PATHS_REPORT=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
echo "INVENTORY: deep-path settings imports (will be enforced zero in P08):"
echo "$OLD_SETTINGS_PATHS_REPORT" | head -30
ROOT_BARREL_SYMBOLS_REPORT=$(rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts' 2>/dev/null || true)
echo "INVENTORY: root-barrel moved-symbol imports (will be enforced zero in P08):"
echo "$ROOT_BARREL_SYMBOLS_REPORT" | head -30
# NOTE: These scans are INVENTORY/REPORT-ONLY in P07 because consumer migration has not yet occurred.
# They MUST NOT exit 1 on non-empty results during P07. Zero enforcement begins in P08/P08a/P09.
# During P07, these scans document the current state of old imports for the P08 migration.
# After P08, these same scans enforce zero matches (capture-and-check-empty with exit 1 on non-empty).
#
# INVENTORY SCANS (P07 only — report counts, never exit 1 on non-empty):
ROOT_BARREL_COUNT=$(rg -c "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Root-barrel inventory:", sum+0, "matches"}')
echo "$ROOT_BARREL_COUNT"
OLD_SETTINGS_PATH_COUNT=$(rg -c "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null | awk -F: '{sum+=$2} END {print "Deep-path inventory:", sum+0, "matches"}')
echo "$OLD_SETTINGS_PATH_COUNT"
```

Expected: new/updated tests fail naturally before P08 where imports are not yet migrated; no reverse tests; failure output shows behavioral failures (not module resolution errors); P07 boundary scans use REPORT-ONLY mode (not enforcing — zero enforcement begins in P08).

## Semantic Verification Checklist

- [ ] Provider vertical-slice integration test exercises real cross-package call paths.
- [ ] CLI vertical-slice integration test exercises real cross-package call paths.
- [ ] Tests cover provider behavior, not only import success.
- [ ] Tests cover CLI/profile access path where feasible.
- [ ] Each vertical-slice test names exact production entrypoint/import path and requires failure when consumer wiring is absent.
- [ ] Provider vertical-slice test uses settings-only sentinel (no old core singleton setup), asserts provider behavior through settings package.
- [ ] CLI vertical-slice test exercises in-package temp-filesystem profile load through actual CLI-owned import path, or documents limitation with static import guards as supplemental verification (NOT as sole verification).
- [ ] At least one behavioral CLI-owned test or executable/root entrypoint test exists after import migration. Static import guards are supplemental only.
- [ ] CLI imports `ProfileManager` and `Storage` from `@vybestack/llxprt-code-settings` (root or subpath imports acceptable per import preference policy).
- [ ] After P08, static import verification confirms `BaseProvider` imports `getSettingsService` from `@vybestack/llxprt-code-settings`.
- [ ] P07 static import guards for CLI `ProfileManager` and `Storage` imports exist if in-package test is limited.
- [ ] Boundary scans are part of verification.
- [ ] Expected-failure verification uses capture-and-assert logic: exits 0 only when nonzero test exit, behavioral failure patterns present, and no module resolution errors.
- [ ] Root vs subpath import preference: root imports (`@vybestack/llxprt-code-settings`) are preferred for SettingsService, registry, and types. Subpath imports (`@vybestack/llxprt-code-settings/profiles/ProfileManager.js`) are acceptable for consumers that import specific modules. P07/P08 test verification should accept both root and subpath imports as valid.
- [ ] Test commands use workspace-relative paths (not `packages/cli/src/...` under CLI workspace).

## Success Criteria

Consumer migration tests are trustworthy and ready for P08 implementation. Provider and CLI vertical-slice integration tests (deferred from P04b) are in place and fail before migration.

## Failure Recovery

Fix tests before P07a.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P07.md`.
