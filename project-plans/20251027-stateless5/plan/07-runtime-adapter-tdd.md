# Phase 07: CLI Runtime Adapter TDD (RED)

## Phase ID
`PLAN-20251027-STATELESS5.P07`

## Prerequisites
- Required: Phase 06a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P06a" project-plans/20251027-stateless5`
- Expected files: `.completed/P06a.md`, pseudocode runtime-state.md lines 183-224, gemini-runtime.md lines 35-78.

## Implementation Tasks

### Files to Modify/Create
- `packages/cli/src/runtime/__tests__/runtimeSettings.agentRuntime.test.ts`
  - Add behavioral tests covering:
    - `/set` command mutates runtime state while leaving Config mirror intact (`@requirement:REQ-STAT5-002`).
    - `/provider` switch updates runtime state and triggers provider manager notifications (`@requirement:REQ-STAT5-002`).
    - `--profile-load` bootstraps runtime state distinct from Config after changes (`@requirement:REQ-STAT5-005`).
    - Tests rely on actual runtime helpers (no mocks) and validate immutability per dev-docs/RULES.md.
- `packages/cli/src/ui/commands/test/*.test.ts`
  - Extend targeted tests (e.g., `setCommand.phase09.test.ts`) with assertions verifying runtime state snapshot usage.

### Required Code Markers
- Each test annotated with plan, requirement, and pseudocode references.

### Tracker Update
- Mark phase as in-progress/completed once tasks done.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P07" || true
```

### Manual Verification Checklist
- [ ] New tests fail with current stub (document failure message referencing missing implementation).
- [ ] Tests cover CLI commands and runtime helper interactions without mocks.
- [ ] Each test asserts observable runtime state differences, not internal function calls.

## Success Criteria
- RED state established for CLI runtime adapter requirements.

## Failure Recovery
1. Adjust tests for correctness/behavioral focus.
2. Re-run verification commands capturing failure logs.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P07.md` summarizing failing expectations and impacted commands.
