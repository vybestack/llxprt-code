# Todo Reminder Remediation Plan (Test-First)

This plan rewrites the fix for issue #475 in strict test-first order per `dev-docs/RULES.md`. Every behavior change begins with a failing test, verified before implementation. The goal is to make the steps executable even by a very literal model.

---

## 1. Objectives

1. Move todo reminders out of user-visible history and into hidden system guidance.
2. Tailor reminder copy depending on whether a todo list exists and which task is active.
3. Count only completed tool calls when deciding to emit reminders.
4. Block user-facing responses until todos are complete or explicitly paused via `todo_pause`.
5. Update continuation so unfinished todos resume even after tool activity.

---

## 2. Preparatory Notes

- Reminder: `GeminiClient`/`GeminiChat` is the shared request pipeline for **all** providers (OpenAI, Anthropic, Gemini, etc.). Anything we inject in `sendMessageStream` affects every backend automatically.
- Touchpoints: `GeminiClient`, `GeminiChat`, `TodoReminderService`, `TodoStore`, `ToolCallTrackerService` (or adjacent logic), `TodoContinuationService`, relevant unit and integration tests.
- All changes must start with failing tests. Do **not** touch production code until the tests are in place.

---

## 3. Test-First Execution Plan

### Step 3.1 – Add Failing Unit Tests
1. **Reminders stay out of history / are injected into requests**
   - File: `packages/core/src/core/client.test.ts`
   - New test cases:
     - When the reminder threshold is hit, `sendMessageStream` augments the outgoing request with the reminder text (assert the `Part` array contains `System Note`) and never calls `chat.addHistory` with that text.
     - Reminder variant selection uses todo state (empty vs active todo). Stub `TodoStore` so the test can force the store output.
   - Run `npm run test -- --runTestsByPath packages/core/src/core/client.test.ts`.
   - Confirm failure because the behavior is not yet implemented.

2. **Completed tool call counting**
   - File: `packages/core/src/core/client.test.ts` (same suite).
   - Add a test ensuring the reminder counter increments only on `ToolCallResponse` events, not on `Content`.
   - Run the targeted test; expect failure.
3. **Blocking premature responses**
   - File: `packages/core/src/core/client.test.ts`
   - Add a test showing that when todos remain `pending`/`in_progress` and no `todo_pause` has occurred, `sendMessageStream` does **not** return a final user-facing turn; instead it schedules another iteration (e.g., expect a reminder part and that the method keeps streaming).
   - Run the targeted test; expect failure (current code allows the response).
4. **todo_pause escape hatch**
   - File: `packages/core/src/core/client.test.ts`
   - Add a complementary test proving that when a `todo_pause` tool response is observed, the client is allowed to yield the response back to the user even if todos remain.
   - Run the test; expect failure until the new pause detection is implemented.

5. **Continuation logic**
   - File: `packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts`
   - Add tests:
     - Continuation triggers even when `hadToolCalls` is true if unfinished todos remain.
     - Continuation does not trigger once `todo_pause` is signaled.
   - Run `npm run test -- --runTestsByPath packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts`.
   - Confirm failure.

6. **Optional targeted tests**
   - If needed, add a dedicated spec for the new reminder copy in `packages/core/src/services/todo-reminder-service.test.ts` (create file if absent).

### Step 3.2 – Add Failing Integration/E2E Tests
1. **Continuation E2E**
   - File: `integration-tests/todo-continuation.e2e.test.js`
   - Add scenario: agent runs a tool, leaves todo pending, verify autoresume prompt fires automatically until todo is updated or paused.
   - Run `npm run test -- --runTestsByPath integration-tests/todo-continuation.e2e.test.js`.
   - Expect failure (missing behavior).

2. **Reminder visibility**
   - Consider a new integration test (e.g., `integration-tests/todo-reminder.e2e.test.js`) that:
     - Executes multiple tools without creating todos.
     - Asserts the user transcript lacks the reminder text while captured request payloads (or debug hooks) show the injected `System Note`.
   - Run the new test and confirm it fails initially.

