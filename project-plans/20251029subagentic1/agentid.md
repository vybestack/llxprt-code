# PLAN-20251029-AGENTID

## Objective
Introduce an `agentId` (or equivalent) identifier throughout the tool-call pipeline so that every tool request/response, scheduler event, and telemetry payload knows which agent (primary or future subagent) owns the call. Behaviour remains unchanged for now: all calls use the primary agent id, but the plumbing is in place for subagent routing.

## Preconditions
- Workspace clean and synced.
- Existing tool execution tests stable.

## Plan (Test-First)

### P01 – Test Inventory & Fixture Updates
- Document impacted structures: `ToolCallRequestInfo`, `ToolCallResponseInfo`, `CoreToolScheduler`, CLI tool hooks, telemetry loggers.
- Prepare fixtures/helpers to set and assert `agentId`.

### P02 – Red Tests: Core Types & Scheduler
- Add failing unit tests validating:
  - `ToolCallRequestInfo`/`ToolCallResponseInfo` require (or default) `agentId`.
  - `CoreToolScheduler` stores and emits `agentId` in callbacks.
  - `executeToolCall` passes `agentId` through to logs/telemetry.

### P03 – Red Tests: CLI & UI Hooks
- Extend CLI unit tests to assert `/tools` (or streaming hooks) propagate `agentId` when scheduling tool calls.
- UI hook tests (`useReactToolScheduler`, etc.) expect updated structures containing `agentId`.

### P04 – Implementation (Green)
- Update TypeScript interfaces, constructors, and invocations to include `agentId`.
- Default to `DEFAULT_AGENT_ID` (primary) where not yet provided.
- Ensure telemetry logging attaches agent id metadata.

### P05 – Verification
- Run `npm test --workspaces`, `npm run lint`, `npm run typecheck`.
- Spot check interactive CLI to confirm no regressions.

### P06 – Cleanup & Docs
- Update any developer docs referencing tool events to include `agentId`.
- Ensure migration notes are captured if API consumers rely on these types.

## Success Criteria
- All red tests pass post implementation.
- Existing behaviour unchanged; new field populated in logs/structures with default primary id.
- Ready for subagent-specific routing without further structural changes.
