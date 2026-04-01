# REIMPLEMENT Playbook: 2a3c879 — feat: add clearContext to AfterAgent hooks

## Upstream Change Summary

**Commit:** 2a3c879782a024f664e07a5ebf4b7f60bd513ebe
**Author:** Jack Wotherspoon
**PR:** #16574

### Problem
Hooks could not clear the conversation context/memory after agent responses. This was needed for scenarios where sensitive data should be cleared from the LLM's memory while preserving UI display.

### Solution
Added `clearContext` property to `AfterAgent` hook output:
1. New `AfterAgentHookOutput` class with `shouldClearContext()` method
2. Hook aggregator handles `clearContext` merging (any true wins)
3. `GeminiClient` calls `resetChat()` when `clearContext: true`
4. Events include `contextCleared` boolean
5. UI shows "Conversation context has been cleared." message

### Files Changed (Upstream)
- `docs/hooks/reference.md` — Documentation for clearContext
- `integration-tests/hooks-agent-flow.test.ts` — Integration test
- `packages/cli/src/ui/hooks/useGeminiStream.ts` — Handle contextCleared event
- `packages/core/src/core/client.test.ts` — Unit tests
- `packages/core/src/core/client.ts` — Main clearContext logic
- `packages/core/src/core/turn.ts` — Add contextCleared to event types
- `packages/core/src/hooks/hookAggregator.ts` — Merge clearContext
- `packages/core/src/hooks/types.ts` — New AfterAgentHookOutput class

---

## LLxprt Current State

### Verified facts (from actual source):

1. **LLxprt has a full hooks system.** `HookEventName.AfterAgent` exists in `types.ts`.

2. **`AfterAgentHookOutput` ALREADY EXISTS** in `packages/core/src/hooks/types.ts`.
   It currently only overrides `getAdditionalContext()` — no `shouldClearContext()` method.
   We MUST extend the existing class, not create a new one.

3. **`AfterAgentOutput` interface ALREADY EXISTS** in `types.ts`.
   Its `hookSpecificOutput` currently only has `additionalContext`. We need to add `clearContext?: boolean`.

4. **Turn.ts event shapes are FLAT** (not nested `value: {...}`):
   ```typescript
   export type ServerGeminiAgentExecutionStoppedEvent = {
     type: GeminiEventType.AgentExecutionStopped;
     reason: string;              // flat, NOT value.reason
     systemMessage?: string;      // flat, NOT value.systemMessage
   };
   ```
   Adding `contextCleared` must use the same flat shape.

5. **hookAggregator.ts** uses `mergeWithOrDecision` for `AfterAgent`.
   The generic spread `...output.hookSpecificOutput` means a later hook with
   `clearContext: false/undefined` could overwrite an earlier hook's `clearContext: true`.
   We need boolean-OR accumulation for `clearContext` before the generic spread.

6. **`HookAggregator.createSpecificHookOutput`** does NOT have a case for `AfterAgent`.
   The `AfterAgentHookOutput` is never instantiated by the aggregator. We need to add that case.

### Files to Check

1. `packages/core/src/hooks/types.ts` — Hook types and output classes
2. `packages/core/src/hooks/hookAggregator.ts` — Hook aggregation logic
3. `packages/core/src/core/client.ts` — Main client class
4. `packages/core/src/core/turn.ts` — Event types
5. `packages/cli/src/ui/hooks/useGeminiStream.ts` — Event handling

---

## Adaptation Plan

### Step 1: Extend `AfterAgentOutput` interface in types.ts

**File:** `packages/core/src/hooks/types.ts`

The interface already exists with `hookSpecificOutput.additionalContext`. Add `clearContext`:

```typescript
// BEFORE (existing):
export interface AfterAgentOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'AfterAgent';
    additionalContext?: string;
  };
}

// AFTER (add clearContext):
export interface AfterAgentOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'AfterAgent';
    additionalContext?: string;
    clearContext?: boolean;
  };
}
```

### Step 2: Add `shouldClearContext()` to `DefaultHookOutput` base class

**File:** `packages/core/src/hooks/types.ts`

Add base method to `DefaultHookOutput` (returns false by default):

```typescript
/**
 * Check if context clearing was requested by hook.
 */
shouldClearContext(): boolean {
  return false;
}
```

### Step 3: Extend existing `AfterAgentHookOutput` class with `shouldClearContext()`

**File:** `packages/core/src/hooks/types.ts`

The class already exists. Do NOT replace it — add the override method:

