# Revision 01: Review-01 Issue-to-Plan Mapping

Plan ID: PLAN-20260608-ISSUE1588
Revised: 2026-06-08
Review: `reviews/review-01.md`

## Summary

All 8 material issues and 7 pedantic improvements from review-01 have been addressed. Files were modified or created under `project-plans/issue1588/` only. No production source code was changed.

## Material Issue Mapping

### Material Issue 1: Root-barrel imports of moved symbols not inventoried or blocked

**Review finding**: No inventory or migration rules for root imports of moved symbols (`SettingsService`, `ProfileManager`, `Storage`, `Profile`, `ModelParams`, etc.) from `@vybestack/llxprt-code-core`.

**Plan changes**:
- `analysis/consumer-import-matrix.md` — Added "Root-Barrel Import Inventory" table listing all 17+ moved symbols, their current core-root consumers, and migration actions. Added root-barrel import scan command. Added section "Scans For Moved Profile/Model Type Imports From Core". Expanded Verification Matrix with root-barrel moved-symbol scan, dynamic import/vi.mock scan.
- `analysis/dependency-audit.md` — Extended "Forbidden Import Scans" with root-barrel moved-symbol scan, moved profile/model type import scan, vi.mock/dynamic import scan.
- `analysis/anti-shim-policy.md` — Extended "Forbidden Patterns" to include core root re-exports of moved profile/model types. Extended "Forbidden Scan Commands" with root-barrel re-export scan, consumer moved-type import scan, core relative profileManager import scan.
- `analysis/phase-verification-matrix.md` — Added root-barrel moved-symbol import scan and vi.mock/dynamic import path scan to Boundary Scans.
- `plan/07-consumer-migration-tdd.md` — Added root-barrel and vi.mock scans to Verification Commands.
- `plan/08-consumer-migration-impl.md` — Added root-barrel and vi.mock scans to Verification Commands.
- `plan/09-cleanup-no-shims.md` — Added root-barrel import scan and dynamic import/vi.mock scan to Verification Commands. Extended semantic checklist for root-barrel imports.
- `plan/10a-final-semantic-review.md` — Added root-barrel, modelParams, and dependency graph scans to Verification Commands and Semantic Verification Checklist.
- `specification.md` — Added REQ-CONS-001.4 (root-barrel migration), REQ-CONS-001.5 (vi.mock paths), REQ-CONS-001.6 (modelParams deletion).

### Material Issue 2: Profile/model parameter type ownership under-specified

**Review finding**: No definition of final state for `packages/core/src/types/modelParams.ts`, core root/deep exports, or moved profile/model types.

**Plan changes**:
- `analysis/settings-move-map.md` — Added "Final State Of `packages/core/src/types/modelParams.ts`" section declaring entire file is deleted. Added "Core Export Removal For Moved Types" section. Added scan commands for moved type imports from core.
- `analysis/final-architecture.md` — Added "Final State Of `modelParams.ts`" subsection under Profile Type Ownership: entire file deleted, all symbols move to settings, no core re-exports.
- `analysis/anti-shim-policy.md` — Added `packages/core/src/types/modelParams.ts` remaining as forbidden pattern. Added `./types/modelParams.js` subpath export to forbidden list. Added modelParams deletion and type re-export scans.
- `plan/09-cleanup-no-shims.md` — Added `modelParams.ts` deletion, core index export removal, package.json subpath export removal to task list. Added `test ! -f packages/core/src/types/modelParams.ts` and modelParams scan commands to verification. Extended semantic checklist with modelParams-specific items.
- `analysis/pseudocode/profile-storage.md` — Lines 04-06 now explicitly state `modelParams.ts` deletion and core export removal.
- `specification.md` — Added `packages/core/src/types/modelParams.ts` to "Existing Code To Be Replaced Or Removed". Added REQ-CONS-001.6.

### Material Issue 3: Core internal `ProfileManager` consumers not sufficiently analyzed

**Review finding**: Missing `subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts` from core consumer matrix.

**Plan changes**:
- `analysis/consumer-import-matrix.md` — Added `subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts` to "Core Files To Inspect/Migrate". Added "Core Relative Import Scan For ProfileManager" scan command.
- `analysis/dependency-audit.md` — Extended Blocker 3 with explicit list of additional core internal ProfileManager consumers and resolution steps.
- `plan/06-core-integration-stub.md` — Extended "Files to Modify" list with all four files.
- `plan/06a-core-integration-stub-verification.md` — Extended scan to include `config/profileManager` relative imports. Extended semantic checklist with ProfileManager consumer migration items.
- `analysis/pseudocode/profile-storage.md` — Line 14 explicitly lists core internal ProfileManager consumers to update.
- `analysis/pseudocode/consumer-migration.md` — Line 06 explicitly lists core internal ProfileManager consumers.

### Material Issue 4: Settings singleton/runtime-context replacement semantics unclear

**Review finding**: Current `registerSettingsService` creates `ProviderRuntimeContext` when none exists; new settings package cannot create core objects. Replacement semantics and behavioral tests not specified.

