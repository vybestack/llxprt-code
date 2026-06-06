# Review Iteration 01

## Verdict

NEEDS CHANGES

## Substantive Issues

1. Dependency direction strategy conflicts with issue #1584's move list. Files: project-plans/issue1584/specification.md, analysis/domain-model.md, analysis/dependency-audit.md, analysis/pseudocode/package-boundary.md, plan/03-contracts-stub.md, plan/05-contracts-impl.md. The plan correctly targets providers -> core, cli -> providers, cli -> core and no production core -> providers, but issue #1584 also says provider interfaces/types, tokenizers, provider errors, and ProviderContentGenerator move to packages/providers. Core currently depends on these categories. Remediation: choose and document an explicit final architecture before implementation, preferably a cycle-free shared contracts package, or explicitly document accepted exceptions if contracts remain core-owned.

2. Exact file classification is missing. Files: analysis/dependency-audit.md, plan/01-analysis.md, plan/09-provider-move-stub.md, plan/11-provider-move-impl.md, plan/15-deprecation-cleanup.md. The plan says P01/P09 will create provider-file-classification.md, core-import-remediation.md, and provider-move-map.md, but they are not present. Remediation: add a complete table for every current provider file with current path, final path, classification, rationale, consumers to update, and tests to move/update before P03+.

3. Tokenizer placement is unresolved and blocking. Files: specification.md, analysis/dependency-audit.md, plan/03-contracts-stub.md, plan/05-contracts-impl.md, plan/11-provider-move-impl.md, plan/15-deprecation-cleanup.md. Issue #1584 says tokenizer implementations move to providers, but core HistoryService constructs OpenAITokenizer and AnthropicTokenizer. Remediation: explicitly design tokenizer injection/factory/shared-contract ownership or move provider-specific token accounting out of core; forbid solving by adding core -> providers dependency.

4. ProviderContentGenerator placement is unresolved. Files: specification.md, analysis/dependency-audit.md, analysis/pseudocode/consumer-migration.md, plan/14-consumer-migration-impl.md. Issue #1584 says it moves to providers, but core contentGenerator.ts constructs it. Remediation: explicitly move provider-backed content generator construction out of core or invert it behind a core-owned/shared factory contract, with tests proving CLI startup still uses provider-backed generation and core has no providers imports.

5. ProviderManager/interface ownership is not fully resolved. Files: specification.md, analysis/integration-contract.md, plan/03-contracts-stub.md, plan/11-provider-move-impl.md, plan/14-consumer-migration-impl.md. Concrete ProviderManager should live in providers, but core currently imports ProviderManager/IProviderManager. Remediation: specify that core depends only on a contract from shared/core-owned location, CLI/providers construct concrete ProviderManager, and scans distinguish concrete implementation imports from allowed contract imports.

6. Phase verification commands are too generic and sometimes wrong. Files: most plan/*.md. Many phases only run core typecheck and grep markers, even for providers/CLI/package-boundary work. Marker greps include project-plans, allowing plan text to satisfy code-marker checks. Remediation: add phase-specific provider/core/CLI test/typecheck/build commands and forbidden import scans; restrict code marker greps to packages or explicitly separate plan-artifact markers from code markers.

7. Refactoring tests are not concrete enough. Files: plan/04-contracts-tdd.md, plan/07-package-scaffold-tdd.md, plan/10-provider-move-tdd.md, plan/13-consumer-migration-tdd.md, specification.md. The plan says preserve provider selection/switching/generation behavior but does not map exact existing tests/flows. Remediation: add a Behavioral Regression Test Matrix listing existing/new test files, real code exercised, allowed mock boundary, and expected preserved behavior for CLI manager creation, provider switching, HistoryService token accounting, tool ID normalization, ProviderContentGenerator/FakeProvider generation, and smoke startup.

8. Anti-shim enforcement needs sharper definitions. Files: specification.md, plan/12-consumer-migration-stub.md, plan/15-deprecation-cleanup.md, plan/15a-deprecation-cleanup-verification.md. Because core-owned contracts/utilities are allowed, implementation could accidentally create shim-like files. Remediation: define allowed true contracts vs forbidden re-export/wrapper/compatibility files and add explicit scans for core exports/imports from providers, files left under core/src/providers, and V2/New/Copy files.

9. Preflight is present but not populated with evidence. File: plan/00a-preflight-verification.md. It contains TBD/checklist content, not actual command outputs. Remediation: either populate command outputs now or require P00a to produce a preflight-results artifact with npm ls, workspace metadata, type/interface reads, provider import scans, and file inventory before any implementation phase.

## Pedantic Notes

1. Marker syntax varies from repository examples. The plan mostly uses '@plan PLAN-...' while PLAN.md examples sometimes use '@plan:PLAN-ID.PNN'. Pick one syntax consistently so grep gates work.
2. Several semantic checklists are generic. Analysis-only phases say to read modified implementation/tests even when there should be none. This is harmless but noisy.
3. P16/P16a marker requirements are odd. Full verification/review phases may not create production functions/classes/tests, so requiring markers on every changed function/class/test is unnecessary unless remediation code changes occur.
4. 'Deprecation cleanup' is slightly misleading given the no-shim/no-deprecation stance. 'Final cleanup and no shims' would be clearer.
5. 'package-lock.json or workspace lock metadata' is vague. Since project verification uses npm, specify exactly which npm lock/workspace metadata should change after install.

## Accepted Risks

1. Temporary providers -> core deep imports. The issue says providers should eventually depend on auth/settings packages, but those packages do not appear to exist yet. Accepting providers -> core deep imports is reasonable only as an interim step and only if final production core -> providers remains zero.
2. Large migration diff. Moving roughly 250 provider files plus tests/imports will create a high-churn PR. This is inherent to the issue; mitigate with exact move maps and regression tests rather than trying to avoid the churn.
3. Intentional public API breakage. Removing core provider exports will break old import paths, but this is required by issue #1584 and parent #1568's no-shim rule. Do not 'fix' this with compatibility re-exports.
4. Existing tests may be moved rather than rewritten. For a refactor, relocating existing behavioral provider tests into packages/providers is acceptable and often preferable to inventing new tests, provided mock-theater and structure-only assertions are reviewed.