```typescript
// BEFORE (existing):
export class AfterAgentHookOutput extends DefaultHookOutput {
  override getAdditionalContext(): string | undefined {
    return super.getAdditionalContext();
  }
}

// AFTER (add shouldClearContext override):
export class AfterAgentHookOutput extends DefaultHookOutput {
  override getAdditionalContext(): string | undefined {
    return super.getAdditionalContext();
  }

  /**
   * Check if context clearing was requested by hook
   */
  override shouldClearContext(): boolean {
    if (this.hookSpecificOutput && 'clearContext' in this.hookSpecificOutput) {
      return this.hookSpecificOutput['clearContext'] === true;
    }
    return false;
  }
}
```

### Step 4: Update `createSpecificHookOutput` in hookAggregator.ts

**File:** `packages/core/src/hooks/hookAggregator.ts`

Add `AfterAgentHookOutput` import and case to `createSpecificHookOutput`. Currently the
`default` branch handles AfterAgent, which loses the `shouldClearContext()` method.

Import change (add to existing imports from `./types.js`):
```typescript
import {
  // existing imports...
  AfterAgentHookOutput,
} from './types.js';
```

Add case to `createSpecificHookOutput`:
```typescript
case HookEventName.AfterAgent:
  return new AfterAgentHookOutput(output);
```

### Step 5: Fix clearContext accumulation in `mergeWithOrDecision`

**File:** `packages/core/src/hooks/hookAggregator.ts`

The current generic spread `...output.hookSpecificOutput` would let a later hook's
`clearContext: false` overwrite an earlier hook's `clearContext: true`.

Replace the existing hookSpecificOutput merge block inside `mergeWithOrDecision`:

```typescript
// BEFORE (existing spread that loses clearContext):
if (output.hookSpecificOutput) {
  merged.hookSpecificOutput = {
    ...(merged.hookSpecificOutput || {}),
    ...output.hookSpecificOutput,
  };
}

// AFTER (boolean-OR for clearContext, then spread the rest):
if (output.hookSpecificOutput) {
  // Boolean-OR: once any hook sets clearContext:true, it stays true
  const incomingClearContext =
    output.hookSpecificOutput['clearContext'] === true;
  const existingClearContext =
    merged.hookSpecificOutput?.['clearContext'] === true;
  const { clearContext: _cc, ...restSpecific } = output.hookSpecificOutput;
  merged.hookSpecificOutput = {
    ...(merged.hookSpecificOutput || {}),
    ...restSpecific,
    ...(incomingClearContext || existingClearContext
      ? { clearContext: true }
      : {}),
  };
}
```

### Step 6: Update turn.ts event types — keep FLAT shape

**File:** `packages/core/src/core/turn.ts`

LLxprt events are FLAT (not nested under `value`). Add `contextCleared` at the top level:

```typescript
// BEFORE (existing flat shape):
export type ServerGeminiAgentExecutionStoppedEvent = {
  type: GeminiEventType.AgentExecutionStopped;
  reason: string;
  systemMessage?: string;
};

export type ServerGeminiAgentExecutionBlockedEvent = {
  type: GeminiEventType.AgentExecutionBlocked;
  reason: string;
  systemMessage?: string;
};

// AFTER (add contextCleared at top level — keep flat):
export type ServerGeminiAgentExecutionStoppedEvent = {
  type: GeminiEventType.AgentExecutionStopped;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};

export type ServerGeminiAgentExecutionBlockedEvent = {
  type: GeminiEventType.AgentExecutionBlocked;
  reason: string;
  systemMessage?: string;
  contextCleared?: boolean;
};
```

> WARNING: Do NOT wrap these in `value: { ... }` — that would break all existing consumers
> in `geminiChat.ts`, `client.ts`, and `useGeminiStream.ts` that read `event.reason` directly.

### Step 7: Update client.ts

**File:** `packages/core/src/core/client.ts`

In the AfterAgent hook handling, read `shouldClearContext()` and pass it through.
Also call `resetChat()` when `clearContext: true`. The flat event shape must be used:

```typescript
// Cast to AfterAgentHookOutput for shouldClearContext()
const afterAgentOutput = hookOutput as AfterAgentHookOutput | undefined;

if (afterAgentOutput?.shouldStopExecution()) {
  const contextCleared = afterAgentOutput.shouldClearContext();
  if (contextCleared) {
    await this.resetChat();
  }
  yield {
    type: GeminiEventType.AgentExecutionStopped,
    reason: afterAgentOutput.getEffectiveReason(),
    systemMessage: afterAgentOutput.systemMessage,
    contextCleared,
  };
  return turn;
}

if (afterAgentOutput?.isBlockingDecision()) {
  const contextCleared = afterAgentOutput.shouldClearContext();
  if (contextCleared) {
    await this.resetChat();
  }
  yield {
    type: GeminiEventType.AgentExecutionBlocked,
    reason: afterAgentOutput.getEffectiveReason(),
    systemMessage: afterAgentOutput.systemMessage,
    contextCleared,
  };
  // ... continue with retry
}
```

