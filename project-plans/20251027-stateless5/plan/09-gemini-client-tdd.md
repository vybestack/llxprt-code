# Phase 09: GeminiClient/GeminiChat TDD (RED)

## Phase ID
`PLAN-20251027-STATELESS5.P09`

## Prerequisites
- Required: Phase 08a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P08a" project-plans/20251027-stateless5`
- Expected files: `.completed/P08a.md`, pseudocode gemini-runtime.md lines 145-248.

## Implementation Tasks

### Files to Modify/Create
- `packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts`
  - Add cases verifying `GeminiClient` consumes `AgentRuntimeState` for model/provider/auth (no Config reads) – expect failure against current implementation.
  - Ensure tests assert: state updates do not mutate runtime, runtime state change subscription occurs for telemetry metadata, `HistoryService` reused, errors thrown when runtime missing required data.
- `packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts`
  - Validate `GeminiChat` receives runtime data via injected context, provider call uses runtime metadata not Config, and `HistoryService` injection remains explicit.
- Update existing tests (`geminiChat.test.ts`, `client.test.ts`) with plan markers ensuring they reference runtime state via helper builders.

### Required Code Markers
- Each test annotated with relevant requirement(s) and pseudocode lines.

### Tracker Update
- Mark P09 progress accordingly.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P09" || true
```

### Manual Verification Checklist
- [ ] Tests fail because production code still uses Config directly (capture failure logs).
- [ ] Tests assert observable behavior (actual responses, not method invocations/mocks).
- [ ] History service expectations documented.
- [ ] Subscription/telemetry assertion fails under current implementation, proving REQ-STAT5-003.2 coverage.

## Success Criteria
- RED tests demonstrate need for stateless refactor in GeminiClient/GeminiChat.

## Failure Recovery
1. Adjust tests to better express expected behavior.
2. Re-run verification commands capturing failure evidence.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P09.md` summarizing failing assertions and coverage areas.
