# Todo Continuation Fix - Plan 2 (Test-First Approach)

## Issue Summary

The current implementation (branch `issue475`) creates an infinite loop that prevents the model from making progress. The root cause is that the blocking logic in `sendMessageStream` triggers **immediately after every turn**, even when the model has pending tool calls or is actively working.

**Original Intent**: Block the return to user ONLY when:
1. The model's turn is complete (no pending tool calls)
2. Todos are still pending/in_progress
3. No `todo_pause` was called

**Current Buggy Behavior**: Blocks after every turn regardless of whether the model has pending work, creating a retry loop that prevents tool execution.

---

## Core Fix

**Track `hadToolCallsThisTurn` during event streaming to detect progress while keeping deferred completion events.**

The model should only be blocked from returning to the user when it has:
- Finished streaming all events
- Did NOT execute any tool calls during the turn (no progress made)
- Todos that are still incomplete
- Not called `todo_pause`

**Key Insight**: `turn.pendingToolCalls` is a historical log of tool calls made, not a queue of pending work. We need to track whether the model made tool calls during THIS turn by monitoring `ToolCallRequest` events during the stream loop.

---

## Test-First Implementation Plan

### Phase 1: Identify and Document Existing Tests

#### 1.1 Review Current Test Coverage

**Files to examine**:
- `packages/core/src/core/client.test.ts` - Main client tests (lines added in current branch)
- `packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts` - Continuation service tests
- `packages/cli/src/ui/hooks/useTodoContinuation.spec.ts` - Continuation hook tests
- `integration-tests/todo-continuation.e2e.test.js` - E2E continuation tests
- `integration-tests/todo-reminder.e2e.test.ts` - E2E reminder tests

**Action**: Run the following to understand what tests exist:
```bash
# List test files and their test cases
grep -n "describe\|it(" packages/core/src/core/client.test.ts | grep -i "todo\|reminder"
grep -n "describe\|it(" packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts
grep -n "describe\|it(" integration-tests/todo-continuation.e2e.test.js
grep -n "describe\|it(" integration-tests/todo-reminder.e2e.test.ts
```

**Document**: Create a list of existing tests that need to be adjusted vs new tests that need to be created.

---

### Phase 2: Write Failing Tests for Correct Behavior

**Testing Strategy**:
- Extend the existing Vitest suite in `packages/core/src/core/client.test.ts` to cover the new loop exits by stubbing `Turn.run` and inspecting retry behavior. The suite already mocks the Gemini chat layer, so we avoid long-running provider integration.
- Add focused unit tests around helper methods (`getTodoReminderForCurrentState`, `areTodoSnapshotsEqual`, etc.) where gaps remain so the reminder logic is fully specified.
- Keep end-to-end coverage limited to the current `integration-tests/todo-continuation.e2e.test.js` file; update assertions only if behaviours change instead of adding new slow scenarios.

#### 2.1 Unit Test Additions in `packages/core/src/core/client.test.ts`
For each case below, add the failing test first, run it, and confirm Vitest reports a failure before touching implementation:
- **"allows tool-driven progress without looping"** – Simulate a turn that emits a `ToolCallRequest` (progress) plus deferred completion. Expect `sendMessageStream` to invoke `Turn.run` exactly once, flush deferred events, reset reminder state, and exit without another iteration.
- **"retries once when no tool work and todos unchanged"** – Simulate a turn with only textual output and unchanged todos. Expect the loop to append a reminder, run one additional iteration, and then yield the buffered events.
- **"does not retry after todo_pause"** – Emit a `ToolCallResponse` containing `todo_pause` and verify the client flushes deferred events and returns immediately.
- **"duplicate todo write still triggers override retry"** – Ensure the `pendingRequestOverride` branch still resubmits the reminder-injected request rather than only producing a system notice.

Reuse the mocking helpers already present in the test file (e.g., `createClientWithMockedTurn`) so the tests remain deterministic and fast.

#### 2.2 Helper Method Coverage
- Add or tighten tests for `areTodoSnapshotsEqual`, `getActiveTodos`, and reminder escalation helpers to document snapshot comparison behaviour.

#### 2.3 Integration / E2E Touch Points
- Adjust expectations in `integration-tests/todo-continuation.e2e.test.js` only if reminder wording changes. No new provider-backed scenarios are required.

---

### Phase 3: Run Tests and Prove They Fail

After adding each test, run it in isolation and confirm it fails (Vitest exit code ≠ 0). Example commands:

