# Phase 19: Caller Integration — Failing Tests First

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P19

## Prerequisites
- P18 completed (infrastructure in place)
- Verification: `grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P18.md`

## Purpose

This phase writes FAILING behavioral tests that verify hooks actually work. These tests MUST FAIL until P20 (implementation) is complete. Per dev-docs/RULES.md: "Every line of production code must be written in response to a failing test."

## Tests to Delete (Mock Theater)

The following test files test the BROKEN fire-and-forget behavior. They must be deleted or rewritten:

| File | Why It's Theater |
|------|------------------|
| `packages/core/src/core/coreToolHookTriggers.test.ts` | Tests that `triggerBeforeToolHook` returns `undefined` — that's the bug |
| `packages/core/src/core/geminiChatHookTriggers.test.ts` | Tests that `triggerBeforeModelHook` returns `undefined` — that's the bug |

These tests verify the broken behavior works correctly. Delete them and replace with behavioral tests.

## New Test File: hooks-caller-integration.test.ts

Location: `packages/core/src/hooks/hooks-caller-integration.test.ts`

### Test 1: BeforeTool Returns Typed Result (HOOK-134 partial)

```typescript
describe('Hook Caller Integration', () => {
  describe('triggerBeforeToolHook', () => {
    it('should return BeforeToolHookOutput when hook executes', async () => {
      // Arrange: Config with a blocking hook
      const config = createTestConfigWithHook({
        event: 'BeforeTool',
        command: 'echo \'{"decision": "allow"}\'',
      });
      
      // Act
      const result = await triggerBeforeToolHook(config, 'read_file', { path: '/test' });
      
      // Assert: Should return typed output, NOT undefined
      expect(result).toBeDefined();
      expect(result).toHaveProperty('isBlockingDecision');
      expect(result).toHaveProperty('getEffectiveReason');
    });
  });
});
```

**Expected to FAIL because:** `triggerBeforeToolHook` currently returns `Promise<void>`

### Test 2: BeforeTool Block Decision Accessible (HOOK-017)

```typescript
it('should return blocking decision when hook exits with code 2', async () => {
  const config = createTestConfigWithHook({
    event: 'BeforeTool',
    command: 'echo "Blocked for testing" >&2; exit 2',
  });
  
  const result = await triggerBeforeToolHook(config, 'write_file', { path: '/etc/passwd' });
  
  expect(result).toBeDefined();
  expect(result!.isBlockingDecision()).toBe(true);
  expect(result!.getEffectiveReason()).toContain('Blocked for testing');
});
```

**Expected to FAIL because:** Result is discarded

### Test 3: BeforeTool Modified Input Accessible (HOOK-019)

```typescript
it('should return modified tool_input when hook provides it', async () => {
  const config = createTestConfigWithHook({
    event: 'BeforeTool',
    command: 'echo \'{"decision": "allow", "hookSpecificOutput": {"tool_input": {"path": "/safe/path"}}}\'',
  });
  
  const result = await triggerBeforeToolHook(config, 'read_file', { path: '/etc/passwd' });
  
  expect(result).toBeDefined();
  const modifiedInput = result!.getModifiedToolInput();
  expect(modifiedInput).toEqual({ path: '/safe/path' });
});
```

**Expected to FAIL because:** Result is discarded, method doesn't exist

### Test 4: BeforeModel Returns Typed Result (HOOK-134 partial)

```typescript
describe('triggerBeforeModelHook', () => {
  it('should return BeforeModelHookOutput when hook executes', async () => {
    const config = createTestConfigWithHook({
      event: 'BeforeModel',
      command: 'echo \'{"decision": "allow"}\'',
    });
    
    const result = await triggerBeforeModelHook(config, mockLLMRequest);
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('isBlockingDecision');
    expect(result).toHaveProperty('getSyntheticResponse');
  });
});
```

**Expected to FAIL because:** `triggerBeforeModelHook` returns `Promise<void>`

### Test 5: BeforeModel Block With Synthetic Response (HOOK-036)

```typescript
it('should return synthetic response when hook blocks with llm_response', async () => {
  const config = createTestConfigWithHook({
    event: 'BeforeModel',
    command: `echo '{"decision": "block", "reason": "Content policy", "hookSpecificOutput": {"llm_response": {"text": "I cannot help with that."}}}'`,
  });
  
  const result = await triggerBeforeModelHook(config, mockLLMRequest);
  
  expect(result).toBeDefined();
  expect(result!.isBlockingDecision()).toBe(true);
  const synthetic = result!.getSyntheticResponse();
  expect(synthetic).toBeDefined();
  expect(synthetic!.text).toBe('I cannot help with that.');
});
```

**Expected to FAIL because:** Result is discarded

### Test 6: BeforeToolSelection Returns Tool Restrictions (HOOK-055)

