# Revision 06: Addressing Review-06 Issues

Reviewer: plan-revision-agent
Date: 2026-06-08
Review Reference: `project-plans/issue1588/reviews/review-06.md`

## Summary

All 9 material issues and 8 pedantic improvements from review-06 have been addressed with concrete plan changes. No production source code was modified.

## Material Issue Mapping

### MI-1: Fix impossible P05a pass gate

- **Review Issue**: P05a required P04b core integration test to pass before core adapter implementation (P06), making it impossible.
- **Already addressed**: P05a already explicitly states the P04b pass gate is NOT run in P05a (deferred to P06a). Verified P05a semantic checklist item and verification commands confirm this. No change needed — the plan already handles this correctly per the existing text at `plan/05a-settings-package-impl-verification.md` lines explaining the P04b pass gate is NOT run in P05a.
- **Plan files changed**: None (already correct in plan). Added explicit note to `plan/05a` verification checklist reinforcing this.

### MI-2: Fix P04b core test target

- **Review Issue**: P04b core integration test targeted nonexistent ConfigBaseCore.settingsServiceInstance wiring.
- **Fix**: Updated P04b to target the actual production path: `configConstructor` → `activateSettingsRuntimeContext` (adapter) → `registerSettingsService` (settings-package singleton). Removed all references to ConfigBaseCore.settingsServiceInstance. Added explicit "Why NOT ConfigBaseCore.settingsServiceInstance" note.
- **Plan files changed**: `plan/04b-vertical-slice-integration-tdd.md`

### MI-3: Replace adapter bridge prose/grep scan with enforcing script

- **Review Issue**: P06 adapter bridge scan was prose/grep listing, not an enforcing check.
- **Fix**: Replaced prose bridge scan with a deterministic Node.js script that exits nonzero on violations. The script finds files importing registerSettingsService/resetSettingsService, then checks if they also import runtime-context functions, failing if any violation is found. Added ordinary-settings-reads-allowed clarification. Updated P06, P06a verification commands.
- **Plan files changed**: `plan/06-core-integration-stub.md`, `plan/06a-core-integration-stub-verification.md`

### MI-4: Fix CLI Vitest alias instructions

- **Review Issue**: CLI Vitest alias instructions were incomplete/inconsistent with provider precedent.
- **Fix**: Updated P03b to specify that CLI vitest.config.ts uses workspaceAliasPlugin with resolveTsSource for .js-to-.ts conversion, exactly matching the providers/core precedent. Root alias resolves to `../settings/index.ts` (source entrypoint), subpaths resolve through `../settings/src/` with resolveTsSource conversion. Added explicit grep verification commands.
- **Plan files changed**: `plan/03b-minimal-adapter-wiring.md`

### MI-5: Specify root build/script updates

- **Review Issue**: Build ordering and root scripts (build.js, schema/docs scripts) were under-specified for settings building before core/providers/CLI.
- **Fix**: Added explicit root build ordering verification section to P03b with commands to inspect scripts/build.js, verify settings builds before consumers, check predocs:settings, and identify hard-coded package lists. Added build ordering verification to P05a and phase-verification-matrix. Updated package-metadata-constraints with concrete verification commands.
- **Plan files changed**: `plan/03b-minimal-adapter-wiring.md`, `plan/05a-settings-package-impl-verification.md`, `analysis/phase-verification-matrix.md`, `analysis/package-metadata-constraints.md`

### MI-6: Replace non-enforcing `|| true` forbidden-import scans

- **Review Issue**: Several scan commands used `|| true`, allowing failures to be hidden.
- **Fix**: Replaced all `|| true` in enforcing scans with capture-and-check-empty or fail-on-nonempty logic. Scans that document expected-zero results now use `VARIABLE=$(rg ... 2>/dev/null || true); test -z "$VARIABLE" && echo OK || { echo FAIL; echo "$VARIABLE"; exit 1; }` pattern. Updated across all phase verification commands, anti-shim-policy, dependency-audit, and P09/P10 verification sections.
- **Plan files changed**: `analysis/anti-shim-policy.md`, `analysis/dependency-audit.md`, `analysis/phase-verification-matrix.md`, `plan/09-cleanup-no-shims.md`, `plan/10a-final-semantic-review.md`, `plan/05-settings-package-impl.md`, `plan/05a-settings-package-impl-verification.md`, `plan/10-full-verification.md`, `plan/04b-vertical-slice-integration-tdd-verification.md`