```bash
# Tool progress should currently fail
vitest run packages/core/src/core/client.test.ts -t "allows tool-driven progress without looping"

# No-tool retry should currently fail
vitest run packages/core/src/core/client.test.ts -t "retries once when no tool work and todos unchanged"

# todo_pause escape hatch should currently fail
vitest run packages/core/src/core/client.test.ts -t "does not retry after todo_pause"

# Duplicate todo write guard should currently fail
vitest run packages/core/src/core/client.test.ts -t "duplicate todo write still triggers override retry"
```

Record the failing output as evidence before proceeding.

---

### Phase 4: Implement the Fix

#### 4.0 Pre-Implementation Context

Before making changes, understand the current code structure:

##### Current Code Overview (lines 1209-1450)

**Current problematic structure**:
```typescript
// Lines 1209-1215: Loop setup
let baseRequestForRetry = Array.isArray(initialRequest) ? [...] : initialRequest;
let pendingRequestOverride: PartListUnion | null = null;
let iteration = 0;
let lastTurn: Turn | undefined;

// Lines 1216-1450: Buggy loop
while (iteration < boundedTurns) {
  iteration += 1;

  // Complexity analysis only on iteration 1 (lines 1231-1263)
  if (iteration === 1) {
    // Analyze user message complexity, append todo suffix if needed
  }

  // Inject reminder if needed (lines 1265-1283)

  // Run turn (lines 1308-1377)
  for await (const event of resultStream) {
    // Defer Content/Finished/Citation
    // Yield tool events immediately
  }

  // BUG: Lines 1389-1391 - loops regardless of tool work
  const shouldContinue =
    (!todoPauseSeen && pendingTodosDetected) ||
    (hasPendingReminder && !todoPauseSeen);

  if (!shouldContinue) {
    // Flush deferred events and return
  }

  // Otherwise loop back with reminder
}
```

**Problem**: The `shouldContinue` check doesn't verify whether the model executed tools. It loops even when the model just called `todo_write` or ran shell commands.

##### Existing Helper Methods (Already Present)

These methods already exist in `client.ts` and will be reused:
- **`getTodoReminderForCurrentState(options?)`** (line 468) - Returns reminder text based on todo state
- **`appendSystemReminderToRequest(request, reminder)`** (line 494) - Adds system note to request
- **`shouldDeferStreamEvent(event)`** (line 517) - Returns true for Content/Finished/Citation
- **`isTodoPauseResponse(value)`** (line 525) - Detects todo_pause tool responses
- **`areTodoSnapshotsEqual(a, b)`** (line 431) - Compares todo snapshots
- **`getActiveTodos(todos)`** (line 461) - Filters pending/in_progress todos
- **`readTodoSnapshot()`** (line 403) - Reads current todo list from store

No new helper methods need to be added.

##### Variable Naming Changes

The fix renames variables for clarity:
- **`iteration`** → **`retryCount`** (makes purpose clearer)
- **`boundedTurns`** → **`MAX_RETRIES` (2)** (hard limit on retries)
- **`baseRequestForRetry`** → **`baseRequest`** (simpler name)
- **`pendingRequestOverride`** → removed (not needed with new structure)

##### Complexity Analysis - KEEP IT

The complexity analysis block (lines 1231-1263) should be **preserved** but adjusted:
- Currently runs when `iteration === 1`
- Change to run when `retryCount === 0` (same meaning, clearer intent)
- Purpose: Appends "Use TODO List to organize this effort" on first iteration for complex tasks
- This is separate from the retry logic and should remain

---

#### 4.1 Core Changes to `packages/core/src/core/client.ts`

**Location**: `sendMessageStream` method (lines ~1097-1450)

**Key Changes**:

1. Keep deferring `Content` / `Finished` / `Citation` events until after the retry decision so a turn only “finishes” once.
2. Track tool work by setting `hadToolCallsThisTurn = true` whenever a `ToolCallRequest` is observed.
3. On progress (`hadToolCallsThisTurn` true) or `todo_pause`, flush deferred events, reset reminder state, and return immediately.
4. When todos remain unfinished with no progress, prepare a reminder retry by reusing `pendingRequestOverride`, escalate only when snapshots match, and cap retries at two iterations.
5. Ensure every exit path resets `lastTodoSnapshot`, `toolCallReminderLevel`, and `toolActivityCount` to avoid leaking reminder state.

**Implementation**:

