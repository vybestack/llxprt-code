# Todo Continuation Test Coverage Report

## Executive Summary

The codebase has comprehensive test coverage for todo continuation functionality across multiple layers (unit, integration, E2E). However, **the four specific Phase 2 test cases from the plan do not yet exist** in the current test suite:

1. ❌ "allows tool-driven progress without looping"
2. ❌ "retries once when no tool work and todos unchanged"
3. ❌ "does not retry after todo_pause"
4. ❌ "duplicate todo write still triggers override retry"

These tests need to be added to `packages/core/src/core/client.test.ts` to verify the Phase 2 fix behavior.

---

## Test Coverage by File

### 1. packages/core/src/core/client.test.ts

**Describe Block**: `describe('sendMessageStream', () => {...})`  
**Scope**: Core todo/reminder loop logic at the client level

#### Existing Tests (10 tests)

1. ✓ **Line 1284** - `it('appends a todo suffix on later complex turns')`
   - **Coverage**: Complexity analysis triggers todo suffix on 2nd+ turns
   - **Relevant to Phase 2**: Partial (affects initial iteration)

2. ✓ **Line 1376** - `it('does not append the todo suffix when complexity does not trigger')`
   - **Coverage**: No suffix when complexity is low
   - **Relevant to Phase 2**: No

3. ✓ **Line 1447** - `it('skips todo reminders when todo tools are unavailable')`
   - **Coverage**: Disables reminders when tools not available
   - **Relevant to Phase 2**: No

4. ✓ **Line 1528** - `it('escalates to a stronger reminder after repeated complex turns without todo usage')`
   - **Coverage**: Reminder escalation after multiple turns without tool use
   - **Relevant to Phase 2**: Partial (related to retry logic)

5. ✓ **Line 1635** - `it('injects a hidden todo reminder note when no todos exist after four tool call responses')`
   - **Coverage**: Creates reminder when tools executed but no todos exist
   - **Relevant to Phase 2**: Partial (tool activity tracking)

6. ✓ **Line 1738** - `it('uses the active todo reminder variant when a todo list exists')`
   - **Coverage**: Uses different reminder when todos exist
   - **Relevant to Phase 2**: Partial (reminder selection)

7. ✓ **Line 1847** - `it('retries sendMessageStream until todos are resolved when todo_pause is not signaled')`
   - **Coverage**: Retries when todos pending and no todo_pause
   - **Relevant to Phase 2**: **HIGH** - Core retry mechanism, but needs tool progress distinction

8. ✓ **Line 1942** - `it('allows a user-facing response once a todo_pause tool response is observed')`
   - **Coverage**: Exits loop when todo_pause is seen
   - **Relevant to Phase 2**: **HIGH** - Todo pause exit condition

9. ✓ **Line 2039** - `it('emits a system notice instead of executing duplicate todo_write requests')`
   - **Coverage**: Guards duplicate todo writes with system notice
   - **Relevant to Phase 2**: **HIGH** - Duplicate override retry behavior

10. ✓ **Line 962** - `it('only counts completed tool call responses toward reminders')`
    - **Coverage**: Tool activity counting (recordModelActivity)
    - **Relevant to Phase 2**: Partial (affects hadToolCallsThisTurn tracking)

#### Missing Tests for Phase 2

- ❌ **"allows tool-driven progress without looping"**
  - Should test that a turn with ToolCallRequest event exits WITHOUT retry
  - Currently: Tests exist that track tool calls, but none specifically verify single-iteration completion with tool work
  - Requirement: Turn runs once, deferred events flush, no additional iteration despite pending todos

- ❌ **"retries once when no tool work and todos unchanged"**
  - Should test loop iteration when only textual output with unchanged todos
  - Currently: Line 1847 test retries multiple times, but doesn't verify single retry + escalation
  - Requirement: One retry attempt with escalated reminder, then return

- ❌ **"does not retry after todo_pause"**
  - Should test immediate exit when todo_pause is detected
  - Currently: Line 1942 test covers this partially (tests single-iteration exit)
  - Requirement: Verify deferred events are flushed and reminder state is cleared

- ❌ **"duplicate todo write still triggers override retry"**
  - Should test that duplicate write detection still allows retry with reminder
  - Currently: Line 2039 tests the SystemNotice emission but not the retry/override flow
  - Requirement: Verify pendingRequestOverride mechanism and retry loop continuation

---

### 2. packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts

**Scope**: Service-level continuation logic (user-facing continuation prompts)

#### Existing Tests Coverage

**Describe Block**: `describe('TodoContinuationService', () => {...})`

- ✓ 30+ tests covering:
  - Prompt generation for standard and YOLO modes
  - Continuation condition checking
  - Task description extraction
  - State management
  - Edge cases

**Key Test Areas**:
1. **Prompt Generation** (REQ-002.1, REQ-002.2, REQ-002.3)
   - Different prompts for standard vs YOLO mode
   - Task description incorporation
   - Truncation of long descriptions

