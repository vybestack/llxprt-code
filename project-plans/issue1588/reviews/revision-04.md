# Revision 04: Addressing Review-04 Issues

## Review Verdict Addressed: FAIL → PASS (all material issues resolved, pedantic items addressed where feasible)

## Material Issue-to-Fix Mapping

### M1: P04b vertical-slice tests cannot compile in providers/CLI

**Review issue**: P04b requires providers/CLI tests importing `@vybestack/llxprt-code-settings`, but P03b only adds settings dependency/path alias to core.

**Fix**: Added providers AND CLI dependency + tsconfig path alias + vitest workspace alias setup to P03b (not deferred to P04b or P08).

**Files modified**:
- `plan/03b-minimal-adapter-wiring.md` — Added "Add Settings Dependency + Path Aliases in Providers AND CLI" section; added 6 new files to modify list (providers/CLI package.json, tsconfig.json, vitest.config.ts); expanded verification commands to cover providers/CLI compilation; expanded semantic checklist with providers/CLI alias/dependency checks.
- `plan/03b-minimal-adapter-wiring-verification.md` — Added providers/CLI typecheck and alias grep commands; added semantic checklist items for providers/CLI aliases/dependencies.
- `analysis/package-metadata-constraints.md` — Added explicit "When: P03b" timing to providers and CLI tsconfig sections.

### M2: Runtime context/settings lifecycle double-registration/reset

**Review issue**: final-architecture says providerRuntimeContext set/clear syncs settings, while settingsRuntimeAdapter also calls register/reset around set/clear. Contradictory double-registration semantics.

**Fix**: Chose ONE owner: `settingsRuntimeAdapter.ts` is the sole bridge. `providerRuntimeContext.ts` does NOT import or call settings-package functions. This eliminates double-registration.

**Files modified**:
- `analysis/final-architecture.md` — Rewrote "Singleton/Runtime-Context Replacement Semantics" to add "Lifecycle single-owner resolution" section defining 4 rules; updated "Core-owned adapter for context creation" to explicitly state providerRuntimeContext stays agnostic; added SOLE BRIDGE comment to adapter code example.
- `plan/06-core-integration-stub.md` — Changed `providerRuntimeContext.ts` file modification from "import registerSettingsService/resetSettingsService" to "DO NOT add imports of settings functions"; added explicit single-owner rule; added "Adapter Permitted Bridge Scan" section with concrete scan logic and bridge-call classification table (production bridge, test cleanup, mock, settings-only, context-only).
- `plan/06a-core-integration-stub-verification.md` — Added bridge scan commands; added semantic checklist items for providerRuntimeContext not importing settings functions and bridge scan passing.
- `analysis/call-site-migration-matrix.md` — Added SOLE BRIDGE comments to replacement helper code; added "Adapter Permitted Bridge Scan Logic" section with classification table and concrete scan commands.
- `analysis/integration-contract.md` — Added explicit statement that providerRuntimeContext.ts does NOT import settings-package functions; updated IC-02 behavioral change section.
- `analysis/behavioral-regression-matrix.md` — Added scenario 5 to BVE-06c (providerRuntimeContext.ts does NOT import settings functions); added adapter permitted bridge scan reference to idempotency section.
- `analysis/pseudocode/settings-service.md` — Revised lines 16-17 to note adapter ownership and providerRuntimeContext agnosticism.
- `execution-tracker.md` — Added completion markers for providerRuntimeContext not importing settings functions and bridge scan passing.

### M3: Settings package test commands omit nested profiles/storage tests

**Review issue**: P04/P05 verification only runs `src/__tests__`, missing `src/profiles/__tests__` and `src/storage/__tests__`.

**Fix**: Changed all settings package test commands from `--run src/__tests__` to `--run` (recursive, discovers all nested test directories). Added explicit test directory creation to P03 scaffold.