```typescript
async *sendMessageStream(
  initialRequest: PartListUnion,
  signal: AbortSignal,
  prompt_id: string,
  turns: number = this.MAX_TURNS,
  originalModel?: string,
): AsyncGenerator<ServerGeminiStreamEvent, Turn, undefined> {
  // ... existing setup code (lines 1107-1205) ...

  let baseRequest = Array.isArray(initialRequest)
    ? [...initialRequest as Part[]]
    : initialRequest;
  let retryCount = 0;
  const MAX_RETRIES = 2;
  let lastTurn: Turn | undefined;

  while (retryCount < MAX_RETRIES) {
    let request = Array.isArray(baseRequest)
      ? [...baseRequest as Part[]]
      : baseRequest;

    // KEEP: Complexity analysis for first iteration only
    if (retryCount === 0) {
      let shouldAppendTodoSuffix = false;

      if (Array.isArray(request) && request.length > 0) {
        const userMessage = request
          .filter((part) => typeof part === 'object' && 'text' in part)
          .map((part) => (part as { text: string }).text)
          .join(' ')
          .trim();

        if (userMessage.length > 0) {
          const analysis = this.complexityAnalyzer.analyzeComplexity(userMessage);
          const complexityReminder = this.processComplexityAnalysis(analysis);
          if (complexityReminder) {
            shouldAppendTodoSuffix = true;
          }
        } else {
          this.consecutiveComplexTurns = 0;
        }
      } else {
        this.consecutiveComplexTurns = 0;
      }

      if (shouldAppendTodoSuffix) {
        request = this.appendTodoSuffixToRequest(request);
      }
      baseRequest = Array.isArray(request)
        ? [...(request as Part[])]
        : request;
    } else {
      this.consecutiveComplexTurns = 0;
    }

    // Apply todo reminder if one is pending from previous iteration
    if (this.todoToolsAvailable && this.toolCallReminderLevel !== 'none') {
      const reminderResult = await this.getTodoReminderForCurrentState({
        todoSnapshot: this.lastTodoSnapshot,
        escalate: this.toolCallReminderLevel === 'escalated',
      });
      if (reminderResult.reminder) {
        request = this.appendSystemReminderToRequest(
          request,
          reminderResult.reminder,
        );
        this.lastTodoSnapshot = reminderResult.todos;
      }
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
    }

    const contentGenConfig = this.config.getContentGeneratorConfig();
    const providerManager = contentGenConfig?.providerManager;
    const providerName =
      providerManager?.getActiveProviderName() || 'backend';

    const turn = new Turn(
      this.getChat(),
      prompt_id,
      DEFAULT_AGENT_ID,
      providerName,
    );
    lastTurn = turn;

    const loopDetected = await this.loopDetector.turnStarted(signal);
    if (loopDetected) {
      yield { type: GeminiEventType.LoopDetected };
      return turn;
    }

    let hadToolCallsThisTurn = false;  // Track if model executed tools
    let todoPauseSeen = false;
    const deferredEvents: ServerGeminiStreamEvent[] = [];
    const resultStream = turn.run(request, signal);

    // Stream events, deferring Content/Finished/Citation until we decide on a retry

    /**
     * Event Yielding Rules
     * - Yield immediately: ToolCallRequest, ToolCallResponse, Error, LoopDetected, SystemNotice
     * - Defer (push to deferredEvents): Content, Finished, Citation
     * Rationale: we surface tool progress right away while keeping the completion
     * signals coherent once the retry decision is made.
     */
    // Helper stays as:
    // private shouldDeferStreamEvent(event: ServerGeminiStreamEvent): boolean {
    //   return (
    //     event.type === GeminiEventType.Content ||
    //     event.type === GeminiEventType.Finished ||
    //     event.type === GeminiEventType.Citation
    //   );
    // }
    for await (const event of resultStream) {
      if (this.loopDetector.addAndCheck(event)) {
        yield { type: GeminiEventType.LoopDetected };
        return turn;
      }

      this.recordModelActivity(event);

      // Track tool execution during this turn
      if (event.type === GeminiEventType.ToolCallRequest) {
        hadToolCallsThisTurn = true;
      }

      if (event.type === GeminiEventType.ToolCallResponse) {
        if (this.isTodoPauseResponse(event.value)) {
          todoPauseSeen = true;
        }
      }

      // Handle duplicate todo writes (KEEP existing logic)
      if (
        event.type === GeminiEventType.ToolCallRequest &&
        this.isTodoToolCall(event.value?.name)
      ) {
        this.lastTodoToolTurn = this.sessionTurnCount;
        this.consecutiveComplexTurns = 0;

        const requestedTodos = Array.isArray(event.value?.args?.todos)
          ? (event.value.args.todos as Todo[])
          : [];
        const currentTodos =
          this.lastTodoSnapshot ?? (await this.readTodoSnapshot());
        const activeTodos = this.getActiveTodos(currentTodos);
        const isDuplicateTodoWrite =
          requestedTodos.length > 0 &&
          this.areTodoContentsEqual(currentTodos, requestedTodos);

        if (isDuplicateTodoWrite && activeTodos.length > 0) {
          // Yield SystemNotice and skip to next event
          const reminder =
            this.todoReminderService.getUpdateActiveTodoReminder(
              activeTodos[0],
            );
          yield {
            type: GeminiEventType.SystemNotice,
            value: reminder,
          };
          continue; // Skip the rest of the event handling
        }

        if (requestedTodos.length > 0) {
          this.lastTodoSnapshot = requestedTodos.map((todo) => ({
            id: `${(todo as Todo).id ?? ''}`,
            content: (todo as Todo).content ?? '',
            status: (todo as Todo).status ?? 'pending',
            priority: (todo as Todo).priority ?? 'medium',
          }));
        }
      }

      if (this.shouldDeferStreamEvent(event)) {
        deferredEvents.push(event);
      } else {
        yield event;
      }

      if (event.type === GeminiEventType.Error) {
        for (const deferred of deferredEvents) {
          yield deferred;
        }
        return turn;
      }
    }

    // Turn stream is now complete. Decide if we should retry.

    // NEW: Check if model made progress by executing tools FIRST
    // This is the key fix - check hadToolCallsThisTurn before reading todos
    if (hadToolCallsThisTurn) {
      // Model executed tools - that's progress, flush deferred events and exit
      const reminderState = await this.getTodoReminderForCurrentState();
      for (const deferred of deferredEvents) {
        yield deferred;
      }
      this.lastTodoSnapshot = reminderState.todos;
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return turn;
    }

    // No tool work detected - check todo/pause state
    const reminderState = await this.getTodoReminderForCurrentState();
    const latestSnapshot = reminderState.todos;
    const activeTodos = reminderState.activeTodos;

    if (todoPauseSeen) {
      // Model explicitly paused - respect that
      for (const deferred of deferredEvents) {
        yield deferred;
      }
      this.lastTodoSnapshot = latestSnapshot;
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return turn;
    }

    // Check if todos are still pending
    const todosStillPending = activeTodos.length > 0;

    if (!todosStillPending) {
      // All todos complete or list is empty - return normally
      for (const deferred of deferredEvents) {
        yield deferred;
      }
      this.lastTodoSnapshot = latestSnapshot;
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return turn;
    }

    // Model tried to return with incomplete todos - check if we should retry
    retryCount++;

    if (retryCount >= MAX_RETRIES) {
      // Hit retry limit - return anyway, let continuation service handle it
      for (const deferred of deferredEvents) {
        yield deferred;
      }
      this.lastTodoSnapshot = latestSnapshot;
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return turn;
    }

    // Prepare retry with escalated reminder
    const previousSnapshot = this.lastTodoSnapshot ?? [];
    const snapshotUnchanged = this.areTodoSnapshotsEqual(
      previousSnapshot,
      latestSnapshot,
    );

    const followUpReminder = (
      await this.getTodoReminderForCurrentState({
        todoSnapshot: latestSnapshot,
        activeTodos,
        escalate: snapshotUnchanged,
      })
    ).reminder;

    this.lastTodoSnapshot = latestSnapshot;

    if (!followUpReminder) {
      // No reminder to add - flush and return
      for (const deferred of deferredEvents) {
        yield deferred;
      }
      this.toolCallReminderLevel = 'none';
      this.toolActivityCount = 0;
      return turn;
    }

    // Set up retry request with reminder
    baseRequest = this.appendSystemReminderToRequest(
      baseRequest,
      followUpReminder,
    );

    // Loop back for one more try
  }

  // Shouldn't reach here, but return last turn if we do
  return lastTurn!;
}
```