2. **Continuation Logic** (REQ-002.1)
   - Should continue when todos active and no tool calls made ✓
   - Should not continue when no active todos ✓
   - Should not continue when disabled in config ✓
   - Respects `todo_pause` ✓
   - Respects maximum attempt limits ✓

3. **Helper Methods**
   - `shouldContinue()` - boolean logic for continuation decision
   - `formatPrompt()` - prompt formatting
   - `shouldAllowContinuation()` - checks config and state

**Relevant to Phase 2**: LOW - This is user-facing continuation, not the client-side retry mechanism

---

### 3. packages/cli/src/ui/hooks/useTodoContinuation.spec.ts

**Scope**: React hook for UI-level continuation handling

#### Existing Tests Coverage

**Describe Block**: `describe('useTodoContinuation - Behavioral Tests', () => {...})`

- ✓ 20+ tests covering:
  - Stream completion detection
  - Prompt generation with YOLO mode
  - Todo context integration
  - State management
  - Edge cases (rapid completions, setting changes, malformed todos)

**Key Test Areas**:
1. **Stream Completion Detection** (REQ-001.1-001.4)
   - Triggers when no tool calls and todos active ✓
   - Does not trigger without active todos ✓
   - Respects `todo-continuation` setting ✓
   - Does not trigger when AI is currently responding ✓

2. **Prompt Generation** (REQ-002.1-002.2)
   - Selects most relevant active task ✓
   - Different prompt wording for YOLO mode ✓
   - Ephemeral flag prevents history storage ✓

3. **Integration & Edge Cases**
   - Handles rapid completions ✓
   - Respects setting changes mid-stream ✓
   - Handles malformed todos gracefully ✓
   - Prevents continuation loops ✓

**Relevant to Phase 2**: LOW - This is UI-level continuation, not core client loop logic

---

### 4. integration-tests/todo-continuation.e2e.test.js

**Scope**: End-to-end continuation behavior with real model

#### Existing Tests Coverage

**Test Cases** (7 tests):
1. ✓ Basic todo continuation flow (REQ-001)
2. ✓ Tool call suppression prevents continuation (REQ-002)
3. ✓ Auto-resume blocks response until todo progress (REQ-004)
4. ✓ Todo pause tool usage (REQ-003)
5. ✓ Setting toggle disables continuation (REQ-004)
6. ✓ YOLO mode enhanced continuation prompts (REQ-005)
7. ✓ Multiple active todos continuation priority (REQ-006)
8. ✓ No continuation without active todos (REQ-007)
9. ✓ State validation and consistency (REQ-008)
10. ✓ Timing verification for continuation triggers (REQ-009)

**Relevant to Phase 2**: MODERATE
- Tests verify final behavior from user perspective
- E2E tests do NOT directly test `hadToolCallsThisTurn` tracking
- Would need updating only if reminder wording changes

---

### 5. integration-tests/todo-reminder.e2e.test.ts

**Scope**: Hidden todo reminders (system notes not visible to user)

#### Existing Tests Coverage

**Test Cases** (1 test):
1. ✓ Hidden todo reminders stay out of transcript (REQ-005)
   - Verifies system note reminders don't leak into user-visible output
   - Checks `System Note` isn't shown to user

**Relevant to Phase 2**: LOW
- Verifies hidden reminder implementation
- Would only need updating if reminder mechanism changes

---

## Phase 2 Test Gap Analysis

### Missing Test 1: "allows tool-driven progress without looping"

**What it should test**:
```typescript
it('allows tool-driven progress without looping', async () => {
  // Setup: Turn will emit ToolCallRequest + Finished events
  // Verify: sendMessageStream runs Turn.run() exactly once
  //         Deferred events are yielded
  //         No retry iteration occurs
  //         lastTodoSnapshot and reminder state are reset
})
```

**Current Gap**: No test verifies single-iteration completion when tool work occurs

**Why it matters**: Core to Phase 2 fix - the key is checking `hadToolCallsThisTurn` BEFORE checking todo snapshots

---

### Missing Test 2: "retries once when no tool work and todos unchanged"

**What it should test**:
```typescript
it('retries once when no tool work and todos unchanged', async () => {
  // Setup: First turn emits only Content/Finished (no ToolCallRequest)
  //        Todo snapshot unchanged between turns
  // Verify: sendMessageStream runs Turn.run() twice
  //         Second call includes escalated reminder
  //         Returns after max retries (2)
})
```

**Current Gap**: Line 1847 test retries until todos are resolved, but doesn't test:
- Retrying with UNCHANGED todo snapshot (escalation trigger)
- Stopping at MAX_RETRIES = 2 hard limit
- Proper reminder escalation

**Why it matters**: Verifies retry cap prevents infinite loops while giving model second chance

---

### Missing Test 3: "does not retry after todo_pause"

**What it should test**:
```typescript
it('does not retry after todo_pause', async () => {
  // Setup: Turn emits ToolCallResponse with todo_pause tool call
  //        Todos remain pending
  // Verify: sendMessageStream runs Turn.run() exactly once
  //         Deferred events are yielded
  //         No retry occurs
  //         lastTodoSnapshot and reminder state are reset
})
```

