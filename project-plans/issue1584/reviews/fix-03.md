# Fix Iteration 03

## Summary

Addressed review-03 substantive findings with concrete dependency, deep-import, inventory, package metadata, contract naming, pseudocode, and verification artifacts.

## Changes

1. Added `analysis/provider-external-dependencies.md` generated from provider imports, with required providers package dependency checks.
2. Added `analysis/core-deep-import-policy.md` with allowed core deep import prefixes and TypeScript/runtime verification.
3. Generated `analysis/provider-file-inventory.txt` and `analysis/provider-file-classification-complete.md` from the current provider tree.
4. Added `analysis/package-metadata-constraints.md` with exact dependency-direction package.json/tsconfig checks.
5. Added `analysis/core-structural-contracts.md` with allowed runtime contract locations/names and forbidden shim names.
6. Added `analysis/pseudocode/component-boundaries.md` for HistoryService tokenizer injection, ProviderContentGenerator boundary, runtime contracts, tool ID normalization, and CLI provider wiring.
7. Expanded `analysis/phase-verification-matrix.md` with package-level lint/test/typecheck/build checks during scaffold, provider move, and consumer migration phases.

## Remaining Concerns

The generated inventory reflects the current working tree. P01 must regenerate it before implementation if provider files change.
