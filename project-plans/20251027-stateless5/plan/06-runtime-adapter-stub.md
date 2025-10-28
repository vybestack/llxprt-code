# Phase 06: CLI Runtime Adapter Stub

## Phase ID
`PLAN-20251027-STATELESS5.P06`

## Prerequisites
- Required: Phase 05a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P05a" project-plans/20251027-stateless5`
- Expected files: `.completed/P05a.md`, pseudocode runtime-state.md lines 165-182 and gemini-runtime.md lines 12-34.

## Implementation Tasks

- `packages/cli/src/runtime/agentRuntimeAdapter.ts`
  - Export stub functions (`getAgentRuntimeStateSnapshot`, `updateAgentRuntimeState`, `applyProfileToRuntimeState`) delegating to existing `Config` behavior with `TODO: implement` comments per gemini-runtime pseudocode §§3-5.
  - Include `@plan`/`@requirement` markers referencing REQ-STAT5-002 and REQ-STAT5-005.
- `packages/cli/src/runtime/__tests__/agentRuntimeAdapter.stub.test.ts`
  - Ensure adapter returns current Config-backed data (legacy behavior) with `test.skip` placeholders.

### Files to Modify
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Import adapter but keep legacy operations as default (no behavior change yet).
  - Annotate with `@plan PLAN-20251027-STATELESS5.P06` near injection point.
- `project-plans/20251027-stateless5/execution-tracker.md`
  - Update phase status.

### Required Code Markers
- Each stub function annotated with requirement and pseudocode references.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P06" || true
```

### Manual Verification Checklist
- [ ] Adapter exists and is imported without altering runtime behavior.
- [ ] No new failing tests.
- [ ] Tracker updated after phase completion.

## Success Criteria
- Stub provides locus for later TDD without changing user-visible behavior.

## Failure Recovery
1. Adjust adapter stub to ensure zero behavior change.
2. Re-run verification commands.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P06.md` summarizing stub locations and verification outputs.