**Plan changes**:
- `analysis/final-architecture.md` — Added "Singleton/Runtime-Context Replacement Semantics" section with current behavior analysis, target behavior specification, core-owned adapter contract, and 5 explicit behavioral test scenarios.
- `analysis/integration-contract.md` — IC-02 contract expanded with explicit contract terms stating settings `registerSettingsService` stores service ONLY, does NOT create `ProviderRuntimeContext`. Behavioral change documented. Verification references BVE-06a/BVE-06b.
- `analysis/behavioral-regression-matrix.md` — Added BVE-06a (Register-Before-Context Semantics) and BVE-06b (Context Activation Updates Settings) with concrete test scenarios.
- `plan/06-core-integration-stub.md` — Expanded REQ-SVC-001 requirement text with semantic change documentation and behavioral test references. Extended semantic verification checklist with 8 items including register-before-context and context-activation-updates-settings.
- `analysis/pseudocode/settings-service.md` — Lines 10-21 rewritten with exact replacement semantics: settings `registerSettingsService` stores only, core adapter calls it, explicit test scenarios for register-before-context, context-activation-updates-settings, context-clearing-resets-settings, settings-isolation.

### Material Issue 5: TDD sequencing not compliant (P07 after P05)

**Review finding**: Settings package implemented in P05 before consumer migration integration tests in P07, violating PLAN.md integration-first requirement.

**Plan changes**:
- Created `plan/04b-vertical-slice-integration-tdd.md` — New phase for vertical-slice integration TDD with 3 slices: core config consumes settings stubs, provider consumes settings API, CLI profile/startup exercises ProfileManager/Storage.
- Created `plan/04b-vertical-slice-integration-tdd-verification.md` — Verification phase for P04b.
- `plan/05-settings-package-impl.md` — Prerequisites changed from "Phase 04a verified" to "Phase 04ba verified (vertical-slice integration TDD verified)".
- `plan/00-overview.md` — Total Phases updated to 12. Added "Key Behavioral Contracts" section noting P04b.
- `specification.md` — Project Structure updated with new phases. REQ-TEST-001.2 expanded to reference vertical-slice integration tests.
- `execution-tracker.md` — Added P04b and P04ba rows.

### Material Issue 6: No-shim cleanup scans miss profile/model types and root imports

**Review finding**: P09 scans don't cover moved type exports (`Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `isLoadBalancerProfile`) or root-level moved symbols.

**Plan changes**:
- `analysis/anti-shim-policy.md` — Extended "Forbidden Patterns" with modelParams.ts file, type-specific re-exports, package.json subpath export. Extended "Forbidden Scan Commands" with 6 new scan commands for type re-exports, consumer type imports, core relative profileManager imports. Extended "Expected final state" with 3 new items.
- `plan/09-cleanup-no-shims.md` — Extended "Files to Remove/Modify" with modelParams.ts deletion, type export removals, type re-export removals. Extended verification commands with 6 new scan commands. Extended semantic checklist with 4 new items.

### Material Issue 7: Package metadata/tsconfig/vitest alias updates not concrete

**Review finding**: "If needed" language for tsconfig/vitest alias updates is insufficient; providers has specific patterns that must be replicated.

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Added "Downstream Package tsconfig.json and Vitest Alias Updates" subsection with explicit tsconfig paths and vitest config changes for providers, core, and CLI packages, with verification commands.
- `analysis/pseudocode/package-boundary.md` — Lines 16-17 now explicitly require tsconfig path aliases and vitest workspace source alias plugin entries for settings in downstream packages.
- `plan/08-consumer-migration-impl.md` — "Files to Modify" now explicitly lists tsconfig.json, vitest.config.ts updates for providers/core/CLI. Extended semantic checklist with alias verification items.

### Material Issue 8: P03 typecheck failure allowed

**Review finding**: P03 allows typecheck to fail, undermining stub phase purpose. Stubs must compile.

**Plan changes**:
- `plan/03-decoupling-stub.md` — Changed verification expected from "typecheck passes or fails only with documented stubs" to "typecheck MUST pass". Changed success criteria to include explicit typecheck pass requirement.
- `plan/03a-decoupling-stub-verification.md` — Added `npm run typecheck` to verification commands. Expected now includes "typecheck passes (stubs compile)".
- `analysis/phase-verification-matrix.md` — P03 check updated to "**typecheck MUST pass**".

## Pedantic Improvement Mapping

### Pedantic 1: Clarify package manager language

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Added "Package manager clarification" paragraph to Lockfile Requirement section: explicitly states this plan uses npm consistently, warns against pnpm install.
- `specification.md` — Expanded Package Manager field with npm/pnpm clarification.
- `plan/00-overview.md` — Added "Package Manager Clarification" paragraph to Explicit Scope Boundaries.
- `analysis/pseudocode/package-boundary.md` — Line 13 now says "use `npm`, not pnpm".

### Pedantic 2: Use exact export-map convention from providers

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Changed root export key from `"default"` to `"import"` in the settings package metadata template. Added explicit note about matching providers convention.
- `analysis/pseudocode/package-boundary.md` — Line 06 now specifies "root export uses `import` not `default`, matching providers".

