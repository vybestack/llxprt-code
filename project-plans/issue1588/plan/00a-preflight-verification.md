# Phase 0.5: Preflight Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P0.5`

## Purpose

Verify all assumptions before implementation begins. This phase creates `analysis/preflight-results.md` from `analysis/preflight-results-template.md` and populates it with actual command output.

## Prerequisites

- Branch is `issue1588`.
- `specification.md` and analysis artifacts exist.
- No production code changes have begun.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Behavioral Refactoring Verification

**Full Text**: Tests MUST be behavioral and fail if the implementation is removed; integration tests must verify real package boundaries and full verification is required before check-in.

**Behavior**:

- GIVEN: The current codebase before extraction
- WHEN: preflight commands are run
- THEN: assumptions about packages, imports, types, and tests are verified with real output before code changes

**Why This Matters**: Package extraction fails when plans assume nonexistent packages, wrong type ownership, or impossible dependency directions.

## Implementation Tasks

### Files to Create

- `project-plans/issue1588/analysis/preflight-results.md` copied from the template and populated with actual output.

### Commands To Run

Use the commands in `analysis/preflight-results-template.md`. Additionally:

```bash
# npm vs pnpm stance evidence
test -f package-lock.json && echo "package-lock.json exists"
test ! -f pnpm-lock.yaml && echo "pnpm-lock.yaml absent (good)"
npm run test -- --run 2>&1 | tail -5
# Verify workspace test command paths work from correct cwd
npm run test --workspace @vybestack/llxprt-code-core -- --run src/settings 2>&1 | tail -5
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/BaseProvider.test.ts 2>&1 | tail -5
```

## Verification Commands

```bash
test -f project-plans/issue1588/analysis/preflight-results.md
rg -n "TODO|TBD|paste output|Copy this file" project-plans/issue1588/analysis/preflight-results.md
```

Expected: file exists; no unfilled placeholders remain except explicitly marked future gates.

## Semantic Verification Checklist

- [ ] Verified no `packages/storage` exists.
- [ ] Verified actual settings/config/profile source files.
- [ ] Verified concrete dependency blockers.
- [ ] Verified consumer import inventory.
- [ ] Verified test commands or recorded why a command differs.
- [ ] Verified npm vs pnpm stance: `package-lock.json` exists, `pnpm-lock.yaml` does not, `npm run test` works.
- [ ] Verified workspace test commands use workspace-relative paths (not package-cwd-absolute paths).
- [ ] Verified `packages/lsp` is considered in downstream import scan.
- [ ] Verified settings package test command discovers nested directories (`src/profiles/__tests__`, `src/storage/__tests__`).
- [ ] Verified CLA tsconfig/vitest paths work with settings alias additions (relevant to P03b planning).
- [ ] Verified exact current `COMPRESSION_STRATEGIES` values from `packages/core/src/core/compression/types.ts` (record literal strings for registry test assertions without importing core compression).
- [ ] Verified a2a-server does NOT directly import `Storage`, `SettingsService`, `ProfileManager`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, or any symbols from `modelParams.ts` — recorded actual scan output, not assumptions.

## Success Criteria

- Preflight results are populated.
- Any assumption mismatch is reflected back into plan artifacts before P03.

## Failure Recovery

If preflight contradicts the plan, stop and update the plan before implementation. Do not proceed with speculative fixes.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P0.5.md` with command outputs and semantic assessment.
