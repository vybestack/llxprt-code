# Phase 11: Integration & Migration Cleanup

## Phase ID
`PLAN-20251027-STATELESS5.P11`

## Prerequisites
- Required: Phase 10a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P10a" project-plans/20251027-stateless5`
- Expected files: `.completed/P10a.md`, pseudocode gemini-runtime.md lines 393-450.

## Implementation Tasks

### Files to Modify
- `packages/core/src/config/config.ts`
  - Remove direct provider/model/auth setters; delegate to runtime state bridging helpers.
  - Retain UI-specific settings (diagnostics, history) only.
- `packages/core/src/runtime/runtimeContextFactory.ts`
  - Ensure runtime registry stores `AgentRuntimeState` references.
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Finalize migration, removing legacy fallback paths.
- `packages/cli/src/ui/components/diagnostics/*`
  - Update to pull data from runtime state snapshots.
- Documentation updates: `docs/` or `dev-docs/` noting new runtime behavior.
- Add integration tests verifying diagnostic output via runtime state (e.g., `packages/cli/src/integration-tests/runtime-isolation.integration.test.ts`).
- `project-plans/20251027-stateless5/execution-tracker.md` (status update).

### Required Code Markers
- Every change includes `@plan:PLAN-20251027-STATELESS5.P11` and relevant `@requirement` annotations (primarily REQ-STAT5-005).

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --workspace packages/core --runInBand
pnpm test --workspace packages/cli --runInBand
pnpm test --workspace integration-tests --runInBand
```

### Manual Verification Checklist
- [ ] Config no longer holds provider/model/auth state beyond UI artifacts.
- [ ] Diagnostics `/diagnostics` output validated against runtime state (manual run or integration snapshot).
- [ ] Documentation reflects new flow.

## Success Criteria
- System fully integrated around stateless runtime with documentation/regression coverage.

## Failure Recovery
1. Resolve remaining Config coupling.
2. Update docs/tests accordingly and re-run verification commands.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P11.md` summarizing migration steps and global test results.