### MI-7: Add root settings type exports to no-shim blocklist/scans

- **Review Issue**: No-shim scans missed current core root settings type exports (ISettingsService, GlobalSettings, etc.).
- **Fix**: Added all listed type exports to anti-shim-policy forbidden patterns, P09 cleanup scans, and phase-verification-matrix. Added explicit root-barrel settings type scan commands.
- **Plan files changed**: `analysis/anti-shim-policy.md`, `plan/09-cleanup-no-shims.md`, `analysis/phase-verification-matrix.md`, `plan/10a-final-semantic-review.md`

### MI-8: Resolve LLXPRT_CONFIG_DIR/memoryTool coupling

- **Review Issue**: Plan did not concretely resolve LLXPRT_CONFIG_DIR/memoryTool coupling for storage extraction.
- **Fix**: Added explicit LLXPRT_CONFIG_DIR resolution to P06 implementation tasks and P06a verification. Settings Storage keeps its own `LLXPRT_DIR = '.llxprt'` constant. Core configBaseCore defines its own local constant. Added required tests proving identical paths without cross-package imports.
- **Plan files changed**: `plan/06-core-integration-stub.md`, `plan/06a-core-integration-stub-verification.md`

### MI-9: Add deterministic workspace graph checks

- **Review Issue**: No deterministic check proving settings has no forbidden deps and no cycles.
- **Fix**: Added deterministic Node.js DFS cycle-detection scripts to dependency-audit, P05a, P06a, P08a, P09a, P10a verification commands. Scripts check both forbidden deps and cycle detection.
- **Plan files changed**: `analysis/dependency-audit.md`, `plan/05a-settings-package-impl-verification.md`, `plan/06a-core-integration-stub-verification.md`, `plan/08a-consumer-migration-impl-verification.md`, `plan/09a-cleanup-no-shims-verification.md`, `plan/10a-final-semantic-review.md`, `plan/10-full-verification.md`

## Pedantic Improvement Mapping

### PI-1: Export map style verification

- **Fix**: Added explicit export map style verification requirement to package-metadata-constraints and phase-verification-matrix P03 scaffold checklist.
- **Plan files changed**: `analysis/package-metadata-constraints.md`, `analysis/phase-verification-matrix.md`

### PI-2: P04/P04a expected-failure capture

- **Fix**: Added explicit expected-failure output capture commands to P04a verification and P04b verification. Commands capture output to temp file and assert no module resolution errors present.
- **Plan files changed**: `plan/04a-settings-package-tdd-verification.md`, `plan/04b-vertical-slice-integration-tdd-verification.md`

### PI-3: Concrete file:../settings dependency metadata

- **Fix**: Added concrete dependency specifications with section to package-metadata-constraints downstream table. Each package now lists `"@vybestack/llxprt-code-settings": "file:../settings"` in `dependencies` section.
- **Plan files changed**: `analysis/package-metadata-constraints.md`

### PI-4: Import inventory counts in markers

- **Fix**: Added import inventory count format to P08 prerequisite (already present) and execution-tracker completion markers.
- **Plan files changed**: `plan/08-consumer-migration-impl.md`, `execution-tracker.md`

### PI-5: Lockfile verification after workspace registration

- **Fix**: Added explicit lockfile diff/no-unrelated-churn verification to P03 scaffold requirements and phase-verification-matrix.
- **Plan files changed**: `plan/03-decoupling-stub.md`, `analysis/phase-verification-matrix.md`

### PI-6: a2a-server dependency clarification

- **Fix**: Added explicit a2a-server dependency clarification to dependency-audit (already present but expanded), package-metadata-constraints downstream table, and consumer-import-matrix.
- **Plan files changed**: `analysis/dependency-audit.md`, `analysis/package-metadata-constraints.md`, `analysis/consumer-import-matrix.md`

### PI-7: Post-build core/dist stale export scans

