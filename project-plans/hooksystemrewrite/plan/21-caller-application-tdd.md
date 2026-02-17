# Phase 21: Caller Application of Hook Results — Failing Tests First

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P21

## Prerequisites
- P20 completed (trigger functions return typed results)
- Verification: `npm run test -- hooks-caller-integration.test.ts` passes

## Purpose

P20 made trigger functions return results. But callers still use `void` prefix and ignore results. This phase writes FAILING tests that verify callers actually APPLY hook results.

Per dev-docs/RULES.md: Test behavior, not implementation. These tests verify end-to-end outcomes.

## New Test File: hooks-caller-application.test.ts

Location: `packages/core/src/hooks/hooks-caller-application.test.ts`

### Test 1: coreToolScheduler Blocks Tool When Hook Blocks (HOOK-017, HOOK-129)

```typescript
describe('coreToolScheduler hook application', () => {
  it('should not execute tool when BeforeTool hook blocks', async () => {
    // Arrange: Scheduler with a tool that writes to a file
    // Hook that blocks write_file tool
    const scheduler = createSchedulerWithBlockingHook('write_file');
    const toolExecSpy = vi.fn();
    
    // Act: Request tool execution
    await scheduler.executeTool('write_file', { path: '/etc/passwd', content: 'hacked' }, toolExecSpy);
    
    // Assert: Tool should NOT have executed
    expect(toolExecSpy).not.toHaveBeenCalled();
    
    // Assert: Scheduler should have blocked result in buffer
    const result = scheduler.getLastResult();
    expect(result).toBeDefined();
    expect(result!.llmContent).toContain('blocked');
  });
});
```

**Expected to FAIL because:** `coreToolScheduler.ts:1727` uses `void triggerBeforeToolHook(...)` — result is discarded, tool always executes.

### Test 2: coreToolScheduler Applies Modified Tool Input (HOOK-019)

```typescript
it('should execute tool with modified input when hook modifies it', async () => {
  // Arrange: Hook that changes path from /etc/passwd to /safe/path
  const scheduler = createSchedulerWithInputModifyingHook();
  const toolExecSpy = vi.fn();
  
  // Act: Request read of /etc/passwd
  await scheduler.executeTool('read_file', { path: '/etc/passwd' }, toolExecSpy);
  
  // Assert: Tool should have been called with /safe/path
  expect(toolExecSpy).toHaveBeenCalledWith(
    expect.objectContaining({ path: '/safe/path' })
  );
});
```

**Expected to FAIL because:** Caller ignores result, uses original input.

### Test 3: coreToolScheduler Appends systemMessage to Result (HOOK-131)

```typescript
it('should append systemMessage to tool result llmContent', async () => {
  // Arrange: AfterTool hook that adds security annotation
  const scheduler = createSchedulerWithSystemMessageHook();
  
  // Act
  await scheduler.executeTool('read_file', { path: '/test' }, vi.fn());
  
  // Assert: Result should contain system message
  const result = scheduler.getLastResult();
  expect(result!.llmContent).toContain('[System]');
  expect(result!.llmContent).toContain('Security note');
});
```

**Expected to FAIL because:** `coreToolScheduler.ts:1777` uses `void triggerAfterToolHook(...)`.

### Test 4: coreToolScheduler Sets suppressDisplay (HOOK-132)

```typescript
it('should set suppressDisplay on result when hook requests it', async () => {
  // Arrange: AfterTool hook with suppressOutput: true
  const scheduler = createSchedulerWithSuppressHook();
  
  // Act
  await scheduler.executeTool('read_file', { path: '/secret' }, vi.fn());
  
  // Assert: Result should have suppressDisplay
  const result = scheduler.getLastResult();
  expect(result!.suppressDisplay).toBe(true);
});
```

**Expected to FAIL because:** Result is discarded, suppressDisplay not set.

### Test 5: geminiChat Skips Model Call When Hook Blocks (HOOK-036)

```typescript
describe('geminiChat hook application', () => {
  it('should not call model API when BeforeModel hook blocks', async () => {
    // Arrange: Hook that blocks based on content policy
    const chat = createChatWithBlockingModelHook();
    const apiCallSpy = vi.spyOn(chat, '_callModelAPI');
    
    // Act: Send message that triggers block
    const response = await chat.sendMessage('Generate harmful content');
    
    // Assert: API should NOT have been called
    expect(apiCallSpy).not.toHaveBeenCalled();
    
    // Assert: Should have synthetic response from hook
    expect(response.text).toContain('Content policy');
  });
});
```

**Expected to FAIL because:** `geminiChat.ts:1381` uses `void triggerBeforeModelHook(...)`.

### Test 6: geminiChat Uses Synthetic Response (HOOK-036)

```typescript
it('should use synthetic response when hook provides one', async () => {
  // Arrange: Hook that provides cached/synthetic response
  const chat = createChatWithSyntheticResponseHook();
  
  // Act
  const response = await chat.sendMessage('What is 2+2?');
  
  // Assert: Response should be from hook, not API
  expect(response.text).toBe('4 (cached by hook)');
});
```

**Expected to FAIL because:** Synthetic response from hook is discarded.

### Test 7: geminiChat Applies Tool Restrictions (HOOK-055)

```typescript
it('should restrict available tools when hook specifies allowedFunctionNames', async () => {
  // Arrange: Hook that restricts to only read_file
  const chat = createChatWithToolRestrictionHook(['read_file']);
  
  // Act: Model tries to use write_file
  const response = await chat.sendMessageWithToolUse('Write to /etc/passwd');
  
  // Assert: write_file should not be available
  // Model should have been called with restricted toolConfig
  expect(chat.getLastToolConfig().allowedFunctionNames).toEqual(['read_file']);
});
```

**Expected to FAIL because:** `geminiChat.ts:1337` uses `void triggerBeforeToolSelectionHook(...)`.

### Test 8: geminiChat Stops Agent Loop on continue:false (HOOK-040, HOOK-048)

```typescript
it('should terminate agent loop when hook returns continue:false', async () => {
  // Arrange: Hook that sets continue: false after detecting loop
  const chat = createChatWithLoopDetectionHook();
  
  // Act: Start conversation that would normally loop
  const response = await chat.runAgentLoop('Do task X then Y then Z');
  
  // Assert: Should have stopped early
  expect(response.metadata.stopReason).toBe('hook_terminated');
  expect(chat.getLoopIterations()).toBeLessThan(10);
});
```

**Expected to FAIL because:** `continue` field is never checked.

## Test Helper: createSchedulerWithBlockingHook

```typescript
// packages/core/src/hooks/test-utils/schedulerTestUtils.ts

export function createSchedulerWithBlockingHook(toolToBlock: string): TestScheduler {
  const config = createTestConfigWithHook({
    event: 'BeforeTool',
    matcher: toolToBlock,
    command: `echo '{"decision": "block", "reason": "Blocked by policy"}' && exit 2`,
  });
  
  return new TestScheduler(config);
}
```

## Verification Commands

```bash
# These tests MUST FAIL initially
cd packages/core
npm run test -- hooks-caller-application.test.ts --no-coverage

# Expected output: 8 failing tests
```

## Success Criteria for P21

- [ ] New test file created: `hooks-caller-application.test.ts`
- [ ] Test helpers created for scheduler/chat mocking
- [ ] All 8 tests FAIL (testing target behavior not yet implemented)
- [ ] Tests are end-to-end behavioral (verify actual tool blocking, not mock calls)

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P21.md`
- Set Status: COMPLETED when all tests exist AND fail
