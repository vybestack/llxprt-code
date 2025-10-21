# Phase 07: Profile Application Stub

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P07`

## Prerequisites
- Required: Phase 06a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P06a.md`

## Implementation Tasks

### Files to Create
- `packages/cli/src/runtime/profileApplication.ts`
  - Export `applyProfileWithGuards` and `selectAvailableProvider`.
  - Functions throw `new Error('NotYetImplemented: PLAN-20251020-STATELESSPROVIDER3.P07')`.
  - Include markers for `@plan` and `@requirement:REQ-SP3-002`.

### Files to Modify
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Add import statements for the new helper (no usage yet).
  - Tag import block with `@plan:PLAN-20251020-STATELESSPROVIDER3.P07`.

## Verification Commands
```bash
test -f packages/cli/src/runtime/profileApplication.ts
grep "PLAN-20251020-STATELESSPROVIDER3.P07" packages/cli/src/runtime/profileApplication.ts
```

## Manual Verification Checklist
- [ ] Stub functions throw with plan ID.
- [ ] No behavioural changes to runtime helpers yet.

## Success Criteria
- Stubs ready for RED tests in Phase 08.

## Failure Recovery
Ensure TypeScript build still succeeds before proceeding to Phase 07a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P07.md`.
