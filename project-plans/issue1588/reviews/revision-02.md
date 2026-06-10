# Revision-02: Review-02 Issue-to-Fix Mapping

Plan ID: PLAN-20260608-ISSUE1588

## Summary

Every material issue and all feasible pedantic improvements from review-02 have been addressed with concrete plan changes. No production source code was modified. The no-shim/cycle-free architecture is preserved. Plan compliance with PLAN.md, PLAN-TEMPLATE.md, and RULES.md is maintained.

## Material Issues → Plan Changes

### MI-1: Vertical-slice integration tests in packages/settings create forbidden reverse dependencies

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `plan/04b-vertical-slice-integration-tdd.md` | Rewrote: moved all 3 vertical-slice integration tests out of `packages/settings` into owning consumer packages (`packages/core/src/__tests__/settings-integration/`, `packages/providers/src/__tests__/settings-integration/`, root or `packages/cli/src/__tests__/settings-integration/`). Added "Critical Design Decision: Integration Test Ownership" section with test location matrix. Added explicit rule: settings package tests MUST NOT import consumer packages, even as dev-only fixtures. Updated verification commands to verify zero consumer imports in settings. |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | Rewrote: verification commands now check for integration test files in consumer packages (not settings), verify settings has zero consumer imports, and check semantic checklist includes consumer-import-free constraint. |
| `plan/04-settings-package-tdd.md` | Added constraint: settings package tests MUST NOT import consumer packages. Added test naming/location convention table. Added verification command for consumer-import-free check. Added semantic checklist item. |
| `analysis/consumer-import-matrix.md` | Added "Settings Package Test Import Constraint" subsection to Import Style Decision: explicitly forbids consumer imports in settings tests, including dev-only fixtures and vi.mock paths. |
| `analysis/phase-verification-matrix.md` | Updated P04b check: specifies test files must be in owning consumer packages, NOT in `packages/settings`. Updated boundary scans to include settings-to-consumer import check. |
| `analysis/pseudocode/verification.md` | Added lines 28, 33-34: settings package consumer-import-free check, built-runtime import verification. |
| `analysis/pseudocode/verification.md` | Added semantic questions about settings package import freedom and integration test placement. |
| `execution-tracker.md` | Added completion markers for settings-package consumer-import-free check and integration test placement. |