### Step 3.3 – Implement Code Changes
Only after all the above tests fail:
1. **Reminder injection (shared across providers)**
   - In `GeminiClient.sendMessageStream`, before calling `turn.run`, append the reminder text as a new `Part` on the outgoing `request` array (e.g., `requestParts.push({ text: reminderText })`).
   - Delete the existing `this.getChat().addHistory({ role: 'model', ... })` block so reminders never hit history.
   - Add `private async getTodoReminderForCurrentState(): Promise<string | null>` to `GeminiClient`:
     1. Read todos via `await new TodoStore(sessionId, agentId).readTodos()`.
     2. Return the appropriate reminder string (or `null`) using `TodoReminderService`.
2. **Reminder variants**
   - Extend `TodoReminderService` with:
     - `getCreateListReminder(detectedTasks: string[])`
     - `getUpdateActiveTodoReminder(todo: Todo)`
   - Both methods must wrap the text in `---\nSystem Note: ...\n---` so downstream providers recognize it as system guidance.
3. **Completed tool-call counting**
   - In `recordModelActivity`, increment `toolActivityCount` only when `event.type === GeminiEventType.ToolCallResponse`.
   - Reset the counter (and reminder level) at the same points as today (after firing or at turn boundaries).
4. **Prevent premature user responses**
   - Inside `sendMessageStream`, track two booleans:
     - `todoPauseSeen` → set to `true` whenever a tool response for `todo_pause` arrives during the stream loop.
     - `pendingTodosDetected` → evaluate after the loop by loading the todo list.
   - If the loop finishes and `pendingTodosDetected` is true while `todoPauseSeen` is false:
     1. Compare the current todo snapshot with the one from the previous attempt (store `lastTodoSnapshot` on the client; compare via deep equality). If unchanged, escalate the reminder copy (e.g., “Update status or call todo_pause”).
     2. Append the reminder part, set a `forceFollowUp` flag, and continue the send loop instead of returning the `Turn` to the caller. This blocks the user-facing reply until todos are completed or paused.
5. **Continuation adjustments**
   - In `TodoContinuationService.evaluateAllConditions`, change the logic so `noToolCallsMade` is treated as `true` unless a todo list is empty or a `todo_pause` flag is present. In other words, running tools no longer suppresses continuation when unfinished todos exist.
   - Update the CLI wiring in `packages/cli/src/ui/hooks/useTodoContinuation.ts` so `ContinuationContext` includes a `todoPaused` indicator whenever a `todo_pause` tool result is observed. This lets continuation stand down only when the model explicitly pauses.

### Step 3.4 – Re-run Tests to Confirm Pass
1. Run targeted unit tests added in Step 3.1.
2. Run integration tests from Step 3.2.
3. Run the full suite (`npm run test`) to confirm global pass.

---

## 4. Manual Verification & Prompt Checks

After automated tests pass:
1. Run standard checks:
   ```
   npm run format:check
   npm run lint
   npm run typecheck
   npm run test
   npm run build
   ```
2. Execute synthetic prompts to ensure runtime behavior:
   ```
   node scripts/start.js --profile-load synthetic --prompt "create a todo list with three tasks, run a tool, and finish everything before replying"
   node scripts/start.js --profile-load synthetic --prompt "run a shell command without creating todos and observe hidden reminders"
   node scripts/start.js --profile-load synthetic --prompt "create a todo, run a tool, then try to reply before completion to verify continuation kicks in"
   node scripts/start.js --profile-load synthetic --prompt "trigger todo_pause and confirm the system allows returning to the user"
   ```
3. Verify the transcript contains no visible reminder spam and that todos are enforced correctly.

---

## 5. Rollback Plan

If regression occurs:
1. `git revert` the commits touching `GeminiClient`, `GeminiChat`, `TodoReminderService`, `TodoContinuationService`, and new tests.
2. Restore the original reminder behavior temporarily to unblock users.
3. Open follow-up issues for any residual problems discovered during testing.

---

## 6. Open Questions / Follow-ups

1. **Performance**: reading `TodoStore` every turn might add I/O overhead; monitor and optimize if needed.
2. **Provider Scope**: confirm whether OpenAI/Anthropic providers need similar hidden reminder logic or already behave correctly.
3. **Threshold Tuning**: keep telemetry on reminder frequency; adjust the four-call threshold if models still overreact.

Once the plan is executed test-first and all prompts/tests pass, close issue #475.

---

End of plan.