**Files modified**:
- `plan/04-settings-package-tdd.md` — Changed test command from `--run src/__tests__` to `--run`; noted nested test discovery in expected output.
- `plan/05-settings-package-impl.md` — Changed test command to `--run`; added note about nested profile/storage tests.
- `plan/05a-settings-package-impl-verification.md` — Implicitly covered (test command already `--run`).
- `plan/03-decoupling-stub.md` — Added empty `src/profiles/__tests__/` and `src/storage/__tests__/` directory creation to scaffold; added vitest recursive discovery config requirement.
- `plan/04a-settings-package-tdd-verification.md` — Added test directory discovery verification command.
- `analysis/phase-verification-matrix.md` — Updated P04 row to note nested test discovery.
- `analysis/preflight-results-template.md` — Added blocking issue for test command discovering nested directories.
- `execution-tracker.md` — Added completion marker for settings package test command running nested tests.

### M4: P04b vertical-slice tests risk becoming test-only wiring

**Review issue**: Integration tests need exact production entrypoint/function/class names and import paths; must fail when consumer wiring is absent.

**Fix**: Added explicit production entrypoint, import path, and failure condition to each of the 3 P04b vertical slices.

**Files modified**:
- `plan/04b-vertical-slice-integration-tdd.md` — Added "Production entrypoint exercised", "Settings import exercised", and "Failure condition" bullets for all 3 slices; added general requirement that each test must fail if production consumer wiring is absent.
- `plan/04b-vertical-slice-integration-tdd-verification.md` — Added semantic checklist items for exact production entrypoint and failure-when-wiring-absent requirements.
- `analysis/phase-verification-matrix.md` — Updated P04b row with entrypoint/naming requirements.
- `execution-tracker.md` — Added completion marker for vertical-slice entrypoint naming and failure conditions.

### M5: P03/P03b package scaffold requirements too vague

**Review issue**: P03 doesn't explicitly list all required scaffold artifacts for a new workspace package.

**Fix**: Added exhaustive explicit scaffold checklist to P03 with 9 numbered requirement categories.

**Files modified**:
- `plan/03-decoupling-stub.md` — Replaced vague "Create settings package scaffold" with detailed "Explicit Settings Package Scaffold Requirements" section covering: (1) package.json (with forbidden deps in both dependencies AND devDependencies), (2) tsconfig.json, (3) index.ts, (4) src layout, (5) vitest.config.ts, (6) workspace registration, (7) compilation verification, (8) package test command availability, (9) forbidden dependency/import checks. Includes empty test directory creation for nested test discovery.
- `plan/03a-decoupling-stub-verification.md` — Expanded verification commands and semantic checklist to cover scaffold completeness.
- `analysis/pseudocode/package-boundary.md` — Added lines for devDependencies check, nested test directory creation, pnpm-lock verification, all-consumer alias timing.
- `execution-tracker.md` — Added completion marker for P03 scaffold checklist.

### M6: Adapter single-owner scan under-specified

**Review issue**: Need concrete scan logic distinguishing production bridge calls, test cleanup, and mocks; conflicts with providerRuntimeContext behavior.

**Fix**: Added concrete adapter permitted bridge scan logic with classification table (5 call types). Resolved by making providerRuntimeContext.ts settings-agnostic.

**Files modified**:
- `plan/06-core-integration-stub.md` — Added "Adapter Permitted Bridge Scan" section with concrete scan commands and classification table.
- `analysis/call-site-migration-matrix.md` — Added "Adapter Permitted Bridge Scan Logic" section with classification table and commands.
- `analysis/behavioral-regression-matrix.md` — Added adapter permitted bridge scan reference.
- `analysis/phase-verification-matrix.md` — Updated P06/P06a rows with bridge scan requirements.

### M7: Settings package boundary checks should scan tests/configs/metadata

**Review issue**: Boundary checks only scan `packages/settings/src`, missing test files, configs, package.json dependencies/devDependencies.

**Fix**: Extended all boundary scan commands to cover `packages/settings/**/*.ts(x)`, package.json (both dependencies and devDependencies), tsconfig.json, vitest.config.ts.

