# Review Iteration 02

## Verdict

PASS WITH MINOR NOTES

## Substantive Issues

1. Some phase-local marker verification commands conflict with the newer verification matrix. Files: project-plans/issue1584/plan/01-analysis.md, 01a-analysis-verification.md, 02-pseudocode.md, 02a-pseudocode-verification.md, likely other no-production-code phases, and analysis/phase-verification-matrix.md. Remediation: for analysis-only/no-code phases, replace package code marker greps with direct artifact checks or explicitly mark marker scans as N/A unless packages/** code changed.
2. provider-file-classification.md is a baseline, not yet complete file-by-file classification. Files: project-plans/issue1584/analysis/provider-file-classification.md, plan/01-analysis.md, plan/09-provider-move-stub.md. Remediation: P01 must generate provider-file-inventory.txt and update classification so every packages/core/src/providers file is covered by explicit entries or deterministic rules plus exceptions; P01a should hard-gate this before P03+.
3. The phrase “compile-safe stubs” in P09 needs tighter anti-shim language. File: project-plans/issue1584/plan/09-provider-move-stub.md. Remediation: state that any P09 stubs must not preserve old core provider paths, must not forward from core to providers, must not pass behavioral tests, and must be removed/replaced by real moved implementation in P11.

## Pedantic Notes

1. Marker syntax is consistently @plan: / @requirement: in this plan even though some repository docs show examples without colons; implementation agents should follow the plan’s colon form.
2. Some phase files use generic wording like “existing package test conventions”; this is acceptable, but implementers should inspect neighboring package tests before choosing locations.
3. specification.md notes root package metadata currently declares pnpm while project verification uses npm; P00a should verify actual workspace/install behavior before lockfile/package metadata edits.
4. The plan relies on providers -> core deep imports as an interim state; avoid increasing these imports beyond what moved provider code already needs.

## Accepted Risks

1. Interim providers -> core deep imports are accepted because auth/settings/debug/tools/history packages do not yet exist; guardrails must keep final production core -> providers imports at zero.
2. Core-owned structural contracts such as RuntimeProvider, RuntimeProviderManager, RuntimeTokenizer, and RuntimeContentGeneratorFactory may look shim-adjacent, but are acceptable if named for core runtime semantics, not under packages/core/src/providers/**, and not importing or re-exporting provider package symbols.
3. Large file movement across roughly 250 provider files can obscure behavior regressions; this is acceptable only if P01 classification, P10 provider behavioral tests, P13 CLI integration tests, and P16 full verification/smoke test are executed strictly without batching or skipped phases.
