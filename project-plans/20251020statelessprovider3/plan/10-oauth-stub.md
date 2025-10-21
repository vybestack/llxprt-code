# Phase 10: OAuth Safety Stub

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P10`

## Prerequisites
- Required: Phase 09a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P09a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/auth/oauth-manager.ts`
  - Introduce placeholder helper `unwrapLoggingProvider` returning `never` with NotYetImplemented error.
  - Tag section with `@plan:PLAN-20251020statelessprovider3.P10`, `@requirement:REQ-SP3-003`.
  - Do not change existing behaviour yet.

### Required Code Markers
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P10
 * @requirement REQ-SP3-003
 * @pseudocode oauth-safety.md lines 1-17
 */
```

## Verification Commands
```bash
grep "PLAN-20251020-STATELESSPROVIDER3.P10" packages/cli/src/auth/oauth-manager.ts
```

## Manual Verification Checklist
- [ ] Helper throws NotYetImplemented with plan ID.
- [ ] No functional change yet.

## Success Criteria
- Stub ready for RED tests.

## Failure Recovery
Ensure TypeScript build still succeeds before Phase 10a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P10.md`.
