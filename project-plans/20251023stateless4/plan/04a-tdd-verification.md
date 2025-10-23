# Phase 04a: TDD Verification

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P04a`

## Prerequisites
- Required: `.completed/P04.md` captured with failing tests.
- Verification: `test -f project-plans/20251023stateless4/.completed/P04.md`
- Expected files from previous phase: New failing tests tagged with plan and requirement markers.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/__tests__/BaseProvider.guard.test.ts`
  - Document failure modes in comments referencing upcoming implementation lines.
- `project-plans/20251023stateless4/analysis/verification/base-provider-fallback-removal.md`
  - Record observed failure outputs.

### Activities
- Confirm each failing test maps to pseudocode steps (lines 10-14 for BaseProvider, lines 10-16 for provider runtime handling).
- Capture baseline failure logs for later comparison.

### Required Code Markers
- Ensure verification notes reference `@plan:PLAN-20251023-STATELESS-HARDENING.P04` and respective `@requirement:REQ-SP4-00X` identifiers.

## Verification Commands

### Automated Checks
```bash
# Rerun targeted suites to confirm failures persist
pnpm test --filter "runtime guard" --runInBand && exit 1
```

### Manual Verification Checklist
- [ ] All added tests still red. _(Blocked: vitest rejects `--filter`, command exits early before assertions run.)_
- [ ] Failure messages align with missing runtime context expectations. _(Blocked by CACError preventing guard execution.)_
- [x] No accidental fixes or regressions observed. _(No implementation changes performed during verification pass.)_

## Success Criteria
- Documented failing state ready for implementation phase.

## Failure Recovery
1. If tests accidentally pass, revert stub changes and reassert expectations.
2. Update tests to better capture intended behaviour.

## Phase Completion Marker
- Create `.completed/P04a.md` including timestamp, verification evidence, and reviewer notes per PLAN-TEMPLATE guidelines.
