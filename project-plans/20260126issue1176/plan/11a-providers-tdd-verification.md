# Phase 11a: Providers TDD Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P11a`

## Verification Goals

- Tests are behavioral
- No reverse testing

## Verification Steps

1. Detect reverse testing
   - `grep -r "NotYetImplemented" packages/core/src/providers/**/__tests__`
2. Run tests (expect failure)
   - `npm run test -- --grep "P11"`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P11.md`
