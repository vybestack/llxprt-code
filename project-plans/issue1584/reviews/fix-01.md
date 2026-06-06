# Fix Iteration 01

## Summary

Addressed review-01 substantive issues by adding explicit cycle-free architecture, classification baselines, blocker remediation design, behavioral regression matrix, anti-shim policy, phase-specific verification matrix, and preflight results template.

## Issues Addressed

1. Architecture conflict: added `analysis/final-architecture.md` and specification addendum defining provider public APIs in providers, core internal structural runtime contracts, and no final production core -> providers dependency.
2. File classification: added `analysis/provider-file-classification.md`, `analysis/provider-move-map.md`, and inventory requirements for all provider files.
3. Tokenizer placement: added injection/factory decision in `analysis/final-architecture.md`, `analysis/core-import-remediation.md`, and phase guidance.
4. ProviderContentGenerator: added move/inversion decision in final architecture, core import remediation, and relevant phase guidance.
5. ProviderManager/interface ownership: documented concrete manager in providers and core structural contracts only.
6. Verification commands: added `analysis/phase-verification-matrix.md`, adjusted marker syntax to `@plan:`/`@requirement:`, and restricted code marker scans to `packages`.
7. Refactoring tests: added `analysis/behavioral-regression-matrix.md` with concrete flows and mock boundaries.
8. Anti-shim enforcement: added `analysis/anti-shim-policy.md` with allowed true contracts, forbidden shims, and required scans.
9. Preflight evidence: added `analysis/preflight-results-template.md` and updated `plan/00a-preflight-verification.md` to require populated `analysis/preflight-results.md` before implementation.

## Remaining Concerns

The plan still intentionally accepts providers -> core deep imports as an interim architecture until later extraction issues create auth/settings/tools/etc packages. This is documented as an accepted risk and guarded by no final production core -> providers scans.
