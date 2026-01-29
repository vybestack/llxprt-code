# Phase 09a: Integration TDD Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P09a`

## Verification Goals

- MSW-based tests exist
- No mock-theater or reverse testing

## Verification Steps

1. Ensure MSW usage
   - `grep -r "msw" packages/core/src/providers/__tests__/settingsSeparation.integration.test.ts`
2. Detect reverse testing
   - `grep -r "NotYetImplemented" packages/core/src/providers/__tests__`
3. Run tests (expect failure)
   - `npm run test -- --grep "P09"`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P09.md`
