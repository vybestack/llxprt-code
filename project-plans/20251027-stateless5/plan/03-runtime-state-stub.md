# Phase 03: AgentRuntimeState Stub

## Phase ID
`PLAN-20251027-STATELESS5.P03`

## Prerequisites
- Required: Phase 02a completed.
- Verification: `grep -r "@plan:PLAN-20251027-STATELESS5.P02a" project-plans/20251027-stateless5`
- Expected files: `.completed/P02a.md`, pseudocode references (runtime-state.md §§1-3).

## Implementation Tasks

### Files to Create
- `packages/core/src/runtime/AgentRuntimeState.ts`
  - Export `AgentRuntimeState` interface and stub implementations for `createAgentRuntimeState`, `getAgentRuntimeStateSnapshot`, `updateAgentRuntimeState`, and `subscribeToAgentRuntimeState` (returning `throw new Error('NotImplemented')` or placeholder values) per runtime-state pseudocode §§1-4.
  - Declare `RuntimeStateChangedEvent` payload type `{ runtimeId: string; changes: Partial<AgentRuntimeStateSnapshot>; snapshot: AgentRuntimeStateSnapshot; timestamp: number; }` to match specification.
  - Include markers:
    ```ts
    /**
     * @plan PLAN-20251027-STATELESS5.P03
     * @requirement REQ-STAT5-001
     * @pseudocode runtime-state.md lines 6-28
     */
    ```
- `packages/core/src/runtime/__tests__/AgentRuntimeState.stub.test.ts`
  - Smoke test ensuring stubs exist but marked with `test.skip` to avoid false positives (per pseudocode lines 29-36).

### Files to Modify
- `packages/core/src/runtime/index.ts`
  - Re-export new stub (no behavior change).
- `project-plans/20251027-stateless5/execution-tracker.md`
  - Update phase status.

### Required Code Markers
- All new exports and tests annotated with `@plan` / `@requirement` / `@pseudocode` markers.

## Verification Commands

### Automated Checks
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P03" || true
```

### Manual Verification Checklist
- [ ] Stub throws/returns placeholders so P04 tests will fail (RED).
- [ ] No logic implemented beyond interface scaffolding.
- [ ] Runtime index exports updated without side effects.

## Success Criteria
- Runtime state interface exists with stubs ready for TDD coverage.

## Failure Recovery
1. Adjust stub to match pseudocode interface contract.
2. Re-run verification commands.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P03.md` logging command outputs (including expected failing tests if any) and stub summary.
