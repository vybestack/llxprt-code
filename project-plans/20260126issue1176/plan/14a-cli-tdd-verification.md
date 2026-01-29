# Phase 14a: CLI TDD Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P14a`

## Verification Goals

- Tests are behavioral
- No reverse testing

## Verification Steps

1. Detect reverse testing
   - `grep -r "NotYetImplemented" packages/cli/src/**/__tests__`
2. Run tests (expect failure)
   - `npm run test -- --grep "P14"`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P14.md`
