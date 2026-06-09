# Revision 09: Addressing Review-09

## Summary

This revision addresses all 10 material issues and 10 pedantic improvements from review-09. The changes preserve issue #1588 intent (settings extraction with no-shim, cycle-free architecture), the `dev-docs/PLAN.md`/`PLAN-TEMPLATE.md`/`RULES.md` requirements, and the cycle-free dependency direction. No production source code was modified.

## Material Issues Addressed

### 1. Runtime-context ownership made consistent everywhere

**Review issue**: `providerRuntimeContext.ts` may import/construct `SettingsService` — contradictory text across spec/architecture/P06.

**Plan changes**:
- `specification.md` [REQ-SVC-001.2]: Changed "Core-owned adapter code in `providerRuntimeContext.ts` MUST bridge context creation where needed" to explicitly state `providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` or settings-package singleton functions. It stays settings-agnostic. `settingsRuntimeAdapter.ts` is the sole bridge.
- `analysis/final-architecture.md`: Replaced line 54 "imports those helpers from settings and calls them when a runtime context is activated/cleared" with explicit statement that `providerRuntimeContext.ts` manages context state only and does NOT import settings-package functions; `settingsRuntimeAdapter.ts` bridges both.
- `plan/06-core-integration-stub.md`, `plan/09-cleanup-no-shims.md`, `plan/09a-cleanup-no-shims-verification.md`, `plan/10-full-verification.md`, `plan/10a-final-semantic-review.md`: All `providerRuntimeContext` scans expanded to check for `SettingsService` type/import/constructor references (not just singleton function names).
- `analysis/phase-verification-matrix.md`: Updated P06, P06a, P09, P09a, P10, P10a entries.
- `plan/00-overview.md`: Added explicit `providerRuntimeContext.ts` ownership decision to key behavioral contracts.

### 2. P07 red-phase verification commands changed to inventory/report-only

**Review issue**: P07 scans enforce zero old-imports which would fail in the expected red state before P08.

**Plan changes**:
- `plan/07-consumer-migration-tdd.md`: Replaced enforcing `exit 1` boundary scans (OLD_SETTINGS_PATHS, ROOT_BARREL_SYMBOLS) with inventory/report-only scans that use `echo "INVENTORY:..."` output. Added explicit comment block stating zero enforcement begins in P08/P08a/P09. Added `rg -c` count commands for root-barrel and deep-path inventory.
- `analysis/phase-verification-matrix.md`: P07 entry already noted inventory-only; confirmed consistent.
- `plan/00-overview.md`: Added key behavioral contract note about P07 inventory-only scans.

### 3. P04 red-phase capture-and-assert logic added

**Review issue**: P04 settings-package TDD verification runs expected-failing tests as a normal success gate.

**Plan changes**:
- `plan/04-settings-package-tdd.md`: Already had red-phase capture-and-assert logic added in revision-08. Confirmed the section is present and correct with three checks: (1) no module-resolution errors exit 1, (2) behavioral failure patterns must be present, (3) nonzero test exit required.
- `plan/00-overview.md`: Added explicit key behavioral contract note about P04 red-phase capture-and-assert.

### 4. P09/P09a file deletion enforcement (not just report)

**Review issue**: `find packages/core/src/settings -type f` only prints files; missing individual moved file checks.

**Plan changes**:
- `plan/09-cleanup-no-shims.md`: Added `test ! -d packages/core/src/settings` directory existence check before the count-based check, ensuring the directory itself is verified absent (not just empty).
- `plan/09a-cleanup-no-shims-verification.md`: Same addition of `test ! -d` check before `find | wc -l` check.
- `analysis/anti-shim-policy.md`: Added `test ! -d` directory existence check to the enforcing scan commands.
- `analysis/phase-verification-matrix.md`: P09 entry updated to mention `test ! -f` and `test ! -d` enforcement (not just `find | sort` report).

### 5. Zero-expected scans converted to capture-and-check-empty

**Review issue**: Several scans use bare `rg || echo OK` or shell-buggy variable capture.

