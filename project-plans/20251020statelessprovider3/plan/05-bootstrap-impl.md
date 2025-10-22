# Phase 05: Bootstrap TDD

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P04a.md`

## Implementation Tasks

### Files to Create
- `packages/cli/src/config/__tests__/profileBootstrap.test.ts`
  - Write Vitest tests covering:
    - parsing args with/without `--profile-load`.
    - ensuring runtime is prepared before profile application.
    - integration expectation for `createBootstrapResult` returning runtime metadata.
  - Reference pseudocode lines with `@pseudocode bootstrap-order.md lines 1-9`.
  - Tag each test with `@plan:PLAN-20251020-STATELESSPROVIDER3.P05` and `@requirement:REQ-SP3-001`.

### Required Code Markers
Each `it()` block must include:
```ts
it('description @plan:PLAN-20251020-STATELESSPROVIDER3.P05 @requirement:REQ-SP3-001', () => {
  // arrange-act-assert
});
```

## Verification Commands
```bash
npm run test --workspace @vybestack/llxprt-code -- --run packages/cli/src/config/__tests__/profileBootstrap.test.ts
```
Expect failures because stubs throw NotYetImplemented.

## Manual Verification Checklist
- [ ] Tests target behaviours (no mock theatre).
- [ ] Tests fail due to NotYetImplemented from Phase 04.
- [ ] Failure output recorded for Phase 05a.

## Success Criteria
- RED stage established for bootstrap helpers.

## Failure Recovery
If tests pass accidentally, review expectations to ensure they rely on unimplemented behaviour, then rerun the command.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P05.md` including failing test output.
