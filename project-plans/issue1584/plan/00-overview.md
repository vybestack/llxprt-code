# Plan: Extract Provider Package

Plan ID: PLAN-20260603-ISSUE1584
Generated: 2026-06-03
Total Phases: 16 plus verification phases
Requirements: REQ-PKG-001, REQ-DEP-001, REQ-API-001, REQ-TEST-001, REQ-CLEAN-001

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification in plan/00a-preflight-verification.md.
2. Defined integration contracts in analysis/integration-contract.md.
3. Written integration tests before unit tests for package boundary changes.
4. Verified dependencies and types exist as assumed.
5. Preserved behavior: this is a refactor, not a feature addition.

## Execution Model

Execute phases sequentially. Each worker phase uses typescriptexpert; each verification phase uses typescriptreviewer. Do not skip phase numbers. Do not combine phases.

## Refactoring Strategy

1. Analyze and classify provider-owned versus core-owned contracts.
2. Establish core-owned contracts/utilities needed to avoid cycles.
3. Scaffold providers package.
4. Move implementation files and update provider imports.
5. Migrate consumers without core shims.
6. Remove old core provider exports and implementation leftovers.
7. Run full verification and smoke test.


## Required Supporting Artifacts

Implementation agents must read these artifacts before P03:

- `analysis/final-architecture.md`
- `analysis/provider-file-classification.md`
- `analysis/core-import-remediation.md`
- `analysis/provider-move-map.md`
- `analysis/behavioral-regression-matrix.md`
- `analysis/anti-shim-policy.md`
- `analysis/phase-verification-matrix.md`
- `analysis/preflight-results.md` produced from the template


## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.


## Preflight Execution Requirement

`analysis/preflight-results.md` is intentionally not pre-populated during plan creation. P00a must generate it from `analysis/preflight-results-template.md`, paste actual command outputs, and P00a/P01a verification must approve it before P03 or any production-code implementation begins.
