# Playbook: Implement STOP_EXECUTION and enhance hook decision handling

**Upstream SHA:** `05049b5abfae`
**Upstream Subject:** feat(hooks): implement STOP_EXECUTION and enhance hook decision handling (#15685)
**Upstream Stats:** 10 files, 379 insertions(+), 28 deletions(-)

## What Upstream Does

Introduces `ToolErrorType.STOP_EXECUTION` to distinguish between "stop agent execution entirely" (continue: false) versus "block this specific operation" (decision: block/deny). The key priority change: `shouldStopExecution()` is now checked **before** `getBlockingError()` in BeforeTool hooks. AfterTool now also checks for `getBlockingError()` for deny decisions. The `getEffectiveReason()` method prioritizes `stopReason` over `reason`. CLI code (nonInteractiveCli, useGeminiStream) handles STOP_EXECUTION by halting the agent loop immediately.

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/core/src/tools/tool-error.ts` | `packages/core/src/tools/tool-error.ts` | EXISTS | PORT — Add STOP_EXECUTION enum value |
| `packages/core/src/hooks/types.ts` | `packages/core/src/hooks/types.ts` | EXISTS | PORT — Change getEffectiveReason precedence |
| `packages/core/src/core/coreToolHookTriggers.ts` | `packages/core/src/core/coreToolHookTriggers.ts` | EXISTS | PORT — Reorder checks |
| `packages/cli/src/nonInteractiveCli.ts` | `packages/cli/src/nonInteractiveCli.ts` | EXISTS | PORT — Handle STOP_EXECUTION |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` | `packages/cli/src/ui/hooks/useGeminiStream.ts` | EXISTS | PORT — Handle STOP_EXECUTION |
| Test files | `packages/core/src/core/coreToolHookTriggers.test.ts`, `packages/cli/src/nonInteractiveCli.test.ts`, `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` | EXISTS | MODIFY — Add precedence tests |

## Preflight Checks

```bash
# Verify ToolErrorType enum exists
grep -n "enum ToolErrorType" packages/core/src/tools/tool-error.ts

# Verify DefaultHookOutput.getEffectiveReason exists
grep -n "getEffectiveReason" packages/core/src/hooks/types.ts

# Verify executeToolWithHooks exists
grep -n "executeToolWithHooks" packages/core/src/core/coreToolHookTriggers.ts

# Verify CLI files exist
test -f packages/cli/src/nonInteractiveCli.ts || echo "MISSING"
test -f packages/cli/src/ui/hooks/useGeminiStream.ts || echo "MISSING"
```

## Inter-Playbook Dependencies

- **Consumes:** 90eb1e0281bf (tool input modification — must work before precedence changes)
- **Provides:** 05049b5abfae → dd84c2fb837a (STOP_EXECUTION enables agent stop/block behavior)
- **Contracts:** `shouldStopExecution()` checked before `getBlockingError()`, `stopReason` prioritized over `reason`

## Implementation Steps

### Step 1: Add STOP_EXECUTION to tool-error.ts

**File:** `packages/core/src/tools/tool-error.ts`

**Add after WEB_SEARCH_FAILED:**
```typescript
export enum ToolErrorType {
  // ... existing values ...
  WEB_SEARCH_FAILED = 'web_search_failed',
  STOP_EXECUTION = 'stop_execution',  // ADD THIS
}
```

### Step 2: Update getEffectiveReason in types.ts

**File:** `packages/core/src/hooks/types.ts`

**Find DefaultHookOutput.getEffectiveReason()** (around line 90) and change:

**OLD:**
```typescript
getEffectiveReason(): string {
  return this.reason || this.stopReason || 'No reason provided';
}
```

**NEW:**
```typescript
getEffectiveReason(): string {
  return this.stopReason || this.reason || 'No reason provided';
}
```

### Step 3: Reorder checks in coreToolHookTriggers.ts

**File:** `packages/core/src/core/coreToolHookTriggers.ts`

**In BeforeTool section** (around line 140), reorder checks:

**OLD order:**
```typescript
// Check blocking first
if (beforeOutput && beforeOutput.isBlockingDecision()) {
  return createBlockedToolResult(...);
}

// Check stop
if (beforeOutput && beforeOutput.shouldStopExecution()) {
  return createStopToolResult(...);
}
```

**NEW order:**
```typescript
// Check stop FIRST (higher priority)
if (beforeOutput && beforeOutput.shouldStopExecution()) {
  return {
    llmContent: `Tool execution stopped: ${beforeOutput.getEffectiveReason()}`,
    errorType: ToolErrorType.STOP_EXECUTION,  // CHANGE from EXECUTION_FAILED
  };
}

// Then check blocking
if (beforeOutput && beforeOutput.isBlockingDecision()) {
  return {
    llmContent: `Tool execution blocked: ${beforeOutput.getEffectiveReason()}`,
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}
```

**In AfterTool section** (around line 200), add checks:

```typescript
// Fire AfterTool hook
const afterOutput = await triggerAfterToolHook(...);

// ADD: Check for stop execution
if (afterOutput && afterOutput.shouldStopExecution()) {
  return {
    llmContent: `${toolResult.llmContent}\n\n[Stopped: ${afterOutput.getEffectiveReason()}]`,
    errorType: ToolErrorType.STOP_EXECUTION,
  };
}

// ADD: Check for deny decision
if (afterOutput && afterOutput.isBlockingDecision()) {
  return {
    llmContent: `${toolResult.llmContent}\n\n[Blocked: ${afterOutput.getEffectiveReason()}]`,
    errorType: ToolErrorType.EXECUTION_FAILED,
  };
}

return toolResult;
```

### Step 4: Handle STOP_EXECUTION in nonInteractiveCli.ts

**File:** `packages/cli/src/nonInteractiveCli.ts`

**After tool execution loop** (around line 200):
```typescript
// Check for STOP_EXECUTION
const stopExecutionTool = completedToolCalls.find(
  tc => tc.response.errorType === ToolErrorType.STOP_EXECUTION
);

if (stopExecutionTool) {
  writeToStderr(`\nExecution stopped by hook: ${stopExecutionTool.response.llmContent}\n`);
  
  // Emit final result event for JSON output format
  if (config.getOutputFormat() === OutputFormat.JSON) {
    const formatter = new JsonFormatter();
    writeToStdout(formatter.formatFinalResult(historyItems, prompt_id, false) + '\n');
  }
  
  return;  // Exit early
}
```

### Step 5: Handle STOP_EXECUTION in useGeminiStream.ts

**File:** `packages/cli/src/ui/hooks/useGeminiStream.ts`

**In onComplete callback** (around line 350):
```typescript
const onComplete = useCallback((toolCalls: ToolCall[]) => {
  // ADD: Check for STOP_EXECUTION
  const stopExecutionTool = toolCalls.find(
    tc => tc.response.errorType === ToolErrorType.STOP_EXECUTION
  );
  
  if (stopExecutionTool) {
    flushPendingHistory();
    addItem({
      type: 'info',
      message: `Execution stopped: ${stopExecutionTool.response.llmContent}`,
    });
    setIsResponding(false);
    markToolsAsSubmitted();
    return;  // Don't call sendMessageStream
  }
  
  // ... existing tool execution logic ...
}, []);
```

### Step 6: Add Tests

**File:** `packages/core/src/core/coreToolHookTriggers.test.ts`

```typescript
describe('Hook Decision Precedence', () => {
  it('should prioritize continue: false over decision: block in BeforeTool', async () => {
    const mockConfig = createMockConfigWithHook({
      command: 'echo \'{"continue": false, "decision": "block", "stopReason": "stop", "reason": "block"}\'',
    });

    const result = await executeToolWithHooks(...);
    expect(result.errorType).toBe(ToolErrorType.STOP_EXECUTION);
    expect(result.llmContent).toContain('stop');  // stopReason, not reason
  });

  it('should check shouldStopExecution before isBlockingDecision', () => {
    const output = new DefaultHookOutput({
      continue: false,
      stopReason: 'stop reason',
      decision: 'block',
      reason: 'block reason',
    });

    expect(output.shouldStopExecution()).toBe(true);
    expect(output.getEffectiveReason()).toBe('stop reason');  // stopReason first
  });
});
```

**Files:** `packages/cli/src/nonInteractiveCli.test.ts`, `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

Add similar tests for STOP_EXECUTION handling.

## Deterministic Verification Commands

```bash
npm run typecheck
npm run test -- packages/core/src/tools/
npm run test -- packages/core/src/hooks/
npm run test -- packages/core/src/core/coreToolHookTriggers.test.ts
npm run test -- packages/cli/src/nonInteractiveCli.test.ts
npm run test -- packages/cli/src/ui/hooks/useGeminiStream.test.tsx

# Verify STOP_EXECUTION added
grep "STOP_EXECUTION.*=.*'stop_execution'" packages/core/src/tools/tool-error.ts

# Verify precedence change
grep -A 2 "getEffectiveReason" packages/core/src/hooks/types.ts | grep "stopReason.*reason"

# Verify reordering
grep -B 5 "shouldStopExecution" packages/core/src/core/coreToolHookTriggers.ts | grep -A 5 "isBlockingDecision"
```

## Execution Notes

- **Batch group:** Hooks Phase 2 - Core Hook Enhancements
- **Dependencies:** 90eb1e0281bf (tool input modification)
- **Enables:** dd84c2fb837a (agent stop/block), all subsequent hook commits
- **Critical:** Changes hook decision precedence — `continue: false` now takes priority over `decision: block`

## Post-Implementation Checklist

- [ ] ToolErrorType.STOP_EXECUTION added
- [ ] getEffectiveReason prioritizes stopReason
- [ ] coreToolHookTriggers checks shouldStopExecution before isBlockingDecision
- [ ] AfterTool checks both shouldStopExecution and isBlockingDecision
- [ ] nonInteractiveCli handles STOP_EXECUTION
- [ ] useGeminiStream handles STOP_EXECUTION
- [ ] All precedence tests pass
- [ ] npm run typecheck passes