**Files modified**:
- `plan/05-settings-package-impl.md` — Extended verification commands to scan all `packages/settings/**/*.ts(x)`, package.json dependencies+devDependencies; added schema/docs early check; added semantic checklist items.
- `plan/05a-settings-package-impl-verification.md` — Extended scan commands; added semantic checklist items.
- `analysis/package-metadata-constraints.md` — Added extended file-glob scan command; devDependencies explicit check in Node script.
- `analysis/phase-verification-matrix.md` — Updated P05/P05a rows with extended boundary check requirements.
- `analysis/pseudocode/verification.md` — Added lines 29a-29b for extended boundary checks.
- `execution-tracker.md` — Added completion marker for extended boundary checks.

## Pedantic Issue-to-Fix Mapping

### P1: P05 prerequisite typo "Phase 04ba" → "Phase 04b"

**Files modified**:
- `plan/05-settings-package-impl.md` — Changed "Phase 04ba verified" to "Phase 04b verified".
- `execution-tracker.md` — Added completion marker noting typo fix.

### P2: Export map style alignment with providers precedent

**Fix**: Added explicit justification for using richer `{types, import}` objects in settings subpath exports while some providers subpaths use simpler strings.

**Files modified**:
- `analysis/consumer-import-matrix.md` — Added "Export map justification" paragraph in Import Style Decision section.

### P3: SettingsService source layout consistency

**Fix**: Made explicit that `SettingsService.ts` lives at `src/settings/SettingsService.ts` (not `src/SettingsService.ts`), consistent with subpath export paths.

**Files modified**:
- `analysis/final-architecture.md` — Updated component ownership table target paths; added source layout consistency paragraph.
- `analysis/settings-move-map.md` — Updated target paths for SettingsService, settingsRegistry, settingsServiceInstance, and settingsRegistry test file.

### P4: CLI god-object deferral inventory

**Fix**: Added concrete deferred inventory table naming exact CLI files and reasons.

**Files modified**:
- `plan/00-overview.md` — Added "CLI God-Object Deferral Inventory" section with table of 5 CLI areas and deferral reasons.
- `analysis/dependency-audit.md` — Added "CLI God-Object Deferral Audit" section with same inventory.

### P5: Lockfile/no pnpm-lock verification

**Fix**: Added explicit lockfile verification commands after every workspace/dependency change.

**Files modified**:
- `analysis/package-metadata-constraints.md` — Added "Lockfile/no pnpm-lock verification" subsection with concrete bash commands and required phases.
- `analysis/pseudocode/package-boundary.md` — Added line 24 for pnpm-lock verification.
- `analysis/pseudocode/verification.md` — Added line 31a for lockfile verification.
- `analysis/phase-verification-matrix.md` — Added P10 lockfile/no pnpm-lock verification requirement.
- `plan/03-decoupling-stub.md` — Added lockfile verification to verification commands.
- `plan/03b-minimal-adapter-wiring.md` — Added lockfile verification to semantic checklist.
- `plan/09-cleanup-no-shims.md` — Added lockfile verification to verification commands and semantic checklist.
- `plan/09a-cleanup-no-shims-verification.md` — Added lockfile verification.
- `plan/10-full-verification.md` — Added lockfile verification section and semantic checklist item.
- `execution-tracker.md` — Added completion marker for lockfile verification.

### P6: Run schema/doc checks earlier

**Fix**: Schema/docs verification must run after any phase that touches CLI schema imports or tsconfig/vitest aliases. Moved from P10-only to P05, P05a, and P10. Added to phase verification matrix.

**Files modified**:
- `plan/05-settings-package-impl.md` — Added schema/docs verification commands.
- `plan/05a-settings-package-impl-verification.md` — Added schema/docs verification.
- `analysis/package-metadata-constraints.md` — Updated "Required Verification" with earlier phase requirements.
- `plan/00-overview.md` — Updated generated schema/docs key behavioral contract.
- `analysis/phase-verification-matrix.md` — Updated P05/P05a/P10 rows.
- `execution-tracker.md` — Added completion marker.

