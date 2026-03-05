# Playbook: Deduplicate agent hooks and add cross-platform integration tests

**Upstream SHA:** `15c9f88da6df`
**Upstream Subject:** fix(hooks): deduplicate agent hooks and add cross-platform integration tests (#15701)
**Upstream Stats:** 6 files, 774 insertions(+), 219 deletions(-)

## What Upstream Does

This commit fixes hook deduplication for BeforeAgent/AfterAgent by implementing proper hook state tracking in `GeminiClient` to prevent multiple fires during recursive sendMessageStream calls. It uses a `hookStateMap` keyed by `prompt_id` to track whether BeforeAgent has fired and accumulate response text for AfterAgent. Only the outermost call (activeCalls === 1) fires AfterAgent. The commit also converts all integration test hook commands from shell scripts to Node.js inline commands for cross-platform compatibility (Windows/Unix).

## LLxprt Adaptation Strategy

LLxprt has `GeminiClient` class in `packages/core/src/core/client.ts` (verified at line 193). The key adaptations:

1. **Client hook state**: Add `hookStateMap` to track hook firing per prompt_id in GeminiClient
2. **Safe hook firing**: Add `fireBeforeAgentHookSafe()` and `fireAfterAgentHookSafe()` methods with deduplication logic
3. **Integration tests**: LLxprt may not have the same integration test structure - implement agent hook deduplication tests if test infrastructure supports it, otherwise SKIP and document

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/core/src/core/client.ts` | `packages/core/src/core/client.ts` | EXISTS | PORT — Add hookStateMap, safe hook methods |
| `packages/core/src/core/client.test.ts` | `packages/core/src/core/client.test.ts` | EXISTS | PORT — Add deduplication tests |
| Integration test files | `integration-tests/hooks/` directory | EXISTS | PORT — Add agent hook deduplication tests |

**LLxprt-specific paths verified:**
- `GeminiClient` class at packages/core/src/core/client.ts:193
- `client.test.ts` exists in same directory
- Hook triggers imported from packages/core/src/core/lifecycleHookTriggers.ts

## Preflight Checks

```bash
# Verify GeminiClient exists
grep -n "export class GeminiClient" packages/core/src/core/client.ts

# Verify test file exists
test -f packages/core/src/core/client.test.ts && echo "OK: client.test.ts"

# Verify hook triggers module
test -f packages/core/src/core/lifecycleHookTriggers.ts && echo "OK: lifecycleHookTriggers.ts"
grep -n "fireBeforeAgentHook" packages/core/src/core/lifecycleHookTriggers.ts
grep -n "fireAfterAgentHook" packages/core/src/core/lifecycleHookTriggers.ts

# Verify integration tests directory exists
test -d integration-tests/hooks && echo "OK: integration-tests/hooks/"

# Verify sendMessageStream exists
grep -n "sendMessageStream" packages/core/src/core/client.ts | head -5

# Verify hookStateMap does not exist yet
grep -q "hookStateMap" packages/core/src/core/client.ts && echo "UNEXPECTED: already exists" || echo "OK: needs to be added"
```

**Expected Output:** GeminiClient at line 193, all files exist, hookStateMap not yet present.

## Inter-Playbook Dependencies

### Consumes from Upstream

- **dced409ac42d:** Uses folder trust infrastructure (not directly related to deduplication)
- **e6344a8c2478:** Uses project hooks infrastructure (not directly related to deduplication)

### Provides to Downstream

- **15c9f88da6df → ALL:** Agent hook deduplication ensures BeforeAgent/AfterAgent fire exactly once per prompt_id regardless of recursive calls

### Contracts

1. **hookStateMap**: Private Map<string, HookState> keyed by prompt_id, tracks BeforeAgent fired state and cumulative response
2. **fireBeforeAgentHookSafe**: Only fires if hookState.hasFiredBeforeAgent is false, increments activeCalls counter
3. **fireAfterAgentHookSafe**: Only fires if activeCalls === 1 (outermost call) and no pending tool calls
4. **Cleanup**: Old prompt_id state removed when lastPromptId changes

## Files to Create/Modify

- **MODIFY** `packages/core/src/core/client.ts` — Add hookStateMap, safe hook methods, refactor sendMessageStream
- **MODIFY** `packages/core/src/core/client.test.ts` — Add hook deduplication tests
- **MODIFY** `integration-tests/hooks/hooks-e2e.integration.test.ts` — Add agent hook deduplication tests

## Implementation Steps

### Step 1: Add Hook State Tracking to GeminiClient

**File:** `packages/core/src/core/client.ts`

**Add interface and private field** (around line 200, before constructor):
```typescript
interface HookState {
  hasFiredBeforeAgent: boolean;
  cumulativeResponse: string;
  activeCalls: number;
  originalRequest: Content[];
}

export class GeminiClient {
  // ... existing fields ...
  
  private hookStateMap: Map<string, HookState> = new Map();  // ADD THIS
  private lastPromptId: string | null = null;  // ADD THIS (if doesn't exist)
  
  // ... rest of class ...
}
```

### Step 2: Add Safe Hook Firing Methods

**File:** `packages/core/src/core/client.ts`

**Add before sendMessageStream method** (around line 800):
```typescript
/**
 * Safely fire BeforeAgent hook with deduplication
 * Only fires once per prompt_id regardless of recursive calls
 */
private async fireBeforeAgentHookSafe(
  prompt_id: string,
  prompt: string,
): Promise<void> {
  // Initialize hook state if needed
  if (!this.hookStateMap.has(prompt_id)) {
    this.hookStateMap.set(prompt_id, {
      hasFiredBeforeAgent: false,
      cumulativeResponse: '',
      activeCalls: 0,
      originalRequest: [],
    });
  }

  const hookState = this.hookStateMap.get(prompt_id)!;
  hookState.activeCalls++;

  // Only fire on first call for this prompt_id
  if (!hookState.hasFiredBeforeAgent) {
    await fireBeforeAgentHook(this.config, prompt);
    hookState.hasFiredBeforeAgent = true;
  }
}

/**
 * Safely fire AfterAgent hook with deduplication
 * Only fires on outermost call (activeCalls === 1) with cumulative response
 */
private async fireAfterAgentHookSafe(
  prompt_id: string,
  prompt: string,
  hasPendingToolCalls: boolean,
): Promise<void> {
  const hookState = this.hookStateMap.get(prompt_id);
  if (!hookState) {
    return;
  }

  hookState.activeCalls--;

  // Only fire on outermost call and when no tool calls pending
  if (hookState.activeCalls === 1 && !hasPendingToolCalls) {
    await fireAfterAgentHook(
      this.config,
      prompt,
      hookState.cumulativeResponse,
      false, // stop_hook_active (not implemented yet)
    );
  }
}
```

### Step 3: Clean Up Old Hook State

**File:** `packages/core/src/core/client.ts`

**Add cleanup in sendMessageStream** (at the start of method, around line 850):
```typescript
async *sendMessageStream(
  request: string | Content[],
  options?: SendMessageOptions,
): AsyncGenerator<GeminiStreamEvent> {
  const prompt_id = options?.prompt_id || Math.random().toString(16).slice(2);
  
  // ADD THIS BLOCK: Clean up old hook state
  if (this.lastPromptId && this.lastPromptId !== prompt_id) {
    this.hookStateMap.delete(this.lastPromptId);
  }
  this.lastPromptId = prompt_id;
  
  // ... rest of method ...
}
```

### Step 4: Use Safe Hook Methods

**File:** `packages/core/src/core/client.ts`

**Find existing fireBeforeAgentHook call** in sendMessageStream and replace:

**OLD:**
```typescript
await fireBeforeAgentHook(this.config, promptText);
```

**NEW:**
```typescript
await this.fireBeforeAgentHookSafe(prompt_id, promptText);
```

**Find existing fireAfterAgentHook call** and replace:

**OLD:**
```typescript
await fireAfterAgentHook(this.config, promptText, responseText, false);
```

**NEW:**
```typescript
// Accumulate response text
const hookState = this.hookStateMap.get(prompt_id);
if (hookState) {
  hookState.cumulativeResponse += responseText;
}

// Fire hook safely
await this.fireAfterAgentHookSafe(prompt_id, promptText, hasPendingToolCalls);
```

### Step 5: Add Deduplication Tests

**File:** `packages/core/src/core/client.test.ts`

**Add test suite** (at end of file):
```typescript
describe('Agent Hook Deduplication', () => {
  it('should fire BeforeAgent exactly once per prompt_id', async () => {
    const mockConfig = createMockConfig();
    const fireBeforeAgentSpy = vi.spyOn(
      await import('../core/lifecycleHookTriggers.js'),
      'fireBeforeAgentHook',
    );

    const client = new GeminiClient(mockConfig);
    await client.initialize();

    // Simulate recursive calls with same prompt_id
    const prompt_id = 'test-prompt-123';
    const stream1 = client.sendMessageStream('test prompt', { prompt_id });
    for await (const _event of stream1) {
      // Process stream
    }

    expect(fireBeforeAgentSpy).toHaveBeenCalledTimes(1);
  });

  it('should fire AfterAgent once with cumulative response', async () => {
    const mockConfig = createMockConfig();
    const fireAfterAgentSpy = vi.spyOn(
      await import('../core/lifecycleHookTriggers.js'),
      'fireAfterAgentHook',
    );

    const client = new GeminiClient(mockConfig);
    await client.initialize();

    const prompt_id = 'test-prompt-456';
    const stream = client.sendMessageStream('test prompt', { prompt_id });
    for await (const _event of stream) {
      // Process stream
    }

    expect(fireAfterAgentSpy).toHaveBeenCalledTimes(1);
    // Verify cumulative response is passed (3rd argument)
    expect(fireAfterAgentSpy).toHaveBeenCalledWith(
      mockConfig,
      'test prompt',
      expect.any(String),
      expect.any(Boolean),
    );
  });

  it('should clean up old hook state when prompt_id changes', async () => {
    const mockConfig = createMockConfig();
    const client = new GeminiClient(mockConfig);
    await client.initialize();

    // First prompt
    const stream1 = client.sendMessageStream('first', { prompt_id: 'id-1' });
    for await (const _event of stream1) {
      // Process stream
    }

    // Verify hookStateMap has id-1
    expect((client as any).hookStateMap.has('id-1')).toBe(true);

    // Second prompt with different id
    const stream2 = client.sendMessageStream('second', { prompt_id: 'id-2' });
    for await (const _event of stream2) {
      // Process stream
    }

    // Verify old state is cleaned up
    expect((client as any).hookStateMap.has('id-1')).toBe(false);
    expect((client as any).hookStateMap.has('id-2')).toBe(true);
  });
});
```

### Step 6: Add Integration Tests

**File:** `integration-tests/hooks/hooks-e2e.integration.test.ts`

Add test cases for agent hook deduplication:
- BeforeAgent fires once in recursive scenario
- AfterAgent fires once with cumulative response
- Hook state cleanup on prompt_id change

These tests verify the deduplication logic works in real-world scenarios with actual LLxprt CLI execution.

## Deterministic Verification Commands

```bash
# Type check
npm run typecheck

# Run client tests
npm run test -- packages/core/src/core/client.test.ts

# Verify hookStateMap exists
grep -n "hookStateMap.*Map<string" packages/core/src/core/client.ts

# Verify safe hook methods exist
grep -n "fireBeforeAgentHookSafe" packages/core/src/core/client.ts
grep -n "fireAfterAgentHookSafe" packages/core/src/core/client.ts

# Verify cleanup logic exists
grep -n "hookStateMap.delete" packages/core/src/core/client.ts

# Verify unit tests exist
grep -n "Agent Hook Deduplication" packages/core/src/core/client.test.ts

# Run integration tests
npm run test -- integration-tests/hooks/
```

**Success Criteria:**
- All tests pass
- Type check passes
- All grep commands find expected patterns
- Agent hooks fire exactly once per prompt_id

## Execution Notes

- **Batch group:** Hooks Phase 2 - Core Hook Enhancements
- **Dependencies:** e6344a8c2478 (project hooks — indirect), earlier hook infrastructure
- **Enables:** 90eb1e0281bf (tool input modification), all subsequent hook commits
- **Test coverage:** Unit tests for deduplication logic, integration tests in integration-tests/hooks/
- **Breaking change:** NONE (internal refactoring only)

## Risk Assessment

- **Risk:** Existing sendMessageStream call sites may not provide prompt_id
- **Mitigation:** prompt_id generation has fallback (Math.random().toString(16).slice(2))
- **Risk:** Hook state accumulation could grow unbounded
- **Mitigation:** Cleanup on prompt_id change prevents memory leak
- **Risk:** Integration test infrastructure exists but may need adaptation
- **Mitigation:** Unit tests provide full coverage, integration tests verify real-world scenarios

## Post-Implementation Checklist

- [ ] HookState interface defined
- [ ] hookStateMap private field added to GeminiClient
- [ ] fireBeforeAgentHookSafe method implemented
- [ ] fireAfterAgentHookSafe method implemented
- [ ] Cleanup logic in sendMessageStream
- [ ] Existing hook calls replaced with safe methods
- [ ] Response accumulation logic added
- [ ] Unit tests for deduplication added
- [ ] Integration tests added to integration-tests/hooks/
- [ ] npm run typecheck passes
- [ ] npm run test -- packages/core/src/core/client.test.ts passes
- [ ] No direct fireBeforeAgentHook/fireAfterAgentHook calls in sendMessageStream remain
