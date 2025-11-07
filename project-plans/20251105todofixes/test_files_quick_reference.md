# Test Files Quick Reference

## File Locations and Line Numbers

### Core Client Tests
**File**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.test.ts`

**Main Test Suite**: Line 1005-3452 (describe('sendMessageStream'))

**Existing Todo/Reminder Related Tests**:
- Line 962: `it('only counts completed tool call responses toward reminders')`
- Line 1284: `it('appends a todo suffix on later complex turns')`
- Line 1376: `it('does not append the todo suffix when complexity does not trigger')`
- Line 1447: `it('skips todo reminders when todo tools are unavailable')`
- Line 1528: `it('escalates to a stronger reminder after repeated complex turns without todo usage')`
- Line 1635: `it('injects a hidden todo reminder note when no todos exist after four tool call responses')`
- Line 1738: `it('uses the active todo reminder variant when a todo list exists')`
- Line 1847: `it('retries sendMessageStream until todos are resolved when todo_pause is not signaled')`
- Line 1942: `it('allows a user-facing response once a todo_pause tool response is observed')`
- Line 2039: `it('emits a system notice instead of executing duplicate todo_write requests')`

**Insert New Tests After**: Line 2177 (after the duplicate todo_write test)

**Test Infrastructure Available**:
- `mockTurnRunFn` - Mock for Turn.run()
- `mockChat` - Mock GeminiChat instance
- `mockGenerator` - Mock ContentGenerator
- `todoStoreReadMock` - Mock todo store read
- `vi.mocked()` - Vitest mock assertion utility
- `fromAsync()` - Stream consumption utility

---

### Service Layer Tests
**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts`

**Coverage**: 30+ tests (approx. lines 1-569)

**Test Suite**: `describe('TodoContinuationService', () => {...})`

**Key Test Areas**:
- Line 63-103: Prompt generation for standard mode
- Line 105-134: YOLO mode prompts
- Line 177-319: Continuation logic
- Line 341-432: Task description extraction
- Line 435-509: Edge cases

**Relevant to Phase 2**: LOW (Service layer, not core client loop)

---

### UI Hook Tests
**File**: `/Users/acoliver/projects/llxprt-code/packages/cli/src/ui/hooks/useTodoContinuation.spec.ts`

**Coverage**: 20+ tests (approx. lines 1-657)

**Test Suite**: `describe('useTodoContinuation - Behavioral Tests', () => {...})`

**Key Test Areas**:
- Line 107-237: Stream completion detection
- Line 240-330: Prompt generation
- Line 333-395: Integration with TodoContext
- Line 398-458: State management
- Line 461-598: Edge cases
- Line 601-655: Configuration integration

**Relevant to Phase 2**: LOW (UI hook layer, not core client loop)

---

### E2E Tests - Continuation
**File**: `/Users/acoliver/projects/llxprt-code/integration-tests/todo-continuation.e2e.test.js`

**Coverage**: 10 test cases (approx. lines 1-636)

**Test Cases**:
- Line 23: Basic todo continuation flow
- Line 87: Tool call suppression prevents continuation
- Line 152: Auto-resume blocks response until todo progress
- Line 202: Todo pause tool usage
- Line 276: Setting toggle disables continuation
- Line 337: YOLO mode enhanced continuation prompts
- Line 401: Multiple active todos continuation priority
- Line 462: No continuation without active todos
- Line 513: State validation and consistency
- Line 582: Timing verification for continuation triggers

**Relevant to Phase 2**: MODERATE (E2E verification, would need assertion updates if reminder wording changes)

---

### E2E Tests - Reminders
**File**: `/Users/acoliver/projects/llxprt-code/integration-tests/todo-reminder.e2e.test.ts`

**Coverage**: 1 test case (lines 1-54)

**Test Case**:
- Line 23: Hidden todo reminders stay out of transcript

**Relevant to Phase 2**: LOW (Verifies hidden reminder mechanism)

---

## Where to Add Phase 2 Tests

**Primary Location**: `/Users/acoliver/projects/llxprt-code/packages/core/src/core/client.test.ts`

**Insert Point**: After line 2177 (end of duplicate todo_write test)

**Test Names to Add**:
1. `it('allows tool-driven progress without looping', async () => { ... })`
2. `it('retries once when no tool work and todos unchanged', async () => { ... })`
3. `it('does not retry after todo_pause', async () => { ... })`
4. `it('duplicate todo write still triggers override retry', async () => { ... })`

---

## Running Tests

### Run All Client Tests
```bash
cd /Users/acoliver/projects/llxprt-code
npm run test -- packages/core/src/core/client.test.ts
```