#### 4.2 Keep Continuation Service Changes (No Revert Needed)

**File**: `packages/cli/src/services/todo-continuation/todoContinuationService.ts`

**Lines**: 500-507

**Status**: **KEEP EXISTING CHANGES** from issue #475 branch

The continuation service enhancement that allows resuming after tool activity is **correct** and should be preserved. The fix is in the client loop logic (checking `hadToolCallsThisTurn`), not in the continuation service.

**Why this is correct**:
- The continuation service should allow re-prompting when todos are incomplete, even if tools ran
- The client loop now handles immediate post-turn blocking (when model tries to respond with just text)
- The continuation service provides a backup mechanism for later turns
- Together they form a layered defense: client catches immediate "empty responses", continuation catches "abandoned work"

**No changes needed here**

---

### Phase 5: Run Tests and Prove They Pass

```bash
# Re-run the updated Vitest suite for the client
vitest run packages/core/src/core/client.test.ts

# Spot-check the existing continuation E2E (optional if unchanged)
vitest run --root ./integration-tests todo-continuation.e2e.test.js -t "auto-resume blocks response until todo progress"

# Run the workspace test umbrella to ensure nothing else regressed
npm run test
```

Expect all commands to exit with code 0.

---

### Phase 6: Manual Verification

After automated tests pass, run manual tests:

