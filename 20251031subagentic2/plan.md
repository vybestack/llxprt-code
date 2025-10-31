# Plan: Subagent Tool Flow Alignment (20251031subagentic2)

## Objective

Integrate interactive subagents back into the primary tool scheduling pipeline while preserving the existing non-interactive path for true headless usage. All changes follow dev-docs/RULES.md (test-first, no mock-theater) and finish with full repo validation plus a non-interactive manual check.

## Phase 0 – Research & Groundwork

1. **Study Current Flow**
   - Review `packages/core/src/core/client.ts`, `Turn`, and `CoreToolScheduler` to map the foreground agent path.
   - Review `SubAgentScope.runNonInteractive`, `Task`, `SubagentOrchestrator`, and the existing `GemmaToolCallParser` usage.
   - Confirm how `agentId` propagates today and how the UI differentiates tool calls.
2. **Identify Hook Points**
   - Decide where to construct a `Turn` for subagents (likely `SubAgentScope.runInteractive`).
   - Determine how to instantiate a `CoreToolScheduler` (reuse or create per subagent) without duplicating state.
   - Work out how to switch between interactive/non-interactive modes (Task params, profile flag, or CLI detection).

## Phase 1 – Add Regression Coverage

3. **Test: Subagent Tool Calls Surface Interactively**
   - Write a new integration/unit test (e.g., in `packages/core/src/core/subagent.test.ts` or a dedicated suite) that:
     - Launches a subagent in interactive mode.
     - Asserts tool requests go through the scheduler (visible in `ToolCallTracker` or UI event stream) with correct `agentId`.
     - Fails initially because the current code bypasses the scheduler.
4. **Test: Fallback Non-Interactive**
   - Add a complementary test ensuring the non-interactive path still executes tools without scheduler involvement when explicitly requested.

For each test:

- Implement the failing test first.
- Run the specific test file via `npm run test -- <path>` to confirm it fails before implementation.

## Phase 2 – Implement Interactive Runner

5. **`SubAgentScope.runInteractive`**
   - Create a method that mirrors the client flow:
     - Build a `Turn` with `GeminiChat`, prompt ID, and `agentId` (`subagentId`).
     - Pump its events through a `CoreToolScheduler` instance (shared config, new scheduler per run).
     - Append responses back into the subagent history, just like the main client does.
   - Ensure `GemmaToolCallParser` is **not** used in this path; rely on provider-generated function calls.
6. **Task Tool Switch**
   - Update `TaskToolInvocation.execute` to choose interactive vs non-interactive based on a new flag (e.g., `params.run_limits?.interactive`, default `true`).
   - Update `SubagentOrchestrator` to pass the flag down.
7. **Deprecate Parser Use in Interactive Path**
   - Remove the direct calls to `GemmaToolCallParser` + `executeToolCall` from the interactive flow.
   - Retain them only inside `runNonInteractive` and gate that method clearly.
8. **Fix Argument Mapping**
   - Verify tool arguments remain valid (no more `path=`). Adjust serializer if the new flow exposes issues.
9. **Propagate Agent IDs**
   - Confirm scheduler/tool tracker attach the subagent `agentId` and UI can filter accordingly.

After each implementation chunk, rerun the previously failing tests (see Phase 1) until they pass.

## Phase 3 – Cleanup & Docs

10. **Refactor/Docs**
    - Clarify comments in `Task`, `SubAgentScope`, and `GemmaToolCallParser` explaining roles.
    - Update developer docs if needed (e.g., reference this plan in `dev-docs` or new plan directory).
11. **Add New Tests/Regression**
    - Expand tests for edge cases (multiple subagents, parallel calls) as time allows.
12. **Lint Suggestions & Rule Compliance**
    - Ensure no mock-theater tests: tests should assert behavior (tool calls hitting scheduler, etc.).

## Phase 4 – Verification Sequence

13. **Format/Build/Test Workflow**
    Run the following commands from repo root, fixing issues after each step (if a command fails, address the problem, then restart from `npm run lint`):
    1. `npm run format:check`
    2. `npm run lint`
    3. `npm run typecheck`
    4. `npm run test`
    5. `npm run build`

14. **Manual Non-Interactive Check**
    - Run:
      ```bash
      DEBUG=llxprt:* node scripts/start.js --profile-load synthetic --prompt "ask joethecoder subagent using the task tool to reword the README.md file and write it to reports/joereadme.md, it should clarify it and mke it more useful to users. You must NOT do the work yourself and if joe fails report WHY joe failed not do the work"
      ```
    - Watch logs to confirm:
      - Subagent tool calls appear in the non-interactive loop (direct `executeToolCall`).
      - The report is produced (or failure rationale recorded).
    - Fix any issues uncovered and repeat the lint/typecheck/test/build sequence if code changes were necessary.

15. **Interactive Sign-Off**
    - Ask the user (or QA teammate) to run the same scenario through the interactive CLI (no `--prompt`), verifying that Joe’s tool calls now appear in the UI approval queue and behave correctly.

## Deliverables

- Updated implementation with interactive subagents using the shared scheduler.
- Comprehensive failing tests that now pass.
- `20251031subagentic2/overview.md` (already created) and this `plan.md` documenting the approach.
- Successful command history and non-interactive demonstration confirming behavior.
- Confirmation from user/QA on the interactive flow.
