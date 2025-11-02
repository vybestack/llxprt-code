# Phase 08: CLI Runtime Adapter Implementation (GREEN)

## Phase ID
`PLAN-20251027-STATELESS5.P08`

## Prerequisites
- Required: Phase 07a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P07a" project-plans/20251027-stateless5`
- Expected files: `.completed/P07a.md`, pseudocode runtime-state.md lines 225-278, gemini-runtime.md lines 79-144.

## Implementation Tasks

### Files to Modify
- `packages/cli/src/runtime/agentRuntimeAdapter.ts`
  - Implement runtime state access/mutation bridging runtime registry and `AgentRuntimeState` per pseudocode lines 90-132.
  - Provide API: `getAgentRuntimeStateSnapshot`, `updateAgentRuntimeState`, `applyProfileToRuntimeState`.
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Replace direct `Config` mutations with adapter calls (e.g., `setActiveModel`, `setEphemeralSetting`).
  - Ensure Config mirror updates remain for UI via dedicated helper functions.
  - Register diagnostics/status subscribers via `subscribeToAgentRuntimeState`, using async option where UI rendering should defer.
- `packages/cli/src/ui/commands/{setCommand.ts,providerCommand.ts,modelCommand.ts,keyCommand.ts,keyfileCommand.ts,profileCommand.ts}`
  - Refactor to call runtimeSettings helpers that now leverage runtime state (align with pseudocode gemini-runtime.md lines 108-144).
- `packages/cli/src/ui/components/ProviderModelDialog.tsx`
  - Update data fetch to use runtime state snapshot.
- Relevant tests updated to assert new behavior (P07 tests should now pass).
- `project-plans/20251027-stateless5/execution-tracker.md` (status update).

### Required Code Markers
- Each modified function includes plan/requirement/pseudocode tags.
- New helper functions annotated accordingly.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P07" --runInBand
pnpm test --workspace packages/cli --runInBand
```

### Manual Verification Checklist
- [ ] P07 tests now pass, confirming runtime state integration.
- [ ] Slash commands/flags rely solely on runtime state (no direct Config mutations outside mirror helper).
- [ ] Provider/diagnostics UI continues to display correct information (verified via integration tests or snapshot comparisons).
- [ ] Runtime state change events propagate to CLI diagnostics/status outputs (covers sync vs async subscriber usage).

## Success Criteria
- CLI runtime operations use `AgentRuntimeState` while preserving UI functionality (REQ-STAT5-002 & REQ-STAT5-005).

## Failure Recovery
1. Fix implementation/tuning to satisfy tests and lint/typecheck/build.
2. Re-run verification commands until green.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P08.md` summarizing key code paths and test results.
