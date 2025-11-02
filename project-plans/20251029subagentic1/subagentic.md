# PLAN-20251029-SUBAGENTIC

## Objective
Implement the end-to-end **Task → Subagent** workflow inside `packages/core`, enabling the foreground agent to spawn an isolated subagent, stream its progress, capture emitted variables, and dispose of the runtime once the task completes. Delivery includes the Task tool definition, wiring to the existing `SubagentOrchestrator`, and UI/telemetry surfacing keyed by `agentId`.

## Success Criteria
- Foreground agent exposes a `Task` tool callable by the model/CLI.
- Tool schema accepts `subagentName`, a prompt/goals payload, and optional run/tool limits.
- Invoking the Task tool creates a brand-new runtime via `SubagentOrchestrator`, executes it exactly once, returns final output/emitted vars, and calls `dispose`.
- Tool call/response and telemetry events carry the subagent `agentId`; UI services render them without cross-agent bleed.
- Disabled tools are never exposed to the subagent provider schema nor executed locally.
- All new/updated tests document coverage and pass post-implementation.

## Preconditions
- Workspace synced and clean (no unstaged changes).
- Existing stateless plumbing passes: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- Local profile/subagent managers already support configs under `~/.llxprt`.
- No Task tool currently exists; expect to add new files/modules.

## Test-First Delivery Plan

### P01 – Foundations & Fixtures
1. **Audit** coverage for `SubAgentScope`, `SubagentOrchestrator`, `CoreToolScheduler`, `useGeminiStream`, telemetry loggers, and CLI history rendering. Capture required hooks for agent-aware assertions.
2. **Introduce reusable fixtures**:
   - `packages/core/src/test-utils/subagentFixtures.ts`: helpers to fabricate subagent configs, runtime bundles (history + tool registry), and mock orchestrator responses.
   - CLI-side helpers for rendering multi-agent tool streams (e.g., stubbed `ToolCallTrackerService` returns, scheduler snapshots).
3. Document fixtures in developer notes so future phases reuse them.

### P02 – Task Tool Contract (RED)
1. Add `packages/core/src/tools/task.test.ts` with focused cases:
   - Valid invocation: confirm payload transformed into `SubagentOrchestrator.launch` request (prompt merge, run/tool/output configs).
   - `agentId` and emitted vars returned in final tool result; terminate reason surfaces correctly.
   - Executor always calls `dispose()` regardless of success/failure (use spies to assert once-only).
   - Error from orchestrator bubbles with helpful message.
2. Record failure via `npm run test -- packages/core/src/tools/task.test.ts`.

### P03 – Subagent Runtime Isolation & AgentId Flow (RED)
1. Extend `packages/core/src/core/subagent.test.ts` (or add `taskSubagentIsolation.test.ts`) to assert:
   - Tool requests built inside `processFunctionCalls` attach the subagent `agentId`.
   - `GeminiChat` instantiated for the subagent writes to its runtime-specific `HistoryService`; foreground history remains untouched.
2. Add integration test `packages/core/src/core/taskSubagentIntegration.test.ts`:
   - Mock `SubagentOrchestrator.launch` to supply isolated runtime bundle.
   - Simulate a Task tool run; ensure tool call/response parts are re-routed into the subagent history while final Task result remains available to foreground.
3. Run targeted suites and capture red state.

### P04 – Scheduler, Stream, and UI Agent Awareness (RED)
1. Update / add tests in `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` to cover multi-agent streams:
   - Tool requests keep agentId when scheduled.
   - Completed tool batches return to the matching runtime (subagent vs foreground).
   - Approvals block per-agent, leaving other agents unaffected.
2. Add tests to `packages/core/src/core/coreToolScheduler.test.ts` to confirm:
   - `ensureAgentId` normalization works for scheduler input.
   - Status transitions preserve agentId, including `awaiting_approval` and `success`.
3. Expand UI display mapper tests to expect agent labels/grouping (e.g., `useReactToolScheduler.test.ts`).

### P05 – Telemetry & Logging Expectations (RED)
1. Extend `packages/core/src/telemetry/loggers.test.ts` to demand `agent_id` on tool start/complete events.
2. If approval telemetry exists, assert pending/decision records carry the same id.
3. Ensure existing telemetry fixtures updated for new field; let tests fail before implementation.

### P06 – Implementation (GREEN)
1. **Task Tool module** (`packages/core/src/tools/task.ts`):
   - Define schema: `subagentName`, `goalPrompt`, optional `behaviourPrompts`, `runLimits`, `toolWhitelist`, `outputSpec`.
   - Executor flow:
     * Instantiate `SubagentOrchestrator` with foreground managers.
     * Launch subagent; capture `agentId`, `scope`, `dispose`.
     * Wire progress streaming hook (e.g., optional `onMessage`) to Task tool telemetry outputs.
     * Run subagent (non-interactive) inside try/finally, collect `scope.getOutput()` (emitted vars, terminate reason), format tool result envelope, call `dispose`.
     * Normalize errors (wrap orchestrator failures with actionable messages).
2. **Registry Integration**:
   - Register Task tool in core tool registry and CLI provider schema builders; ensure disabled tools remain hidden when building subagent tool declarations (reusing governance checks in `SubagentOrchestrator`).
   - Expose Task tool to CLI/model only when profile/subagent managers configured.
3. **AgentId Propagation**:
   - `CoreToolScheduler`: keep agentId on tool calls/responses through validation, scheduling, execution, confirmation, and completion; ensure `notifyToolCallsUpdate` and completion payloads deliver agentId.
   - `useReactToolScheduler`: stop defaulting agentId blindly; rely on upstream id and pass along when resubmitting tool responses to Gemini.
   - `useGeminiStream`: when dispatching tool responses back to Gemini, choose the correct `GeminiClient` / runtime based on agentId (foreground runtime for default id, subagent runtime bundle for others). Update queued submission handling to isolate per agent.
4. **UI & History**:
   - History/logging: ensure when Task tool reports final output, it does not auto-append subagent transcript into foreground history unless explicitly requested. Document return payload expectations.
   - CLI: update tool group rendering to display agent label (e.g., “Subagent: <name>”) and segregate ongoing tool batches by agentId.
5. **Telemetry**:
   - Add agentId field to relevant telemetry payloads (tool start, completion, approval). Ensure serialization matches downstream expectations.
6. **ToolCallTrackerService decision**:
   - If expanded use needed, refactor service to key by agentId generically (beyond todo). Otherwise, document that Task tool does not hook into tracker and adjust plan accordingly.

### P07 – Verification
1. Re-run all targeted suites from RED phases; ensure they pass.
2. Repository checklist:
   - `npm run format:check`
   - `npm run lint`
   - `npm run typecheck`
   - `npm run test`
   - `npm run build`
   - `node scripts/start.js --profile-load synthetic --prompt "just say hi"`
3. Optional manual: exercise `/task <subagent> "<prompt>"` in CLI, confirm UI displays separate agent streams with approvals/telemetry.

### P08 – Documentation & Plan Wrap-Up
1. Update `dev-docs` (or relevant README) with Task tool usage, agentId lifecycle, and subagent runtime isolation notes.
2. Record completion evidence in the plan’s tracker (`execution-tracker.md`, compliance logs) referencing tests/scripts executed.
3. Keep reporting scoped to this plan; do not modify archived plans.

## Evidence Checklist
- ✅ Test suites named above committed with explicit RED/GREEN commits.
- ✅ Tool schema and orchestrator wiring documented.
- ✅ All required npm scripts succeed.
- ✅ Plan trackers updated with timestamps and references to test files.
