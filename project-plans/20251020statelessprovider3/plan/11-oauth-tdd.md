# Phase 11: OAuth Safety TDD

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P11`

## Prerequisites
- Required: Phase 10a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P10a.md`

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/__tests__/oauthManager.safety.test.ts`
  - Add tests verifying:
    - Wrapper unwrapping for nested `LoggingProviderWrapper`.
    - Skip behaviour when provider is undefined.
    - Preservation of existing behaviour for providers without wrappers.
  - Tag tests with `@plan:PLAN-20251020statelessprovider3.P11` and `@requirement:REQ-SP3-003`.

## Verification Commands
```bash
npm run test --workspace @vybestack/llxprt-code -- --run packages/cli/src/auth/__tests__/oauthManager.safety.test.ts
```
Expect failures caused by NotYetImplemented helper.

## Manual Verification Checklist
- [ ] Tests assert behaviour (token clearing) not implementation details.
- [ ] Failures trace back to the stub helper.

## Success Criteria
- RED stage captured for OAuth safety changes.

## Failure Recovery
If tests pass, review expectations to ensure they rely on unimplemented logic and rerun.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P11.md`.