### MI-2: Runtime-context/singleton semantic change under-specified for existing call sites

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/call-site-migration-matrix.md` | **NEW file**: Full call-site migration matrix classifying every call site of `registerSettingsService`, `resetSettingsService`, and `getSettingsService` into 5 categories (SINGLETON, CONTEXT-ACTIVATE, TEST-CLEANUP, PROVIDER-CONTEXT, CONFIG-DELEGATE). Defines core-owned replacement helper (`activateSettingsRuntimeContext` / `deactivateSettingsRuntimeContext`). Lists 5 required behavioral tests for the adapter. Provides per-site migration actions for all 68 call sites. |
| `analysis/final-architecture.md` | Added "Core-Owned Runtime Context Adapter" section with TypeScript pseudocode for `settingsRuntimeAdapter.ts`. Added BVE-06c and BVE-06d to required behavioral tests (adapter behavior, reset-settings-state-only vs full-deactivation). |
| `analysis/integration-contract.md` | Replaced vague adapter language with explicit `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` contract, referencing call-site migration matrix. |
| `analysis/behavioral-regression-matrix.md` | Added BVE-06c (core-owned context creation adapter) and BVE-06d (reset-settings-state-only vs full-deactivation) with scenarios and test locations. |
| `analysis/pseudocode/settings-service.md` | Renumbered lines 18→29, added lines 22-26 for core-owned adapter, configConstructor migration, adapter tests, and reset-settings-state-only test. |
| `plan/06-core-integration-stub.md` | Added "Core-Owned Runtime Context Adapter" implementation task with `settingsRuntimeAdapter.ts` creation. Changed `configConstructor.ts` task to use `activateSettingsRuntimeContext()`. Added 5 required adapter tests. Updated semantic checklist with adapter-specific items. |
| `plan/06a-core-integration-stub-verification.md` | Added semantic checklist items for adapter bridge, deactivate behavior, configConstructor usage, and resetSettingsService scope. |
| `plan/00-overview.md` | Updated Key Behavioral Contracts to reference BVE-06a through BVE-06d and call-site migration matrix. Added `analysis/call-site-migration-matrix.md` to required supporting artifacts. |

### MI-3: P04b sequencing claims integration-first but depends on un-migrated consumers

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `plan/04b-vertical-slice-integration-tdd.md` | Added "P04b Sequencing Clarification" section. Resolves the contradiction: P04b integration tests use the same import paths that P06/P07/P08 will establish as production paths (via tsconfig path aliases). No artificial test-only wiring needed. Explicitly documents phase ownership: P04b (tests in consumers using stubs via planned paths) → P05 (implement settings) → P06 (minimal core wiring) → P07 (consumer migration TDD) → P08 (consumer migration impl). |

### MI-4: Settings package public export map not concrete enough

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/package-metadata-constraints.md` | Replaced "Export Map Requirements" with "Decision: Root-Plus-Subpaths Export Map". Made subpath exports mandatory in `package.json`. Added full `exports` map JSON. Added "Built Runtime Import Verification" section with Node.js script to verify all 7 export paths resolve after build. Required in P05a, P08a, P10. |
| `analysis/final-architecture.md` | Replaced vague "Subpath exports may be added" with "Export Map Decision: Root-Plus-Subpaths" section. Made subpath exports mandatory. Added generated schema/docs ownership clarification. |
| `analysis/phase-verification-matrix.md` | Updated P05 and P10 checks to include built-runtime import verification. Updated boundary scans to include export path verification. |
| `analysis/pseudocode/verification.md` | Added line 27: built-runtime import verification for all documented exports. |
| `plan/05a-settings-package-impl-verification.md` | Added built-runtime import verification script to verification commands. |
| `plan/10-full-verification.md` | Added settings package export path verification section with Node.js script and consumer-import-free check. Added generated schema/docs script verification. |
| `execution-tracker.md` | Added completion markers for mandatory subpath exports and built-runtime import verification. |
| `plan/00-overview.md` | Added export map and settings test constraint to Key Behavioral Contracts. |

## Pedantic Improvements → Plan Changes

### PI-1: Fix duplicate pseudocode line numbers

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/pseudocode/package-boundary.md` | Fixed duplicate line numbers: old 17→18→17→18→19→20→21→22 renumbered to 17→18→19→20→21→22→23→24. |
| `analysis/pseudocode/settings-service.md` | Fixed duplicate line 21 (was used for both "TEST settings-isolation" and "EXPORT..."). Renumbered: lines 21→29, added new lines 22-26 for adapter/tests. |
| `analysis/pseudocode/verification.md` | Fixed duplicate line 28/29 (was 28, 28, 29). Renumbered to 29, 30, 31. |

### PI-2: Clarify whether settings package tests may use consumer packages as dev-only fixtures

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/consumer-import-matrix.md` | Added explicit "Settings Package Test Import Constraint" that forbids consumer imports in settings tests, including dev-only fixtures and vi.mock paths. |
| `plan/04-settings-package-tdd.md` | Added constraint section and verification command. |
| `plan/04b-vertical-slice-integration-tdd.md` | Added "Settings Package Test Constraint" and "Critical Design Decision: Integration Test Ownership" sections. |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | Added semantic checklist items for consumer-import-free check. |
| `execution-tracker.md` | Added completion marker. |