### Run Specific Todo Test
```bash
npm run test -- packages/core/src/core/client.test.ts -t "allows tool-driven progress"
```

### Run All Tests
```bash
npm run test
```

### Run Service Tests
```bash
npm run test -- packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts
```

### Run Hook Tests
```bash
npm run test -- packages/cli/src/ui/hooks/useTodoContinuation.spec.ts
```

### Run Integration Tests
```bash
npm run test -- integration-tests/todo-continuation.e2e.test.js
npm run test -- integration-tests/todo-reminder.e2e.test.ts
```

---

## Key Variables/Functions Available in Tests

### From client.test.ts Setup

```typescript
// Mock functions
const mockTurnRunFn = vi.fn()
const mockChat = { /* GeminiChat mock */ }
const mockGenerator = { /* ContentGenerator mock */ }
const todoStoreReadMock = vi.fn()

// Available utilities
import { fromAsync } from 'itertools-async'
import { GeminiEventType } from '@vybestack/llxprt-code-core'

// Event types
GeminiEventType.Content
GeminiEventType.ToolCallRequest
GeminiEventType.ToolCallResponse
GeminiEventType.Finished
GeminiEventType.SystemNotice
GeminiEventType.Citation
```

### From client.test.ts Test Context

```typescript
// Inside beforeEach
client['todoToolsAvailable'] = true
client['complexityAnalyzer'] = { /* mock */ }
client['todoReminderService'] = new TodoReminderService()

// Setup helper
const mockStream = (async function* () {
  yield { type: GeminiEventType.Content, value: 'Hello' }
})()

mockTurnRunFn.mockReturnValue(mockStream)
```

---

## Code Snippets for New Tests

### Test 1 Structure: Tool-Driven Progress
```typescript
it('allows tool-driven progress without looping', async () => {
  // Setup todos
  todoStoreReadMock.mockResolvedValue([{
    id: 'todo-1',
    content: 'Task description',
    status: 'pending',
    priority: 'high'
  }])

  // Setup Turn mock with tool call
  mockTurnRunFn.mockImplementation((req) => (async function* () {
    yield { type: GeminiEventType.ToolCallRequest, value: { /* ... */ } }
    yield { type: GeminiEventType.Finished, value: { reason: 'STOP' } }
  })())

  // Setup chat mock
  vi.mocked(mockChat.getHistory).mockReturnValue([])

  // Execute
  const stream = client.sendMessageStream(
    [{ text: 'Start task' }],
    new AbortController().signal,
    'test-prompt-id'
  )
  const events = await fromAsync(stream)

  // Verify
  expect(mockTurnRunFn).toHaveBeenCalledTimes(1) // Only once!
  expect(events).toContain(expect.objectContaining({
    type: GeminiEventType.Finished
  }))
})
```

### Test 2 Structure: Retry with Escalation
```typescript
it('retries once when no tool work and todos unchanged', async () => {
  // Setup: Todo snapshots that won't change
  const todos = [{ id: '1', content: 'Task', status: 'pending', priority: 'high' }]
  todoStoreReadMock.mockResolvedValue(todos)

  // Setup: Turn streams only return Content, no tools
  mockTurnRunFn.mockImplementation(() => (async function* () {
    yield { type: GeminiEventType.Content, value: 'Thinking...' }
    yield { type: GeminiEventType.Finished, value: { reason: 'STOP' } }
  })())

  // Execute
  const stream = client.sendMessageStream(
    [{ text: 'Message' }],
    new AbortController().signal,
    'test-id'
  )
  const events = await fromAsync(stream)

  // Verify
  expect(mockTurnRunFn).toHaveBeenCalledTimes(2) // Once initial, once retry
  
  // Verify second call includes escalated reminder
  const secondCall = mockTurnRunFn.mock.calls[1]?.[0]
  expect(secondCall).toContainEqual(expect.objectContaining({
    text: expect.stringContaining('escalated')
  }))
})
```

---

## Files NOT Modified for Phase 2

These files do NOT need changes (from plan):
- `todoContinuationService.spec.ts` - Service logic unchanged
- `useTodoContinuation.spec.ts` - Hook logic unchanged
- `todo-reminder.e2e.test.ts` - Hidden reminder mechanism unchanged
- `todoContinuationService.ts` - Keep existing changes from issue #475
- `useTodoContinuation.ts` - No changes needed

---

## Next Steps (Summary)

1. Add 4 failing tests to `client.test.ts` (after line 2177)
2. Run tests to confirm they fail
3. Implement Phase 2 fix in `client.ts` (sendMessageStream method)
4. Run tests to confirm they pass
5. Run full test suite to verify no regressions
6. Run format, lint, typecheck cycle
7. Commit changes

See `plan2.md` for implementation details.