### Pedantic 3: Add explicit scans for old relative imports in mocks and dynamic imports

**Plan changes**:
- `analysis/consumer-import-matrix.md` — Added "Dynamic Import And Mock Path Scan" section with vi.mock and dynamic import scan commands.
- `analysis/dependency-audit.md` — Added vi.mock and dynamic import path scan to Forbidden Import Scans.
- `analysis/anti-shim-policy.md` — Included vi.mock and dynamic import scan commands in extended scan section.
- `analysis/preflight-results-template.md` — Added "Dynamic Import And vi.mock Path Inventory" section.
- `analysis/pseudocode/consumer-migration.md` — Added anti-pattern warnings for vi.mock and dynamic import paths.
- Multiple plan verification commands updated to include vi.mock/dynamic import scans.

### Pedantic 4: Narrow zod dependency to actual moved need

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Changed settings production deps from "zod, if profile auth schemas..." to "zod — verified required: AuthConfigSchema in modelParams.ts uses zod for runtime validation; this file moves to settings."
- `analysis/pseudocode/package-boundary.md` — Line 20 added zod verification step.

### Pedantic 5: Add explicit generated-doc/schema follow-up checks

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Added "Generated Schema/Docs Scripts" section with script inventory command and migration requirement.
- `analysis/preflight-results-template.md` — Added "Root-Script Inventory" section.
- `analysis/pseudocode/package-boundary.md` — Line 21 added docs/schema script verification.

### Pedantic 6: Strengthen full verification with package-boundary dependency graph checks

**Plan changes**:
- `analysis/package-metadata-constraints.md` — Added "Package Boundary Dependency Graph Checks" section with Node.js graph check script, to run after P05/P08/P09.
- `analysis/phase-verification-matrix.md` — P10 now includes "package boundary graph checks pass".

### Pedantic 7: Clarify test naming expectations (.test.ts vs .spec.ts)

**Plan changes**:
- `plan/04b-vertical-slice-integration-tdd.md` — Semantic checklist item: "Test file naming uses `.test.ts` or `.spec.ts` consistent with repo."
- `plan/04b-vertical-slice-integration-tdd-verification.md` — Semantic checklist item: "Test file naming uses `.test.ts` or `.spec.ts` consistent with repo."
- `plan/10a-final-semantic-review.md` — Semantic checklist item: "Test file extensions match repo convention (`.test.ts` and `.spec.ts` used appropriately)."
- `analysis/pseudocode/consumer-migration.md` — Added anti-pattern warning about not assuming one test extension exclusively.

## Files Modified/Created

| File | Action | Review Issues Addressed |
|------|--------|------------------------|
| `analysis/consumer-import-matrix.md` | Modified | M1, M3, P3 |
| `analysis/settings-move-map.md` | Modified | M2 |
| `analysis/anti-shim-policy.md` | Modified | M1, M2, M6, P3 |
| `analysis/final-architecture.md` | Modified | M2, M4 |
| `analysis/integration-contract.md` | Modified | M4 |
| `analysis/behavioral-regression-matrix.md` | Modified | M4 |
| `analysis/dependency-audit.md` | Modified | M1, M3, P3 |
| `analysis/package-metadata-constraints.md` | Modified | M7, P1, P2, P4, P5, P6 |
| `analysis/phase-verification-matrix.md` | Modified | M1, M6, M8, P6 |
| `analysis/pseudocode/settings-service.md` | Modified | M4 |
| `analysis/pseudocode/profile-storage.md` | Modified | M2, M3 |
| `analysis/pseudocode/consumer-migration.md` | Modified | M1, M7, P3, P7 |
| `analysis/pseudocode/verification.md` | Modified | M1, M2, P6 |
| `analysis/pseudocode/package-boundary.md` | Modified | M7, P1, P2, P4, P5 |
| `analysis/preflight-results-template.md` | Modified | M1, M3, P3, P5 |
| `plan/00-overview.md` | Modified | M5, P1 |
| `plan/03-decoupling-stub.md` | Modified | M8 |
| `plan/03a-decoupling-stub-verification.md` | Modified | M8 |
| `plan/04b-vertical-slice-integration-tdd.md` | Created | M5 |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | Created | M5, P7 |
| `plan/05-settings-package-impl.md` | Modified | M5 |
| `plan/06-core-integration-stub.md` | Modified | M3, M4 |
| `plan/06a-core-integration-stub-verification.md` | Modified | M3, M4 |
| `plan/07-consumer-migration-tdd.md` | Modified | M1 |
| `plan/08-consumer-migration-impl.md` | Modified | M1, M7, P3 |
| `plan/09-cleanup-no-shims.md` | Modified | M1, M2, M6 |
| `plan/10-full-verification.md` | Modified | M6, P6 |
| `plan/10a-final-semantic-review.md` | Modified | M1, P6, P7 |
| `specification.md` | Modified | M1, M2, M5, P1 |
| `execution-tracker.md` | Modified | M5 |

Legend: M=N = Material Issue N, P=N = Pedantic Improvement N