> Note: `resetChat()` is called BEFORE yielding the event so the cleared state
> is established before the UI reacts.

### Step 8: Update useGeminiStream.ts

**File:** `packages/cli/src/ui/hooks/useGeminiStream.ts`

Event fields are accessed as `event.reason` and `event.contextCleared` (flat):

```typescript
// In the AgentExecutionStopped handler:
case GeminiEventType.AgentExecutionStopped: {
  const { reason, systemMessage, contextCleared } = event;
  // ... existing stop logic ...
  if (contextCleared) {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      },
      userMessageTimestamp,
    );
  }
  break;
}

// In the AgentExecutionBlocked handler:
case GeminiEventType.AgentExecutionBlocked: {
  const { reason, systemMessage, contextCleared } = event;
  // ... existing blocked logic ...
  if (contextCleared) {
    addItem(
      {
        type: MessageType.INFO,
        text: 'Conversation context has been cleared.',
      },
      userMessageTimestamp,
    );
  }
  break;
}
```

---

## Files to Read

| File | Purpose |
|------|---------|
| `packages/core/src/hooks/types.ts` | Check current hook types |
| `packages/core/src/hooks/hookAggregator.ts` | Check aggregation logic |
| `packages/core/src/core/client.ts` | Check AfterAgent handling |
| `packages/core/src/core/turn.ts` | Check event types |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | Check event handling |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/hooks/types.ts` | Add AfterAgentOutput, AfterAgentHookOutput |
| `packages/core/src/hooks/hookAggregator.ts` | Add clearContext merging |
| `packages/core/src/core/turn.ts` | Add contextCleared to events |
| `packages/core/src/core/client.ts` | Add clearContext logic |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | Handle contextCleared |
| `packages/core/src/core/client.test.ts` | Add tests |
| `integration-tests/hooks-agent-flow.test.ts` | Add integration test |

---

## Behavior Tests to Add

### In `packages/core/src/core/client.test.ts`

```typescript
describe('AfterAgent clearContext', () => {
  it('should call resetChat and set contextCleared when continue:false + clearContext:true', async () => {
    // Setup: AfterAgent hook output with continue:false, clearContext:true
    // Assert: AgentExecutionStopped event has contextCleared:true
    // Assert: resetChat was called
  });

  it('should call resetChat and set contextCleared when decision:block + clearContext:true', async () => {
    // Setup: AfterAgent hook output with decision:'block', clearContext:true
    // Assert: AgentExecutionBlocked event has contextCleared:true
    // Assert: resetChat was called
  });

  it('should NOT call resetChat when clearContext is not set', async () => {
    // Setup: AfterAgent hook output with continue:false but no clearContext
    // Assert: AgentExecutionStopped event has no contextCleared
    // Assert: resetChat was NOT called
  });
});
```

### In `packages/core/src/hooks/hookAggregator.test.ts`

```typescript
describe('clearContext accumulation', () => {
  it('should preserve clearContext:true when merged with later hook having clearContext:false', () => {
    // Hook 1 output: clearContext:true
    // Hook 2 output: clearContext:false
    // Merged result: clearContext:true (boolean-OR wins)
  });

  it('should set clearContext:true when any hook has clearContext:true', () => {
    // Multiple hook outputs, only one with clearContext:true
    // Merged result: clearContext:true
  });
});
```

---

## Type Compatibility Checklist

Before implementing, verify these are consistent:

| Location | Expected shape |
|----------|---------------|
| `turn.ts` `ServerGeminiAgentExecutionStoppedEvent` | `{ type, reason, systemMessage?, contextCleared? }` (flat) |
| `turn.ts` `ServerGeminiAgentExecutionBlockedEvent` | `{ type, reason, systemMessage?, contextCleared? }` (flat) |
| `client.ts` yield statements for those events | Must match flat shape |
| `useGeminiStream.ts` event consumers | Must read `event.reason` not `event.value.reason` |
| `geminiChat.ts` / `StreamEventType.AGENT_EXECUTION_STOPPED` | Check passthrough shape |

---

## Specific Verification

```bash
# 1. Run hook tests
npm run test -- packages/core/src/hooks/

# 2. Run client tests
npm run test -- packages/core/src/core/client.test.ts

# 3. Run integration tests (if exists)
npm run test -- integration-tests/hooks-agent-flow.test.ts

# 4. Run full test suite
npm run test
```

---

## Documentation Update

Update `docs/hooks/reference.md` with clearContext documentation (if LLxprt has this file).
