# Phase 13: Final Validation

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P13`

## Prerequisites
- Required: Phase 12a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P12a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/integration-tests/profile-bootstrap.integration.test.ts`
  - Add integration tests covering:
    - `--profile-load synthetic --prompt "hello"` retains base URL and key.
    - `/profile load synthetic` inside a simulated session uses the new helpers.
  - Tag tests with `@plan:PLAN-20251020statelessprovider3.P13` and requirements `REQ-SP3-001`, `REQ-SP3-002`, `REQ-SP3-004`.

### Verification Commands
```bash
npm run test:integration --workspace @vybestack/llxprt-code -- --run src/integration-tests/profile-bootstrap.integration.test.ts
```

## Manual Verification Checklist
- [ ] Integration tests exercise CLI bootstrap and slash command flows.
- [ ] Tests fail if helpers regress.

## Success Criteria
- Regression coverage ensures behaviours remain correct end-to-end.

## Failure Recovery
Adjust integration test arrangement if failures are unrelated to new behaviour, then rerun before P13a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P13.md`.
