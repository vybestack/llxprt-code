# Phase 07a: RuntimeInvocationContext TDD Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P07a`

## Verification Goals

- Tests are behavioral, single-assertion
- No reverse testing

## Verification Steps

1. Detect reverse testing
   - `grep -r "NotYetImplemented" packages/core/src/runtime/__tests__`
2. Run tests (expect failure)
   - `npm run test -- --grep "P07"`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P07.md`
