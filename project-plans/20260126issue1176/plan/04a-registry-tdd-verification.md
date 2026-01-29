# Phase 04a: Registry TDD Verification

## Phase ID
`PLAN-20260126-SETTINGS-SEPARATION.P04a`

## Verification Goals

- Tests are behavioral and single-assertion
- No reverse testing for stubs
- No mock theater

## Verification Steps

1. Detect reverse testing
   - `grep -r "NotYetImplemented" packages/core/src/settings/__tests__`
2. Detect mock-only tests
   - `grep -r "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/settings/__tests__`
3. Run tests (expect failure)
   - `npm run test -- --grep "P04"`

## Phase Completion Marker

Create: `project-plans/20260126issue1176/.completed/P04.md`

Contents:

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Verification: PASS/FAIL with notes
```