### P7: STUB/will-be-implemented comments in production source

**Fix**: Added post-P06 fraud scan requirement. P03b adapter stub comments are explicitly exempted during P03b-P06, but P06 must remove them. After P06, any STUB/will-be-implemented in production source fails the phase.

**Files modified**:
- `analysis/phase-verification-matrix.md` — Added STUB fraud scan to P09 and post-P06 clarification; expanded deferred implementation detection section.
- `plan/09-cleanup-no-shims.md` — Added STUB/fraud scan to verification commands and semantic checklist.
- `plan/09a-cleanup-no-shims-verification.md` — Added STUB/fraud scan to verification commands and semantic checklist.
- `plan/10-full-verification.md` — Added STUB/fraud scan section and semantic checklist item.
- `execution-tracker.md` — Added completion marker.

### P8: Root vs subpath import preference

**Fix**: Made root imports explicitly the default/preferred style; subpath imports require specific justification. Added to overview and consumer-import-matrix.

**Files modified**:
- `analysis/consumer-import-matrix.md` — Updated Import Style Decision to make root imports default/preferred with justification section.
- `analysis/final-architecture.md` — Added import style preference paragraph to Export Map Decision section.
- `plan/00-overview.md` — Updated key behavioral contracts section with import preference.

## Summary of All Files Modified

| File | Material Issues Addressed | Pedantic Issues Addressed |
|------|---------------------------|---------------------------|
| `plan/03b-minimal-adapter-wiring.md` | M1 | P5 |
| `plan/03b-minimal-adapter-wiring-verification.md` | M1 | P5 |
| `plan/03-decoupling-stub.md` | M3, M5 | P5 |
| `plan/03a-decoupling-stub-verification.md` | M5 | P5 |
| `plan/04b-vertical-slice-integration-tdd.md` | M4 | — |
| `plan/04b-vertical-slice-integration-tdd-verification.md` | M4 | — |
| `plan/04a-settings-package-tdd-verification.md` | M3 | — |
| `plan/04-settings-package-tdd.md` | M3 | — |
| `plan/05-settings-package-impl.md` | M7 | P1, P5, P6 |
| `plan/05a-settings-package-impl-verification.md` | M7 | P5, P6 |
| `plan/06-core-integration-stub.md` | M2, M6 | — |
| `plan/06a-core-integration-stub-verification.md` | M2, M6 | — |
| `plan/09-cleanup-no-shims.md` | — | P5, P7 |
| `plan/09a-cleanup-no-shims-verification.md` | — | P5, P7 |
| `plan/10-full-verification.md` | — | P5, P6, P7 |
| `plan/10a-final-semantic-review.md` | — | P5, P6, P7 |
| `plan/00-overview.md` | M2, M4 | P4, P6, P8 |
| `plan/00a-preflight-verification.md` | M3 | — |
| `analysis/final-architecture.md` | M2, M3 | P8 |
| `analysis/call-site-migration-matrix.md` | M2, M6 | — |
| `analysis/behavioral-regression-matrix.md` | M2, M6 | — |
| `analysis/integration-contract.md` | M2 | — |
| `analysis/package-metadata-constraints.md` | M1, M7 | P5, P6 |
| `analysis/consumer-import-matrix.md` | M7 | P2, P8 |
| `analysis/dependency-audit.md` | — | P4 |
| `analysis/settings-move-map.md` | M3 | — |
| `analysis/phase-verification-matrix.md` | M2, M3, M4, M5, M6, M7 | P5, P6, P7 |
| `analysis/pseudocode/package-boundary.md` | M5 | P5 |
| `analysis/pseudocode/settings-service.md` | M2 | — |
| `analysis/pseudocode/verification.md` | M7 | P5 |
| `analysis/preflight-results-template.md` | M3 | — |
| `execution-tracker.md` | M2, M3, M4, M5, M7 | P1, P5, P6, P7 |

**Total files modified**: 32
**Material issues resolved**: 7/7
**Pedantic issues addressed**: 8/8