### PI-3: Make generated settings schema/docs ownership more explicit

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/package-metadata-constraints.md` | Rewrote "Generated Schema/Docs Scripts" section. Documented: scripts import from CLI-owned `settingsSchema.js` (not settings registry), CLI schema stays in CLI, scripts are root-owned, scripts do NOT move. Added verification commands for `npm run schema:settings` and `npm run docs:settings`. |
| `analysis/final-architecture.md` | Added "Generated Settings Schema/Docs Ownership" section under Public API Surface. Clarified ownership boundary between CLI schema and settings registry. |
| `plan/00-overview.md` | Added generated schema/docs ownership to Key Behavioral Contracts. |
| `plan/10-full-verification.md` | Added generated schema/docs script verification section. |

### PI-4: Clarify test naming/location conventions after moving P04b tests

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `plan/04-settings-package-tdd.md` | Added "Test Naming And Location Conventions" table with per-test-type locations (SettingsService, Registry, ProfileManager, Storage, Singleton helpers) in settings package `__tests__` directories. |

### PI-5: Add built-runtime verification for imports

**Files changed:**

| Plan File | Change |
|-----------|--------|
| `analysis/package-metadata-constraints.md` | Added "Built Runtime Import Verification" section with Node.js script. |
| `analysis/phase-verification-matrix.md` | Added to P05, P10 checks and boundary scans. |
| `plan/05a-settings-package-impl-verification.md` | Added verification script. |
| `plan/10-full-verification.md` | Added verification section. |
| `analysis/pseudocode/verification.md` | Added line 27. |

## Files Modified (Complete List)

| # | File | Type |
|---|------|------|
| 1 | `analysis/call-site-migration-matrix.md` | NEW |
| 2 | `plan/04b-vertical-slice-integration-tdd.md` | REWRITTEN |
| 3 | `plan/04b-vertical-slice-integration-tdd-verification.md` | REWRITTEN |
| 4 | `analysis/final-architecture.md` | MODIFIED |
| 5 | `analysis/integration-contract.md` | MODIFIED |
| 6 | `analysis/behavioral-regression-matrix.md` | MODIFIED |
| 7 | `analysis/pseudocode/package-boundary.md` | MODIFIED (line number fix) |
| 8 | `analysis/pseudocode/settings-service.md` | MODIFIED (line number fix + adapter pseudocode) |
| 9 | `analysis/pseudocode/verification.md` | MODIFIED (line number fix + new verification steps) |
| 10 | `analysis/package-metadata-constraints.md` | MODIFIED |
| 11 | `analysis/consumer-import-matrix.md` | MODIFIED |
| 12 | `plan/06-core-integration-stub.md` | MODIFIED |
| 13 | `plan/06a-core-integration-stub-verification.md` | MODIFIED |
| 14 | `plan/00-overview.md` | MODIFIED |
| 15 | `plan/04-settings-package-tdd.md` | MODIFIED |
| 16 | `plan/05-settings-package-impl.md` | MODIFIED |
| 17 | `plan/05a-settings-package-impl-verification.md` | MODIFIED |
| 18 | `plan/07-consumer-migration-tdd.md` | MODIFIED |
| 19 | `plan/07a-consumer-migration-tdd-verification.md` | MODIFIED |
| 20 | `plan/08-consumer-migration-impl.md` | MODIFIED |
| 21 | `plan/08a-consumer-migration-impl-verification.md` | MODIFIED |
| 22 | `plan/09-cleanup-no-shims.md` | MODIFIED |
| 23 | `plan/10-full-verification.md` | MODIFIED |
| 24 | `analysis/phase-verification-matrix.md` | MODIFIED |
| 25 | `execution-tracker.md` | MODIFIED |
| 26 | `reviews/revision-02.md` | NEW |

## Architecture Invariants Preserved

- **No-shim**: Core does not re-export moved APIs. `modelParams.ts` fully deleted in P09.
- **Cycle-free**: Settings never imports core/providers/CLI/tools. Graph: settings → (external only), core → settings, providers → settings + core, CLI → settings + core + providers.
- **No `packages/storage` invention**: Storage stays in `packages/settings/src/storage/`.
- **Consumer-package-owned integration tests**: No reverse dependency from settings test suite.
- **Core-owned adapter for context creation**: Only core can create `ProviderRuntimeContext`; settings cannot.