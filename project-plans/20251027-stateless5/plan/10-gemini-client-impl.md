# Phase 10: GeminiClient/GeminiChat Implementation (GREEN)

## Phase ID
`PLAN-20251027-STATELESS5.P10`

## Prerequisites
- Required: Phase 09a completed.
- Verification: `rg "@plan:PLAN-20251027-STATELESS5.P09a" project-plans/20251027-stateless5`
- Expected files: `.completed/P09a.md`, pseudocode gemini-runtime.md lines 249-392.

## Implementation Tasks

### Files to Modify
- `packages/core/src/core/client.ts`
  - Introduce dependency injection for `AgentRuntimeState` per pseudocode lines 260-322.
  - Remove direct `Config` reads for provider/model/auth; use runtime state getters.
  - Ensure `HistoryService` remains injected, not recreated unexpectedly.
  - Register telemetry subscriber via `subscribeToAgentRuntimeState` and retain disposer to avoid leaks.
- `packages/core/src/core/geminiChat.ts`
  - Replace `Config` references for provider/model/auth/baseUrl with runtime state data passed from `GeminiClient` (pseudocode lines 323-382).
  - Accept runtime context argument bundling state + history service.
  - Guarantee provider calls use runtime metadata (no fallback to Config).
- `packages/core/src/core/subagent.ts`
  - Adjust usage to supply runtime state when constructing `GeminiChat` (pseudocode lines 366-382, while keeping history special-case).
- `packages/core/src/runtime/providerRuntimeContext.ts`
  - Ensure runtime state stored alongside config + settings (no fallbacks).
- Update affected tests to use runtime builders.
- `project-plans/20251027-stateless5/execution-tracker.md` (status update).

### Required Code Markers
- Each modified class/function annotated with plan/requirement/pseudocode markers.

## Verification Commands
```bash
pnpm lint
pnpm typecheck
pnpm format:check
pnpm build
pnpm test --filter "PLAN-20251027-STATELESS5.P09" --runInBand
pnpm test --filter "PLAN-20251027-STATELESS5.P10" --runInBand || true
pnpm test --workspace packages/core --runInBand
pnpm test --workspace packages/cli --runInBand
```

### Manual Verification Checklist
- [ ] All runtime state tests pass; Config is no longer read directly for provider/model/auth.
- [ ] History service is preserved per instance (no leakage across agents).
- [ ] Subagent integration unchanged except for explicit runtime injection.
- [ ] Telemetry subscription established and disposed correctly (no dangling listeners; change events refresh metadata).

## Success Criteria
- `GeminiClient`/`GeminiChat` fully stateless regarding provider/model/auth (REQ-STAT5-003 & REQ-STAT5-004).

## Failure Recovery
1. Address failing tests or lint/typecheck/build errors.
2. Re-run verification commands until all green.

## Phase Completion Marker
Create `project-plans/20251027-stateless5/.completed/P10.md` summarizing implementation adjustments and key verification evidence.
