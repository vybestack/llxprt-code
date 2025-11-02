# Phase 05: AgentRuntimeState Implementation (GREEN)

## Phase ID
`PLAN-20251027-STATELESS5.P05`

## Prerequisites
- Required: Phase 04a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P04a" project-plans/20251027-stateless5`
- Expected files: `.completed/P04a.md`, pseudocode runtime-state.md lines 99-164.

## Implementation Tasks

### Files to Modify
- `packages/core/src/runtime/AgentRuntimeState.ts`
  - Implement immutable state structure following runtime-state pseudocode §§1-5.
  - Provide typed getters (`getProvider`, `getModel`, `getAuth`, `getEphemeralSettingsSnapshot`) and `getAgentRuntimeStateSnapshot`.
  - Implement `updateAgentRuntimeState` returning a new frozen instance and emitting synchronous `RuntimeStateChanged` events with payload `{ runtimeId, changes, snapshot, timestamp }`.
  - Implement `subscribeToAgentRuntimeState` with optional `{ async?: boolean }` flag handling deferred dispatch.
  - Enforce validation guards (missing provider/model, unsupported keys) with descriptive errors.
- `packages/core/src/runtime/__tests__/AgentRuntimeState.behavior.test.ts`
  - Ensure coverage for getters, immutability, event dispatch (including async opt-in), and validation errors (no reverse testing).
- `packages/core/src/runtime/__tests__/AgentRuntimeState.stub.test.ts`
  - Remove skip or adjust to ensure coverage.
- `packages/core/src/runtime/index.ts`
  - Ensure new helpers exported for downstream usage.
- `project-plans/20251027-stateless5/execution-tracker.md`
  - Update status.

### Required Code Markers
- Each implemented function annotated:
  ```ts
  /**
   * @plan PLAN-20251027-STATELESS5.P05
   * @requirement REQ-STAT5-001
   * @pseudocode runtime-state.md lines 6-28
   */
  ```

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P04" --runInBand
pnpm test --filter "PLAN-20251027-STATELESS5.P05" --runInBand || true  # add targeted tests if created
```

## Manual Verification Checklist
- [ ] All P04 tests now pass (GREEN) without weakening assertions.
- [ ] Implementation is purely immutable (no in-place mutation detected by tests or review).
- [ ] Event payload and synchronous dispatch semantics match specification and tests cover both sync/async subscription options.
- [ ] Error messages match pseudocode requirements.

## Success Criteria
- Runtime state abstraction fully implemented, satisfying REQ-STAT5-001.

## Failure Recovery
1. Fix implementation to ensure tests pass without relaxing behavior.
2. Repeat verification commands until green.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P05.md` including command logs and summary of key implementation points.
