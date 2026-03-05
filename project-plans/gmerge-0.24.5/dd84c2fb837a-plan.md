# Playbook: Implement granular stop and block behavior for agent hooks

**Upstream SHA:** `dd84c2fb837a`
**Upstream Subject:** feat(hooks): implement granular stop and block behavior for agent hooks (#15824)
**Upstream Stats:** 7 files, 388 insertions(+), 17 deletions(-)

## What Upstream Does

Adds two new event types (`AgentExecutionStopped`, `AgentExecutionBlocked`) to handle BeforeAgent and AfterAgent hook decisions. When BeforeAgent/AfterAgent returns `continue: false`, the client emits `AgentExecutionStopped` and halts execution. When it returns `decision: 'block'`, the client emits `AgentExecutionBlocked`, displays a warning, and **continues** (allowing the agent to proceed but with user feedback). For AfterAgent blocks, the client automatically re-prompts with the blocking reason. The distinction: **stop** = terminate immediately, **block** = warn and continue (or re-prompt for AfterAgent).

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/core/src/core/turn.ts` | `packages/core/src/core/turn.ts` | EXISTS | PORT — Add event types |
| `packages/core/src/core/client.ts` | `packages/core/src/core/client.ts` | EXISTS | PORT — Emit events based on decisions |
| `packages/cli/src/nonInteractiveCli.ts` | `packages/cli/src/nonInteractiveCli.ts` | EXISTS | PORT — Handle both events |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | `packages/cli/src/ui/hooks/useGeminiStream.ts` | EXISTS | PORT — Handle both events |
| Test files | Multiple | EXISTS | PORT — Add stop/block tests |

**Verified:** GeminiClient at packages/core/src/core/client.ts:193, sendMessageStream method handles agent turns

## Preflight Checks

```bash
# Verify GeminiEventType enum exists
grep -n "enum GeminiEventType" packages/core/src/core/turn.ts

# Verify GeminiClient exists
grep -n "class GeminiClient" packages/core/src/core/client.ts

# Verify sendMessageStream exists
grep -n "sendMessageStream" packages/core/src/core/client.ts

# Verify fireBeforeAgentHookSafe and fireAfterAgentHookSafe exist
grep -n "fireBeforeAgentHookSafe\|fireAfterAgentHookSafe" packages/core/src/core/client.ts

# Verify CLI files exist
test -f packages/cli/src/nonInteractiveCli.ts || echo "MISSING"
test -f packages/cli/src/ui/hooks/useGeminiStream.ts || echo "MISSING"
```

## Inter-Playbook Dependencies

- **Consumes:** 05049b5abfae (STOP_EXECUTION precedence), 15c9f88da6df (agent hook deduplication)
- **Provides:** dd84c2fb837a → 6d1e27633a32 (Stop/block behavior works before SessionStart context injection)
- **Contracts:** `AgentExecutionStopped` = terminate, `AgentExecutionBlocked` = warn + continue

## Implementation Steps

### Step 1: Add Event Types to turn.ts

**File:** `packages/core/src/core/turn.ts`

**Add to GeminiEventType enum:**
```typescript
export enum GeminiEventType {
  // ... existing values ...
  AgentExecutionStopped = 'agent_execution_stopped',
  AgentExecutionBlocked = 'agent_execution_blocked',
}
```

**Add event type interfaces:**
```typescript
export interface ServerGeminiAgentExecutionStoppedEvent {
  type: GeminiEventType.AgentExecutionStopped;
  reason: string;
}

export interface ServerGeminiAgentExecutionBlockedEvent {
  type: GeminiEventType.AgentExecutionBlocked;
  reason: string;
}
```

**Add to ServerGeminiStreamEvent union type:**
```typescript
export type ServerGeminiStreamEvent =
  | ServerGeminiMessageEvent
  | ServerGeminiToolCallEvent
  | ServerGeminiAgentExecutionStoppedEvent  // ADD
  | ServerGeminiAgentExecutionBlockedEvent  // ADD
  // ... other types ...
```

### Step 2: Modify client.ts

**File:** `packages/core/src/core/client.ts`

**In fireBeforeAgentHookSafe method** (around line 450):
```typescript
private async fireBeforeAgentHookSafe(prompt: string): Promise<boolean> {
  const hookOutput = await fireBeforeAgentHook(this.config, prompt);
  
  // Check for stop execution (higher priority)
  if (hookOutput?.shouldStopExecution()) {
    yield* [{ type: GeminiEventType.AgentExecutionStopped, reason: hookOutput.getEffectiveReason() }];
    return false;  // Stop turn execution
  }
  
  // Check for blocking decision
  if (hookOutput?.isBlockingDecision()) {
    yield* [{ type: GeminiEventType.AgentExecutionBlocked, reason: hookOutput.getEffectiveReason() }];
    return false;  // Don't add to history, don't run turn
  }
  
  return true;  // Continue normally
}
```

**In sendMessageStream method** (around line 250), handle return value:
```typescript
const shouldContinue = await this.fireBeforeAgentHookSafe(prompt);
if (!shouldContinue) {
  // For AgentExecutionStopped, add user message to history then return
  if (lastEvent?.type === GeminiEventType.AgentExecutionStopped) {
    this.addHistory({ role: 'user', parts: [{ text: prompt }] });
  }
  return;  // Exit without running turn
}
```

**In fireAfterAgentHookSafe method** (around line 550):
```typescript
private async *fireAfterAgentHookSafe(
  prompt: string,
  response: string,
): AsyncGenerator<ServerGeminiStreamEvent> {
  const hookOutput = await fireAfterAgentHook(this.config, prompt, response);
  
  // Check for stop execution
  if (hookOutput?.shouldStopExecution()) {
    yield { type: GeminiEventType.AgentExecutionStopped, reason: hookOutput.getEffectiveReason() };
    return;
  }
  
  // Check for blocking decision - re-prompt with reason
  if (hookOutput?.isBlockingDecision()) {
    yield { type: GeminiEventType.AgentExecutionBlocked, reason: hookOutput.getEffectiveReason() };
    
    // Recursively re-call sendMessageStream with blocking reason as prompt
    yield* this.sendMessageStream(hookOutput.getEffectiveReason(), /* ... */);
    return;
  }
}
```

### Step 3: Handle Events in nonInteractiveCli.ts

**File:** `packages/cli/src/nonInteractiveCli.ts`

**Add event handlers** (around line 120):
```typescript
case GeminiEventType.AgentExecutionStopped:
  writeToStderr(`\n[STOPPED] ${event.reason}\n`);
  // Emit final result event if needed
  if (config.getOutputFormat() === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    writeToStdout(formatter.formatFinalResult(historyItems, prompt_id, false) + '\n');
  }
  return;  // Exit runNonInteractive early

case GeminiEventType.AgentExecutionBlocked:
  writeToStderr(`\n[WARNING] ${event.reason}\n`);
  // Continue processing - don't return
  break;
```

### Step 4: Handle Events in useGeminiStream.ts

**File:** `packages/cli/src/ui/hooks/useGeminiStream.ts`

**Add handlers in processGeminiStreamEvents** (around line 250):
```typescript
const handleAgentExecutionStoppedEvent = useCallback((event: ServerGeminiAgentExecutionStoppedEvent) => {
  flushPendingHistory();
  addItem({
    type: 'info',
    message: `Execution stopped: ${event.reason}`,
  });
  setIsResponding(false);
}, [flushPendingHistory, addItem, setIsResponding]);

const handleAgentExecutionBlockedEvent = useCallback((event: ServerGeminiAgentExecutionBlockedEvent) => {
  flushPendingHistory();
  addItem({
    type: 'warning',
    message: `Blocked: ${event.reason}`,
  });
  // Don't setIsResponding(false) - continue processing
}, [flushPendingHistory, addItem]);

// Add to switch statement
switch (event.type) {
  // ... existing cases ...
  
  case GeminiEventType.AgentExecutionStopped:
    handleAgentExecutionStoppedEvent(event);
    break;
    
  case GeminiEventType.AgentExecutionBlocked:
    handleAgentExecutionBlockedEvent(event);
    break;
}
```

### Step 5: Add Tests

**File:** `packages/core/src/core/client.test.ts`

```typescript
describe('Agent Hook Stop/Block Behavior', () => {
  it('should stop execution in BeforeAgent when hook returns continue: false', async () => {
    const mockConfig = createMockConfigWithHook({
      command: 'echo \'{"continue": false, "stopReason": "stop"}\'',
    });
    const client = new GeminiClient(mockConfig);
    
    const events = [];
    for await (const event of client.sendMessageStream('test prompt')) {
      events.push(event);
    }
    
    expect(events).toContainEqual({
      type: GeminiEventType.AgentExecutionStopped,
      reason: 'stop',
    });
    // Verify no tool execution occurred
  });

  it('should block execution in BeforeAgent when hook returns decision: block', async () => {
    const mockConfig = createMockConfigWithHook({
      command: 'echo \'{"decision": "block", "reason": "block reason"}\'',
    });
    const client = new GeminiClient(mockConfig);
    
    const events = [];
    for await (const event of client.sendMessageStream('test prompt')) {
      events.push(event);
    }
    
    expect(events).toContainEqual({
      type: GeminiEventType.AgentExecutionBlocked,
      reason: 'block reason',
    });
  });

  it('should yield AgentExecutionBlocked and recurse in AfterAgent when hook returns decision: block', async () => {
    // Test AfterAgent block triggers re-prompt
  });
});
```

**Files:** `packages/cli/src/nonInteractiveCli.test.ts`, `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

Add similar tests for event handling.

## Deterministic Verification Commands

```bash
npm run typecheck
npm run test -- packages/core/src/core/client.test.ts
npm run test -- packages/core/src/core/turn.ts
npm run test -- packages/cli/src/nonInteractiveCli.test.ts
npm run test -- packages/cli/src/ui/hooks/useGeminiStream.test.tsx

# Verify event types added
grep "AgentExecutionStopped\|AgentExecutionBlocked" packages/core/src/core/turn.ts

# Verify client emits events
grep -A 5 "fireBeforeAgentHookSafe\|fireAfterAgentHookSafe" packages/core/src/core/client.ts | grep "AgentExecution"

# Verify CLI handles events
grep "AgentExecutionStopped\|AgentExecutionBlocked" packages/cli/src/nonInteractiveCli.ts
grep "AgentExecutionStopped\|AgentExecutionBlocked" packages/cli/src/ui/hooks/useGeminiStream.ts
```

## Execution Notes

- **Batch group:** Hooks Phase 3 - Agent Hook Behavior
- **Dependencies:** 05049b5abfae (STOP_EXECUTION), 15c9f88da6df (agent deduplication)
- **Enables:** 6d1e27633a32 (SessionStart context injection can rely on stop/block behavior)
- **Important:** This commit distinguishes **stop** (terminate) from **block** (warn and continue)

## Post-Implementation Checklist

- [ ] AgentExecutionStopped and AgentExecutionBlocked events added to turn.ts
- [ ] GeminiClient emits events based on hook decisions
- [ ] AfterAgent block triggers re-prompt
- [ ] nonInteractiveCli handles both events correctly
- [ ] useGeminiStream handles both events correctly
- [ ] All tests pass
- [ ] npm run typecheck passes
