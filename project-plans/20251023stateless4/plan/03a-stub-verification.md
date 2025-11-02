# Phase 03a: Stub Verification

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P03a`

## Prerequisites
- Required: `.completed/P03.md` exists.
- Verification: `test -f project-plans/20251023stateless4/.completed/P03.md`
- Expected files from previous phase: Stubbed guard method, error class skeleton, skipped tests.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/__tests__/*.ts`
  - Annotate skipped tests with notes confirming pending behaviour.
- `project-plans/20251023stateless4/analysis/verification/base-provider-fallback-removal.md`
  - Update with stub verification findings.

### Activities
- Run focused lint/type-check to ensure stub compiles cleanly.
- Confirm no plan markers missing.

### Required Code Markers
- Verification notes must mention `@plan:PLAN-20251023-STATELESS-HARDENING.P03` for traceability.

## Verification Commands

### Automated Checks
```bash
pnpm test --filter BaseProvider --runInBand --reporter verbose || true
```

### Manual Verification Checklist
- [ ] Stub methods reachable in code without side effects.
- [ ] Skipped tests reference upcoming phase IDs.
- [ ] No unintended dependency on singleton fallback removed yet.

## Success Criteria
- Stubs validated as safe foundation for TDD.

## Failure Recovery
1. Adjust stub implementation to avoid behavioural drift.
2. Repeat verification command until clean.

## Phase Completion Marker
- Create `.completed/P03a.md` recording timestamp, command logs, and reviewer notes per PLAN-TEMPLATE guidelines.
