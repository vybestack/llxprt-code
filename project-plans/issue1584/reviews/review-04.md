# Review Iteration 04

## Verdict

PASS WITH MINOR NOTES

## Substantive Issues

1. Generic marker verification commands in plan phase files can false-fail analysis-only and verification-only phases. Files: project-plans/issue1584/plan/01-analysis.md, 01a-analysis-verification.md, 02-pseudocode.md, 02a-pseudocode-verification.md, 02b-integration-contract.md, 02c-integration-contract-verification.md, and likely all *a-* verification phases. Remediation: explicitly state package marker greps are N/A when the phase does not modify packages/**, and verify artifacts/completion markers instead.

2. Preflight is present but must be executed before P03. Files: project-plans/issue1584/plan/00a-preflight-verification.md, project-plans/issue1584/analysis/preflight-results-template.md, project-plans/issue1584/plan/00-overview.md. Remediation: create populated project-plans/issue1584/analysis/preflight-results.md with actual command outputs during P00a and block P03 until reviewed.

3. Package naming should be explicitly reconciled with parent issue wording. Files: project-plans/issue1584/specification.md, project-plans/issue1584/analysis/package-metadata-constraints.md, project-plans/issue1584/plan/06-package-scaffold-stub.md, project-plans/issue1584/plan/08-package-scaffold-impl.md. Remediation: document that @vybestack/llxprt-code-providers is intentional to match existing @vybestack/llxprt-code-* workspace naming, rather than parent issue illustrative @vybestack/llxprt-providers.

4. Scaffold/move phases should more prominently require direct dependency declarations in providers. Files: project-plans/issue1584/analysis/provider-external-dependencies.md, project-plans/issue1584/plan/06-package-scaffold-stub.md, 08-package-scaffold-impl.md, 11-provider-move-impl.md. Remediation: state providers must not rely on transitive dependencies from core/cli; production imports go in dependencies and test-only imports in devDependencies; rerun import inventory after P11.

5. P15 cleanup wording allows core-owned exceptions under packages/core/src/providers, which could undermine no old provider paths. Files: project-plans/issue1584/specification.md, project-plans/issue1584/analysis/core-structural-contracts.md, project-plans/issue1584/analysis/anti-shim-policy.md, project-plans/issue1584/plan/15-deprecation-cleanup.md. Remediation: clarify that reclassified core-owned contracts/utilities must move to non-provider core paths such as packages/core/src/runtime/contracts or core utility paths; preferred final state is zero production files under packages/core/src/providers.

## Pedantic Notes

1. execution-tracker.md lists the preflight phase as 0.5 / P0.5 while the plan file is named 00a-preflight-verification.md; understandable but slightly inconsistent.
2. Several phases repeat generic semantic checklist boilerplate. This is acceptable, but coordinators should prioritize phase-specific checks from analysis/phase-verification-matrix.md.
3. Some phase prerequisite text says previous numbered phase even for subphases like P01a and P02b. The intended sequence is clear but should be followed exactly: P01 -> P01a -> P02 -> P02a -> P02b -> P02c -> P03 ...
4. Phase 15 is titled deprecation cleanup, but issue intent is removal/no shims rather than deprecation. The phase content is correct despite the title.

## Accepted Risks

1. Temporary providers -> core deep imports are consciously accepted because auth/settings/tools/history packages are not being extracted in issue #1584. Mitigation: allowed prefix policy, package metadata constraints, build/runtime import checks.
2. Core structural contracts such as RuntimeProvider, RuntimeProviderManager, RuntimeTokenizer, and RuntimeContentGeneratorFactory may resemble provider public contracts. This is acceptable if they are named for core runtime semantics, internal to core, not exported as compatibility APIs, not placed under packages/core/src/providers, and do not import/re-export provider symbols.
3. Provider tests may need HTTP/filesystem/environment mocks. This is acceptable when real provider code is exercised and tests do not merely assert mock calls or mocked expected outputs.
4. The refactor is large and import-heavy. The plan mitigates inherent churn risk with sequential phases, complete provider inventory, package-level verification, forbidden import scans, and full root verification plus smoke test.