```bash
# Test 1: Simple task with todos (non-interactive)
node scripts/start.js --profile-load cerebrasglm46 \
  "Create a todo with 2 tasks: copy README.md to /tmp/test.md and verify it exists. Complete both tasks."

# Expected: Model creates todos, executes both tasks, completes naturally

# Test 2: Complex multi-step task (non-interactive)
node scripts/start.js --profile-load cerebrasglm46 \
  "copy README.md to ./tmp/README.jp.md using shell and translate to Japanese, keeping code blocks in English"

# Expected: Model creates todos, works through them, no infinite loop

# Test 3: Interactive mode test
# Start interactive session
node scripts/start.js --profile-load cerebrasglm46

# Then issue prompt:
# "Create 3 todos and complete the first one"

# Expected: See streaming progress, todos update, no blocking until truly done

# Test 4: Verify todo_pause works
node scripts/start.js --profile-load cerebrasglm46 \
  "Create a todo that requires a missing file, then pause"

# Expected: Model calls todo_pause, returns to user without looping
```

---

## Success Criteria

✅ **Unit tests pass**: All new tests in Phase 2 pass
✅ **Integration tests pass**: E2E tests complete without timeout
✅ **No infinite loops**: Retry count stays under 3 in all scenarios
✅ **Events stream immediately**: User sees progress in real-time
✅ **Tool work respected**: Model can execute tools without being blocked mid-turn
✅ **todo_pause honored**: Model can explicitly stop without forced retries
✅ **Reminders still hidden**: System notes don't appear in user-visible history
✅ **Manual tests work**: All 4 manual scenarios complete successfully

---

## Rollback Plan

If the fix introduces regressions:

1. Create a new branch from `main` called `issue475-rollback`
2. Cherry-pick only the non-problematic commits:
   - Reminder format changes (if any)
   - Tool activity counting fix (only count ToolCallResponse)
3. Leave the internal loop logic as it was in `main`
4. Open a new issue documenting what went wrong

---

## Implementation Summary

**What gets replaced**: Lines 1209-1450 (entire loop structure)
**What stays the same**:
- Complexity analysis (adapted for retryCount)
- Duplicate todo write detection
- Event deferring with `shouldDeferStreamEvent` (already exists)
- All helper methods (no new ones needed)

**Key changes**:
- `iteration` → `retryCount` (0-indexed, max 2)
- `boundedTurns` → `MAX_RETRIES = 2` (hard limit)
- Add `hadToolCallsThisTurn` tracking
- Check tool work BEFORE checking todos
- Remove `pendingRequestOverride` mechanism (not needed)

---

## Notes

- **Key insight**: Track `hadToolCallsThisTurn` during the stream loop to detect if the model made progress. `turn.pendingToolCalls` is a historical log, not a queue of pending work.
- **Keep deferring `Content`/`Finished` events** until the retry decision is made so downstream consumers still see a single coherent turn.
- **Limiting retries to 2** prevents infinite loops while still giving the model a second chance
- **Continuation service stays enhanced** - it works in tandem with the client loop for layered protection
- **Testing strategy**: Unit tests for helper methods, integration/E2E tests for full flow behavior (mocking Turn is impractical)
- **Performance**: The extra deferral step only waits for a todo snapshot read (<50 ms). Streaming completion immediately would require retracting it on retry, which is more confusing for users.

---

### Change Log for Claude
- Replaced the new integration-test heavy plan with extensions to the existing Vitest unit suite to avoid slow provider-dependent runs and reuse current mocks.
- Clarified that `Finished`/`Content` events remain deferred until the retry decision so consumers aren’t confused by multiple turn endings.
- Preserved the `pendingRequestOverride` retry path by keeping deferred queuing instead of switching to inline `SystemNotice` responses.
- Added explicit state resets (`lastTodoSnapshot`, `toolCallReminderLevel`, `toolActivityCount`) on every early return branch so reminders don’t linger.
- Ensured we update `lastTodoSnapshot` even when tool work occurred, so later comparisons and escalation stay accurate.

---

End of Plan 2