**Plan changes**:
- All plan files already use `VAR=$(rg ... || true); test -z "$VAR" && echo OK || { echo FAIL:; echo "$VAR"; exit 1; }` patterns. Confirmed consistency across P09, P09a, P10, P10a. No bare `rg || echo OK` patterns remain in enforcing scan contexts.
- `plan/03b-minimal-adapter-wiring.md`: Changed lockfile diff `WARN` to `FAIL` with `process.exit(1)` for unrelated changes exceeding threshold — this was the only remaining `WARN` that should have been a mandatory check.

### 6. `scripts/check-settings-boundary.js` made mandatory P03 artifact with canonical export list

**Review issue**: Boundary verification script specified but not made a mandatory created artifact.

**Plan changes**:
- `analysis/boundary-verification-script.md`: Updated Plan Integration section to explicitly mandate P03 creation and later phase usage. Added requirement that the script MUST also verify `packages/settings/src/index.ts` exists as the canonical root public API barrel. Updated check 8 to explicitly state `LoadBalancerConfig` and `LoadBalancerSubProfileConfig` MUST be in the root-barrel scan pattern.
- `plan/03-decoupling-stub.md`: Already listed `scripts/check-settings-boundary.js` as a mandatory P03 created artifact with 12-check spec and `LoadBalancerConfig`/`LoadBalancerSubProfileConfig` in the boundary verification checklist item.

### 7. P03b blast-radius gate for production config construction

**Review issue**: P03b breaks production config construction with no explicit gate.

**Plan changes**:
- `plan/03b-minimal-adapter-wiring.md`: Already had blast-radius gate section added in revision-07. Confirmed it includes: (1) run core test suite, (2) verify only P04b test fails, (3) if non-P04b tests break, defer production wiring to P06.
- `plan/00-overview.md`: Already had P03b blast-radius gate key behavioral contract.
- `analysis/phase-verification-matrix.md`: P03b entry already references blast-radius gate.

### 8. `providerRuntimeContext.ts` final-state checks expanded to cover SettingsService type/constructor

**Review issue**: Scans only check for singleton function names, not `SettingsService` type/import/constructor references.

**Plan changes** (same as Material Issue 1):
- All `providerRuntimeContext` scans in P06, P09, P09a, P10, P10a now check for `SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from.*@vybestack/llxprt-code-settings` — covering both singleton function names AND `SettingsService` type/import/constructor references.
- `specification.md`, `analysis/final-architecture.md`, `plan/00-overview.md`: Explicit decision documented that `providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` from the settings package.
- Semantic verification checklists updated in P09, P09a, P10, P10a.

### 9. Dependency graph checks split (production vs forbidden)

**Review issue**: Workspace dependency checks merge `dependencies` and `devDependencies` for cycle detection, which can falsely report non-production cycles.

**Plan changes**:
- `analysis/dependency-audit.md`: Added explicit note that Check 1 (production cycle detection) uses `dependencies` ONLY because dev dependency cycles are non-blocking, while Check 2 (settings forbidden deps) uses BOTH. These MUST NOT be merged or conflated.
- `plan/10-full-verification.md`: Added clarification header "Two separate checks with different scopes (they MUST NOT be merged or conflated — they have different failure conditions)".
- `plan/10a-final-semantic-review.md`: Updated semantic checklist item to explicitly say dependencies ONLY vs dependencies AND devDependencies, and that they MUST NOT be merged.
- `plan/00-overview.md`: Added key behavioral contract note with same clarification.
- `analysis/phase-verification-matrix.md`: Updated P09a, P10, P10a entries.

### 10. Behavioral CLI test made deterministic

**Review issue**: CLI behavioral verification under-specified.

**Plan changes**:
- `plan/07-consumer-migration-tdd.md`: Already had "Behavioral CLI Test Requirement" section from revision-08 specifying deterministic test options (concrete CLI integration test or `--profile-load synthetic` smoke test as fallback).
- `plan/10-full-verification.md`: Added semantic checklist item "CLI behavioral test is deterministic" with explicit options.
- `plan/10a-final-semantic-review.md`: Added same semantic checklist item.
- `plan/00-overview.md`: Already had behavioral CLI test requirement as deterministic.
- `analysis/phase-verification-matrix.md`: P07 and P10 entries mention deterministic CLI test requirement.