```typescript
describe('triggerBeforeToolSelectionHook', () => {
  it('should return tool restrictions when hook provides allowedFunctionNames', async () => {
    const config = createTestConfigWithHook({
      event: 'BeforeToolSelection',
      command: `echo '{"decision": "allow", "hookSpecificOutput": {"toolConfig": {"allowedFunctionNames": ["read_file", "list_directory"]}}}'`,
    });
    
    const result = await triggerBeforeToolSelectionHook(config, mockTools);
    
    expect(result).toBeDefined();
    const toolConfig = result!.getModifiedToolConfig();
    expect(toolConfig).toBeDefined();
    expect(toolConfig!.allowedFunctionNames).toEqual(['read_file', 'list_directory']);
  });
});
```

**Expected to FAIL because:** Result is discarded

### Test 7: AfterTool Returns Context Injection (HOOK-027)

```typescript
describe('triggerAfterToolHook', () => {
  it('should return additionalContext when hook provides it', async () => {
    const config = createTestConfigWithHook({
      event: 'AfterTool',
      command: `echo '{"decision": "allow", "hookSpecificOutput": {"additionalContext": "Security note: file was sanitized"}}'`,
    });
    
    const result = await triggerAfterToolHook(config, 'read_file', { path: '/test' }, mockToolResult);
    
    expect(result).toBeDefined();
    expect(result!.getAdditionalContext()).toBe('Security note: file was sanitized');
  });
});
```

**Expected to FAIL because:** Result is discarded

### Test 8: No Void Prefix Enforcement (HOOK-134 meta)

```typescript
describe('HOOK-134 Enforcement', () => {
  it('trigger functions should not return void', async () => {
    // This test verifies the return TYPE, not just value
    const beforeToolResult = triggerBeforeToolHook({} as Config, 'test', {});
    const afterToolResult = triggerAfterToolHook({} as Config, 'test', {}, {} as ToolResult);
    const beforeModelResult = triggerBeforeModelHook({} as Config, {});
    const afterModelResult = triggerAfterModelHook({} as Config, {} as IContent);
    const beforeToolSelectionResult = triggerBeforeToolSelectionHook({} as Config, []);
    
    // Type assertion: if these compile without error, functions return Promise<T | undefined>
    // If functions return Promise<void>, this would be a type error at compile time
    type AssertNotVoid<T> = T extends void ? never : T;
    type BeforeToolReturn = AssertNotVoid<Awaited<typeof beforeToolResult>>;
    type AfterToolReturn = AssertNotVoid<Awaited<typeof afterToolResult>>;
    type BeforeModelReturn = AssertNotVoid<Awaited<typeof beforeModelResult>>;
    type AfterModelReturn = AssertNotVoid<Awaited<typeof afterModelResult>>;
    type BeforeToolSelectionReturn = AssertNotVoid<Awaited<typeof beforeToolSelectionResult>>;
    
    // Runtime check
    expect(true).toBe(true); // Compile-time is the real test
  });
});
```

**Expected to FAIL because:** Functions return `Promise<void>`, type assertion fails

## Test Helper: createTestConfigWithHook

```typescript
// packages/core/src/hooks/test-utils/createTestConfigWithHook.ts
import type { Config } from '../../config/config.js';
import type { HookDefinition } from '../types.js';

interface TestHookOptions {
  event: 'BeforeTool' | 'AfterTool' | 'BeforeModel' | 'AfterModel' | 'BeforeToolSelection';
  command: string;
  matcher?: string;
  timeout?: number;
}

export function createTestConfigWithHook(options: TestHookOptions): Config {
  const hookDef: HookDefinition = {
    type: 'command',
    command: options.command,
    event: options.event,
    matcher: options.matcher,
    timeout: options.timeout ?? 5000,
  };
  
  return {
    getEnableHooks: () => true,
    getHooks: () => ({ test_hook: hookDef }),
    getSessionId: () => 'test-session',
    getWorkingDir: () => '/tmp/test',
    getTargetDir: () => '/tmp/test',
    getExtensions: () => [],
    getHookSystem: () => undefined, // Will be lazy-initialized
  } as unknown as Config;
}
```

## Verification Commands

```bash
# These tests MUST FAIL initially
cd packages/core
npm run test -- hooks-caller-integration.test.ts --no-coverage

# Expected output: 8 failing tests
# If any pass, the test is wrong or the implementation already exists
```

## Success Criteria for P19

- [ ] Mock theater tests deleted (`coreToolHookTriggers.test.ts`, `geminiChatHookTriggers.test.ts`)
- [ ] New behavioral test file created: `hooks-caller-integration.test.ts`
- [ ] Test helper created: `test-utils/createTestConfigWithHook.ts`
- [ ] All 8 tests FAIL (this is correct — they test target behavior)
- [ ] Tests are behavioral (input → output), not mock-interaction tests

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P19.md`
- Set Status: COMPLETED only when all tests exist AND fail
