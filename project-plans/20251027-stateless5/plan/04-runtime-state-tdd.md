# Phase 04: AgentRuntimeState TDD (RED)

## Phase ID
`PLAN-20251027-STATELESS5.P04`

## Prerequisites
- Required: Phase 03a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P03a" project-plans/20251027-stateless5`
- Expected files: `.completed/P03a.md`, pseudocode runtime-state.md lines 37-98 for test scenarios.

## Implementation Tasks

### Files to Create
- `packages/core/src/runtime/__tests__/AgentRuntimeState.behavior.test.ts`
  - Write behavior-focused tests covering:
    - Creating runtime state from initial settings (`@requirement:REQ-STAT5-001`).
    - Immutable updates (provider/model/auth changes yield new instance) (`@requirement:REQ-STAT5-001`).
    - Snapshot export for CLI diagnostics (`@requirement:REQ-STAT5-002`).
    - Synchronous change-event dispatch with optional async subscriber flag (include subscribe/unsubscribe flow) (`@requirement:REQ-STAT5-001`, `@requirement:REQ-STAT5-003`).
    - Attempting to mutate without required fields throws specific error (`@requirement:REQ-STAT5-001`).
  - Annotate each test with plan/pseudocode markers (e.g., `@pseudocode runtime-state.md lines 45-78`).

### Files to Modify
- `packages/core/tsconfig.json` or relevant test config if additional globs needed (minimal changes only).
- `project-plans/20251027-stateless5/execution-tracker.md` (update status).

### Required Code Markers
- Each test block includes:
  ```ts
  it('...', async () => {
    // @plan PLAN-20251027-STATELESS5.P04
    // @requirement REQ-STAT5-001
    // @pseudocode runtime-state.md lines XX-YY
  });
  ```

## Verification Commands

### Automated Checks
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P04" || true
```

### Manual Verification Checklist
- [ ] Tests fail against stub with clear unmet expectation (document failure message in verification report).
- [ ] Tests follow Arrange-Act-Assert and avoid mocks per dev-docs/RULES.md.
- [ ] Coverage includes zero mutation of returned objects (immutability assertions).
- [ ] Event emission assertions fail against stub, demonstrating requirement coverage.

## Success Criteria
- RED state confirmed: new tests fail because runtime state is not implemented.

## Failure Recovery
1. Refine tests to target behavior (not implementation details).
2. Re-run verification commands ensuring failure is due to missing implementation.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P04.md` summarizing failing expectations and linking to test cases.