- **Fix**: Added post-build stale export scans to P06a (pre-check with note), P08a, P09a, P10, and P10a. Scans check core dist JS and declarations for moved settings/Storage/ProfileManager/modelParams symbols.
- **Plan files changed**: `plan/06a-core-integration-stub-verification.md`, `plan/08a-consumer-migration-impl-verification.md`, `plan/09a-cleanup-no-shims-verification.md`, `plan/10-full-verification.md`, `plan/10a-final-semantic-review.md`

### PI-8: Preflight full modelParams symbol list

- **Fix**: Added explicit preflight modelParams symbol list requirement to preflight-results-template.
- **Plan files changed**: `analysis/preflight-results-template.md`

## Files Modified

| Plan File | Changes |
|-----------|---------|
| `plan/00-overview.md` | Updated key behavioral contracts; added references to deterministic graph checks, LLXPRT_CONFIG_DIR resolution, enforcing bridge scan, CLI vitest alias strategy, build ordering |
| `plan/03-decoupling-stub.md` | Added lockfile diff verification to P03 scaffold requirements |
| `plan/03b-minimal-adapter-wiring.md` | Fixed CLI Vitest alias instructions with resolveTsSource; added root build ordering verification section |
| `plan/04a-settings-package-tdd-verification.md` | Added expected-failure output capture commands |
| `plan/04b-vertical-slice-integration-tdd.md` | Fixed test target to configConstructor/runtime adapter; removed ConfigBaseCore.settingsServiceInstance; added explicit production path specification; added expected-failure output assertions |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | Added expected-failure output verification commands |
| `plan/05-settings-package-impl.md` | Replaced `|| true` scans with enforcing capture-and-check-empty |
| `plan/05a-settings-package-impl-verification.md` | Removed P04b pass gate (confirmed already absent); added deterministic workspace graph check; added build ordering verification; replaced `|| true` scans |
| `plan/06-core-integration-stub.md` | Replaced prose bridge scan with enforcing Node.js script; added LLXPRT_CONFIG_DIR resolution task; added LLXPRT_DIR tests |
| `plan/06a-core-integration-stub-verification.md` | Updated bridge scan to enforcing script; added LLXPRT_DIR test verification; added post-build stale export pre-check; added deterministic workspace graph check |
| `plan/07-consumer-migration-tdd.md` | No changes (already has expected-failure capture) |
| `plan/08-consumer-migration-impl.md` | Import inventory count format added to prerequisites (was already there); no substantive change needed |
| `plan/08a-consumer-migration-impl-verification.md` | Added deterministic workspace graph check; added post-build stale export scan |
| `plan/09-cleanup-no-shims.md` | Added root settings type exports to blocklist/scans; replaced `|| true` with enforcing logic |
| `plan/09a-cleanup-no-shims-verification.md` | No changes needed (already had enforcing scans) |
| `plan/10-full-verification.md` | Added deterministic workspace graph verification; added post-build stale export scans; replaced `|| true` scans |
| `plan/10a-final-semantic-review.md` | Added deterministic workspace graph check; added post-build stale export scans; added root settings type exports to scans; replaced `|| true` scans |
| `analysis/anti-shim-policy.md` | Added root settings type exports to forbidden patterns and scan commands; replaced `|| true` with enforcing logic |
| `analysis/dependency-audit.md` | Added LLXPRT_CONFIG_DIR resolution; added a2a-server clarification; added deterministic workspace graph checks; replaced `|| true` in forbidden import scans |
| `analysis/phase-verification-matrix.md` | Updated multiple phase verification commands with enforcing scan logic, deterministic graph checks, build ordering, root settings type exports, LLXPRT_DIR tests, post-build stale export scans |
| `analysis/package-metadata-constraints.md` | Added export map style verification, concrete file:../settings dependency metadata, lockfile diff verification, a2a-server clarification, build ordering verification |
| `analysis/settings-move-map.md` | Added LLXPRT_CONFIG_DIR resolution to Storage move map |
| `analysis/behavioral-regression-matrix.md` | Enhanced BVE-05 with explicit LLXPRT_DIR test requirements |
| `analysis/consumer-import-matrix.md` | Added a2a-server clarification |
| `analysis/final-architecture.md` | Added LLXPRT_CONFIG_DIR resolution section with test requirements |
| `analysis/integration-contract.md` | No substantive changes (already correct) |
| `analysis/preflight-results-template.md` | Added modelParams symbol list requirement |
| `execution-tracker.md` | Updated completion markers with new items |