**Current Gap**: Line 1942 test verifies exit on todo_pause, but doesn't clearly distinguish from tool-work exit

**Why it matters**: Verifies escape hatch works - model can opt out of retry loop

---

### Missing Test 4: "duplicate todo write still triggers override retry"

**What it should test**:
```typescript
it('duplicate todo write still triggers override retry', async () => {
  // Setup: Turn 1: Emits ToolCallRequest (todo_write) with todos
  // Setup: Turn 2: Emits ToolCallRequest (todo_write) with same todos
  // Verify: Second turn yields SystemNotice instead of ToolCallRequest
  //         But continuation loop continues (pendingRequestOverride triggers)
  //         Turn.run() called 3+ times (initial + reminder retry + override)
})
```

**Current Gap**: Line 2039 test verifies SystemNotice, but doesn't verify:
- That the loop continues with override reminder
- That pendingRequestOverride mechanism appends reminder to request
- That Turn.run() is called multiple times

**Why it matters**: Verifies guard against duplicate writes while maintaining retry mechanism

---

## Recommendations for Phase 2 Implementation

### 1. Add Tests to packages/core/src/core/client.test.ts

Location: Within the `describe('sendMessageStream', () => {...})` block

Add these 4 new tests **before modifying client.ts**:

```typescript
// Test 1: Tool-driven progress exit
it('allows tool-driven progress without looping', async () => {
  // Mock: Track hadToolCallsThisTurn by checking ToolCallRequest event
  // Verify: Turn.run() called once, deferred events yielded, no retry
})

// Test 2: Retry with escalation on unchanged todos
it('retries once when no tool work and todos unchanged', async () => {
  // Mock: First turn = Content only, todos unchanged
  // Verify: Turn.run() called twice, second has escalated reminder, stops
})

// Test 3: Exit on todo_pause
it('does not retry after todo_pause', async () => {
  // Mock: Turn emits ToolCallResponse with todo_pause
  // Verify: Turn.run() called once, deferred events yielded
})

// Test 4: Duplicate write retry
it('duplicate todo write still triggers override retry', async () => {
  // Mock: Two turns with same todo_write
  // Verify: SystemNotice emitted, loop continues with reminder retry
})
```

### 2. Use Existing Test Infrastructure

The client.test.ts file already has:
- `mockTurnRunFn` - Mock for Turn.run()
- `vi.mocked()` - For assertions on mock calls
- `fromAsync()` utility - For consuming streams
- Complete GeminiEventType enum usage
- TodoReminderService mocking

**No new infrastructure needed** - reuse existing patterns

### 3. Run Tests Before Implementation

```bash
# After adding tests, run individually to verify they fail
npm run test -- packages/core/src/core/client.test.ts -t "allows tool-driven progress without looping"
npm run test -- packages/core/src/core/client.test.ts -t "retries once when no tool work"
npm run test -- packages/core/src/core/client.test.ts -t "does not retry after todo_pause"
npm run test -- packages/core/src/core/client.test.ts -t "duplicate todo write"
```

All should exit with non-zero status (test failures)

### 4. Integration Test Updates

The E2E tests in `integration-tests/todo-continuation.e2e.test.js` may need:
- Assertion updates if reminder wording changes
- No new test scenarios required per the plan

### 5. No Changes Needed To

- `todoContinuationService.spec.ts` - Service logic unchanged
- `useTodoContinuation.spec.ts` - Hook logic unchanged  
- `todo-reminder.e2e.test.ts` - Hidden reminder mechanism unchanged

---

## Test Structure Summary

```
Client Loop Tests (client.test.ts)               <- ADD 4 NEW TESTS HERE
├── Existing: retry behavior with todos
├── Existing: todo_pause handling
├── Existing: duplicate write detection
├── NEW: tool-driven progress (no retry)
├── NEW: retry with escalation (unchanged todos)
├── NEW: immediate exit (todo_pause)
└── NEW: override retry (duplicate writes)

Service Layer Tests (todoContinuationService.spec.ts)
├── Continuation conditions
├── Prompt generation
└── Task extraction

UI Hook Tests (useTodoContinuation.spec.ts)
├── Stream completion detection
├── Prompt generation
└── State management

E2E Tests (todo-continuation.e2e.test.js)
├── Basic continuation flow
├── Tool suppression
├── Auto-resume blocking
├── Todo pause
├── Setting toggle
├── YOLO mode
├── Priority selection
├── No active todos
└── State consistency

E2E Tests (todo-reminder.e2e.test.ts)
└── Hidden reminders not leaked
```

---

## Conclusion

The codebase has **good test coverage for todo continuation at the service and UI layers**, but **missing critical unit tests for the client-side retry loop behavior** specified in Phase 2.

The four missing tests directly validate the core fix:
1. ✅ Track `hadToolCallsThisTurn` during stream
2. ✅ Check tool work BEFORE checking todos
3. ✅ Respect `todo_pause` escape hatch
4. ✅ Maintain duplicate write override mechanism

These tests use existing infrastructure and patterns, require no new test utilities, and can be implemented in client.test.ts alongside existing tests.