## Pedantic Improvements Addressed

1. **Phase numbering**: P06 title already says "Core Runtime/Config Implementation" matching its scope. Confirmed consistent.

2. **Duplicate checklist bullets in P03b**: Reviewed P03b — no remaining duplicate items found (already cleaned in prior revisions).

3. **Root vs src entrypoint conventions**: `plan/00-overview.md` already clarifies `packages/settings/src/index.ts` as the canonical root public API barrel, separate from `packages/settings/index.ts`. Added this to `boundary-verification-script.md` P03 creation mandate.

4. **`LoadBalancerConfig`/`LoadBalancerSubProfileConfig` everywhere**: Verified `analysis/anti-shim-policy.md` blocklist, `analysis/boundary-verification-script.md` check 8, and all root-barrel moved-symbol scans include these symbols. Added explicit note to boundary-verification-script.md check 8.

5. **`WARN` for mandatory checks**: Converted the P03b lockfile diff `WARN` to `FAIL` with `process.exit(1)` for unrelated changes exceeding threshold. This was the only `WARN` that should have been a mandatory check.

6. **Canonical API list**: `plan/00-overview.md` already references `analysis/final-architecture.md` Public API Surface section as the canonical source. Confirmed consistent.

7. **`settings/src/index.ts` decision**: Explicitly stated in `plan/00-overview.md` and `analysis/boundary-verification-script.md` P03 mandate — `packages/settings/src/index.ts` is the canonical root public API barrel, must exist independently from `packages/settings/index.ts`.

8. **Registry test directory convention**: Noted in `plan/00-overview.md` — `.test.ts` in co-located `__tests__` directories matching providers precedent.

9. **P08 import inventory commands**: Already documented inline in `plan/08-consumer-migration-impl.md` with `rg -c` count commands. Added note in `plan/00-overview.md` key behavioral contracts.

10. **No `packages/storage` verification**: Already present in `plan/10-full-verification.md` and `plan/00-overview.md`. Confirmed explicit `test ! -d` and `test ! -f` checks.

## Files Modified

| File | Issues Addressed |
|------|-------------------|
| `specification.md` | #1 (runtime-context ownership — REQ-SVC-001.2 explicit decision) |
| `analysis/final-architecture.md` | #1 (providerRuntimeContext ownership clarification in line 54) |
| `analysis/anti-shim-policy.md` | #4 (directory existence enforcement), #4 (LoadBalancerConfig symbols already present) |
| `analysis/dependency-audit.md` | #9 (split dependency graph check scopes with MUST NOT merge note) |
| `analysis/boundary-verification-script.md` | #6 (P03 mandate + src/index.ts verification), #4 (LoadBalancerConfig explicit note) |
| `analysis/phase-verification-matrix.md` | #1 (providerRuntimeContext expanded scan), #2 (P07 inventory-only), #4 (file deletion enforcement), #5 (capture-and-check-empty), #8 (providerRuntimeContext expanded), #9 (split dep graph checks), #10 (CLI deterministic) |
| `plan/00-overview.md` | #1, #2 (P07 inventory), #3 (P04 red-phase), #7 (blast-radius), #8, #9, #10, pedantic #3, #4, #6, #7, #8, #9, #10 |
| `plan/03b-minimal-adapter-wiring.md` | #5 (WARN→FAIL), #7 (blast-radius already present) |
| `plan/07-consumer-migration-tdd.md` | #2 (inventory-only scans), #10 (CLI deterministic) |
| `plan/09-cleanup-no-shims.md` | #4 (directory existence check), #8 (expanded providerRuntimeContext scan) |
| `plan/09a-cleanup-no-shims-verification.md` | #4 (directory existence), #8 (expanded scan) |
| `plan/10-full-verification.md` | #5, #8 (expanded scan), #9 (split dep graph), #10 (CLI deterministic) |
| `plan/10a-final-semantic-review.md` | #5, #8 (expanded scan), #9 (split dep graph) |