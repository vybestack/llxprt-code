# Phase 03: CLI Regression Test

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P02a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/integration-tests/profile-bootstrap.integration.test.ts`
  - Add a new suite tagged with `@plan:PLAN-20251020-STATELESSPROVIDER3.P03` and `@requirement:REQ-SP3-001`/`REQ-SP3-002`.
  - Test should execute `DEBUG=llxprt:* node scripts/start.js --profile-load synthetic --prompt "say hello"` (via helper) and expect **success** (no error thrown, output contains response stub).
  - The test must currently fail by capturing the `Cannot set properties of undefined (setting 'authMode')` error.

### Required Code Markers
Include inline comments referencing reproduction:
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P03
 * @requirement REQ-SP3-001
 * Reproduces current bootstrap failure.
 */
```

## Verification Commands
```bash
npm test -- --run integration --grep "PLAN-20251020-STATELESSPROVIDER3.P03"
```
The command should fail with the existing `authMode` error.

## Manual Verification Checklist
- [ ] Integration test captures the real failure output.
- [ ] Failure message matches observed CLI error.
- [ ] No code changes applied to fix behaviour yet.

## Success Criteria
- Regression test demonstrates current bug before any stub or implementation work.

## Failure Recovery
If the test passes unexpectedly, ensure expectations assert successful output; re-run until it fails with the authentic error.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P03.md` noting the failing command output.
