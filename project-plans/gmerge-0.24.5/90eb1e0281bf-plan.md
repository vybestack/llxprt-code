# Playbook: Implement support for tool input modification

**Upstream SHA:** `90eb1e0281bf`
**Upstream Subject:** Implement support for tool input modification (#15492)
**Upstream Stats:** 12 files, 413 insertions(+), 24 deletions(-)

## What Upstream Does

Enables BeforeTool hooks to modify tool input parameters before execution via the `tool_input` field in `hookSpecificOutput`. The hook returns modified parameters, which are applied via `Object.assign()` to the invocation params, then the tool is rebuilt with the new params to ensure validation. A system message is appended to the tool result indicating which parameters were modified. The implementation spans: (1) `BeforeToolHookOutput.getModifiedToolInput()` method in types.ts, (2) input modification logic in `executeToolWithHooks()`, (3) sequential hook chaining in `HookRunner`, and (4) integration tests.

## LLxprt Adaptation Strategy

LLxprt's hook system already has `BeforeToolHookOutput` in `types.ts` (verified at line 210) and `executeToolWithHooks` in `coreToolHookTriggers.ts` (verified via search). The changes needed:

1. Add `getModifiedToolInput()` method to `BeforeToolHookOutput` class (already exists at types.ts:237-246)
2. Modify `executeToolWithHooks()` in `coreToolHookTriggers.ts` to apply modified input, rebuild invocation
3. Update `hookAggregator.ts` to merge `hookSpecificOutput` objects when aggregating
4. Support sequential input modification in `hookRunner.ts` for BeforeTool events
5. Add `tool_input?: Record<string, unknown>` to `BeforeToolOutput` interface (check if exists)
6. Pass `tool` parameter to `executeToolWithHooks()` from `coreToolScheduler.ts`
7. Add tests for input modification scenarios

## LLxprt File Existence Map

| Upstream Path | LLxprt Equivalent | Status | Action |
|--------------|-------------------|--------|--------|
| `packages/core/src/hooks/types.ts` | `packages/core/src/hooks/types.ts` | EXISTS | VERIFY — getModifiedToolInput may already exist |
| `packages/core/src/core/coreToolHookTriggers.ts` | `packages/core/src/core/coreToolHookTriggers.ts` | EXISTS | PORT — Add input modification logic |
| `packages/core/src/hooks/hookAggregator.ts` | `packages/core/src/hooks/hookAggregator.ts` | EXISTS | PORT — Merge hookSpecificOutput |
| `packages/core/src/hooks/hookRunner.ts` | `packages/core/src/hooks/hookRunner.ts` | EXISTS | PORT — Handle BeforeTool input chaining |
| `packages/core/src/core/coreToolScheduler.ts` | `packages/core/src/core/coreToolScheduler.ts` | EXISTS | PORT — Pass tool parameter |
| `packages/core/src/core/coreToolHookTriggers.test.ts` | `packages/core/src/core/coreToolHookTriggers.test.ts` | CHECK | CREATE/MODIFY — Tests |
| `packages/core/src/hooks/types.test.ts` | `packages/core/src/hooks/types.test.ts` | EXISTS | MODIFY — Add BeforeToolHookOutput test |
| Integration tests | `integration-tests/hooks/` directory | CHECK | CONDITIONAL — Only if exists |

**LLxprt-specific paths verified:**
- BeforeToolHookOutput class at packages/core/src/hooks/types.ts:210
- executeToolWithHooks at packages/core/src/core/coreToolHookTriggers.ts (verified via search)
- Tool scheduler at packages/core/src/core/coreToolScheduler.ts

## Preflight Checks

```bash
# Verify BeforeToolHookOutput exists
grep -n "class BeforeToolHookOutput" packages/core/src/hooks/types.ts

# Check if getModifiedToolInput already exists
grep -n "getModifiedToolInput" packages/core/src/hooks/types.ts

# Verify executeToolWithHooks exists
grep -n "export.*executeToolWithHooks" packages/core/src/core/coreToolHookTriggers.ts

# Verify hook aggregator exists
test -f packages/core/src/hooks/hookAggregator.ts || echo "MISSING: hookAggregator.ts"

# Verify tool scheduler exists
test -f packages/core/src/core/coreToolScheduler.ts || echo "MISSING: coreToolScheduler.ts"

# Check test file status
test -f packages/core/src/core/coreToolHookTriggers.test.ts && echo "EXISTS" || echo "CREATE NEEDED"
```

**Expected Output:** BeforeToolHookOutput found, getModifiedToolInput may already exist (check line 237-246), executeToolWithHooks exists, all core files exist.

## Inter-Playbook Dependencies

### Consumes from Upstream

- **15c9f88da6df:** Requires agent hook deduplication infrastructure (hookStateMap, safe hook methods)
- **dced409ac42d:** Requires folder trust infrastructure (source field on hooks)

### Provides to Downstream

- **90eb1e0281bf → 05049b5abfae:** Tool input modification must work before STOP_EXECUTION precedence changes
- **90eb1e0281bf → dd84c2fb837a:** Sequential hook execution supports agent-level stop/block behavior

### Contracts

1. **BeforeToolHookOutput.getModifiedToolInput()**: Returns `Record<string, unknown> | undefined` from hookSpecificOutput.tool_input
2. **Sequential modification**: HookRunner applies tool_input modifications in order when multiple BeforeTool hooks run sequentially
3. **Tool rebuilding**: After applying modifications, invocation is rebuilt via `tool.build(params)` to ensure validation
4. **Modification tracking**: Modified parameter keys are tracked and reported in tool result systemMessage

## Files to Create/Modify

- **VERIFY** `packages/core/src/hooks/types.ts` — Check if getModifiedToolInput exists, add if missing
- **MODIFY** `packages/core/src/hooks/types.ts` — Update BeforeToolOutput interface with tool_input field
- **MODIFY** `packages/core/src/core/coreToolHookTriggers.ts` — Apply input modifications in executeToolWithHooks
- **MODIFY** `packages/core/src/hooks/hookAggregator.ts` — Merge hookSpecificOutput objects
- **MODIFY** `packages/core/src/hooks/hookRunner.ts` — Handle BeforeTool input modification in applyHookOutputToInput
- **MODIFY** `packages/core/src/core/coreToolScheduler.ts` — Pass tool parameter to executeToolWithHooks
- **CREATE/MODIFY** `packages/core/src/core/coreToolHookTriggers.test.ts` — Tests for input modification
- **MODIFY** `packages/core/src/hooks/types.test.ts` — Test createHookOutput returns BeforeToolHookOutput
- **CONDITIONAL** Integration tests — Only if LLxprt has compatible test infrastructure

## Implementation Steps

### Step 1: Verify/Add getModifiedToolInput to types.ts

**File:** `packages/core/src/hooks/types.ts`

**Verification:**
```bash
grep -A 15 "class BeforeToolHookOutput" packages/core/src/hooks/types.ts | grep -A 10 "getModifiedToolInput"
```

**If missing, add** (around line 240):
```typescript
/**
 * Get modified tool input if provided by hook
 * @requirement:HOOK-019 - Tool input modification
 */
getModifiedToolInput(): Record<string, unknown> | undefined {
  if (this.hookSpecificOutput && 'tool_input' in this.hookSpecificOutput) {
    const modifiedInput = this.hookSpecificOutput['tool_input'];
    if (
      modifiedInput &&
      typeof modifiedInput === 'object' &&
      !Array.isArray(modifiedInput)
    ) {
      return modifiedInput as Record<string, unknown>;
    }
  }
  return undefined;
}
```

**Update BeforeToolOutput interface** (around line 470):
```typescript
export interface BeforeToolOutput extends HookOutput {
  hookSpecificOutput?: {
    hookEventName: 'BeforeTool';
    permissionDecision?: HookDecision;
    permissionDecisionReason?: string;
    tool_input?: Record<string, unknown>;  // ADD THIS LINE
  };
}
```

### Step 2: Update hookAggregator.ts

**File:** `packages/core/src/hooks/hookAggregator.ts`

**In `aggregate()` method**, ensure hookSpecificOutput objects are merged:
```typescript
aggregate(results: HookExecutionResult[]): DefaultHookOutput {
  // ... existing code ...
  
  const merged: HookOutput = {
    continue: finalContinue,
    stopReason: stopReasons.join('; ') || undefined,
    suppressOutput: results.some(r => r.output?.suppressOutput),
    systemMessage: systemMessages.join('\n') || undefined,
    decision: finalDecision,
    reason: decisionReasons.join('; ') || undefined,
    hookSpecificOutput: {},  // START with empty object
  };

  // Merge all hookSpecificOutput objects
  for (const result of results) {
    if (result.output?.hookSpecificOutput) {
      Object.assign(merged.hookSpecificOutput, result.output.hookSpecificOutput);
    }
  }

  return createHookOutput(results[0].eventName, merged);
}
```

### Step 3: Update hookRunner.ts

**File:** `packages/core/src/hooks/hookRunner.ts`

**Add BeforeTool case to `applyHookOutputToInput()` method** (around line 200):
```typescript
private applyHookOutputToInput(
  modifiedInput: HookInput,
  hookOutput: DefaultHookOutput,
): HookInput {
  // ... existing cases for BeforeAgent, BeforeModel ...

  // ADD THIS CASE
  if (hookOutput.hookSpecificOutput?.hookEventName === 'BeforeTool') {
    const modifiedToolInput = (hookOutput as BeforeToolHookOutput).getModifiedToolInput();
    if (modifiedToolInput && 'tool_input' in modifiedInput) {
      (modifiedInput as BeforeToolInput).tool_input = {
        ...(modifiedInput as BeforeToolInput).tool_input,
        ...modifiedToolInput,
      };
    }
  }

  return modifiedInput;
}
```

### Step 4: Update coreToolHookTriggers.ts

**File:** `packages/core/src/core/coreToolHookTriggers.ts`

**Change 1:** Add `tool` parameter to `executeToolWithHooks` signature (around line 80):
```typescript
export async function executeToolWithHooks(
  invocation: ToolCallInvocation,
  tool: AnyDeclarativeTool,  // ADD THIS PARAMETER
  config: Config,
  signal: AbortSignal,
  messageBus?: MessageBus,
  hooksEnabled?: boolean,
): Promise<ToolResult> {
```

**Change 2:** Apply input modifications after BeforeTool (around line 120):
```typescript
// Fire BeforeTool hook
const beforeOutput = await triggerBeforeToolHook(
  config,
  invocation.toolName,
  invocation.params,
  signal,
  messageBus,
  hooksEnabled,
);

// Apply input modifications if provided
let inputWasModified = false;
const modifiedKeys: string[] = [];

if (beforeOutput instanceof BeforeToolHookOutput) {
  const modifiedInput = beforeOutput.getModifiedToolInput();
  if (modifiedInput) {
    // Track which keys were modified
    for (const key of Object.keys(modifiedInput)) {
      if (invocation.params[key] !== modifiedInput[key]) {
        modifiedKeys.push(key);
      }
    }

    // Apply modifications
    Object.assign(invocation.params, modifiedInput);
    inputWasModified = true;

    // Rebuild invocation with new params to ensure validation
    try {
      invocation = tool.build(invocation.params);
    } catch (error) {
      debugLogger.warn(
        `Failed to rebuild tool invocation after input modification: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Continue with original invocation
      inputWasModified = false;
    }
  }
}

// Check for blocking decision
if (beforeOutput && beforeOutput.isBlockingDecision()) {
  // ... existing blocking logic ...
}

// Execute tool
const toolResult = await invocation.execute(signal);

// Append modification message if input was modified
if (inputWasModified && modifiedKeys.length > 0) {
  const modificationMessage = `\n\n[System: Hook modified parameters: ${modifiedKeys.join(', ')}]`;
  toolResult.llmContent = (toolResult.llmContent || '') + modificationMessage;
}

// Fire AfterTool hook
// ... existing AfterTool logic ...

return toolResult;
```

### Step 5: Update coreToolScheduler.ts

**File:** `packages/core/src/core/coreToolScheduler.ts`

**Find all `executeToolWithHooks` call sites** and add `tool` parameter:

**OLD:**
```typescript
const result = await executeToolWithHooks(
  invocation,
  this.config,
  signal,
  this.messageBus,
  hooksEnabled,
);
```

**NEW:**
```typescript
const result = await executeToolWithHooks(
  invocation,
  toolCall.tool,  // ADD THIS
  this.config,
  signal,
  this.messageBus,
  hooksEnabled,
);
```

### Step 6: Create/Modify coreToolHookTriggers.test.ts

**File:** `packages/core/src/core/coreToolHookTriggers.test.ts`

**Add test suite:**
```typescript
describe('Tool Input Modification', () => {
  it('should apply modified input from BeforeTool hook', async () => {
    const mockTool = {
      build: vi.fn((params) => ({ toolName: 'test-tool', params, execute: vi.fn() })),
    };

    const mockConfig = createMockConfig({
      hooks: {
        BeforeTool: [{
          hooks: [{
            type: HookType.Command,
            command: 'node -e "console.log(JSON.stringify({ hookSpecificOutput: { tool_input: { modified: true } } }))"',
          }],
        }],
      },
    });

    const invocation = {
      toolName: 'test-tool',
      params: { original: 'value' },
      execute: vi.fn().mockResolvedValue({ llmContent: 'result', errorType: null }),
    };

    const result = await executeToolWithHooks(
      invocation,
      mockTool,
      mockConfig,
      new AbortController().signal,
      undefined,
      true,
    );

    expect(mockTool.build).toHaveBeenCalledWith({
      original: 'value',
      modified: true,
    });
    expect(result.llmContent).toContain('[System: Hook modified parameters:');
  });

  it('should not modify input if hook does not provide tool_input', async () => {
    const mockTool = {
      build: vi.fn(),
    };

    const mockConfig = createMockConfig({
      hooks: {
        BeforeTool: [{
          hooks: [{
            type: HookType.Command,
            command: 'echo "{}"',
          }],
        }],
      },
    });

    const invocation = {
      toolName: 'test-tool',
      params: { original: 'value' },
      execute: vi.fn().mockResolvedValue({ llmContent: 'result', errorType: null }),
    };

    await executeToolWithHooks(
      invocation,
      mockTool,
      mockConfig,
      new AbortController().signal,
      undefined,
      true,
    );

    expect(mockTool.build).not.toHaveBeenCalled();
  });
});
```

### Step 7: Update types.test.ts

**File:** `packages/core/src/hooks/types.test.ts`

**Add test:**
```typescript
it('should return BeforeToolHookOutput for BeforeTool event', () => {
  const output = createHookOutput(HookEventName.BeforeTool, {});
  expect(output).toBeInstanceOf(BeforeToolHookOutput);
});
```

### Step 8: Integration Tests (CONDITIONAL)

**Decision logic:**
```bash
if [ -d "integration-tests/hooks" ]; then
  echo "IMPLEMENT: Add tool input modification integration tests"
else
  echo "SKIP: No integration test infrastructure"
fi
```

**If implementing:** Add test to verify BeforeTool hook can modify parameters and tool receives modified values.

**If skipping:** Document in commit message: "Integration tests skipped - LLxprt uses different test infrastructure. Tool input modification verified via unit tests in coreToolHookTriggers.test.ts."

## Deterministic Verification Commands

```bash
# Type check
npm run typecheck

# Run hook tests
npm run test -- packages/core/src/hooks/

# Run core tests
npm run test -- packages/core/src/core/coreToolHookTriggers.test.ts
npm run test -- packages/core/src/core/coreToolScheduler.test.ts

# Verify getModifiedToolInput exists
grep -n "getModifiedToolInput" packages/core/src/hooks/types.ts

# Verify tool_input field in interface
grep -A 5 "interface BeforeToolOutput" packages/core/src/hooks/types.ts | grep "tool_input"

# Verify executeToolWithHooks has tool parameter
grep -n "executeToolWithHooks.*tool.*AnyDeclarativeTool" packages/core/src/core/coreToolHookTriggers.ts

# Verify hookAggregator merges hookSpecificOutput
grep -A 10 "aggregate" packages/core/src/hooks/hookAggregator.ts | grep "hookSpecificOutput"

# Verify hookRunner handles BeforeTool input
grep -A 20 "applyHookOutputToInput" packages/core/src/hooks/hookRunner.ts | grep -i "beforetool"

# Check integration tests (conditional)
test -d integration-tests/hooks && \
  npm run test -- integration-tests/hooks/ || \
  echo "SKIPPED: No integration tests"
```

**Success Criteria:**
- All tests pass
- Type check passes
- All grep commands find expected patterns
- Tool input modification works end-to-end

## Execution Notes

- **Batch group:** Hooks Phase 2 - Core Hook Enhancements
- **Dependencies:** 15c9f88da6df (agent hook deduplication), dced409ac42d (folder trust)
- **Enables:** 05049b5abfae (STOP_EXECUTION), all subsequent hook commits
- **Test coverage:** Unit tests for modification logic, integration tests conditional
- **Breaking change:** executeToolWithHooks signature changes (tool parameter added)

## Risk Assessment

- **Risk:** getModifiedToolInput may already exist in types.ts
- **Mitigation:** Verification step checks before adding, avoid duplication
- **Risk:** Tool.build() may fail with modified params
- **Mitigation:** Try-catch wrapper, fall back to original invocation on error
- **Risk:** Sequential modification order matters for multiple BeforeTool hooks
- **Mitigation:** HookRunner applyHookOutputToInput ensures order preservation

## Post-Implementation Checklist

- [ ] BeforeToolHookOutput.getModifiedToolInput() exists
- [ ] BeforeToolOutput interface has tool_input field
- [ ] hookAggregator merges hookSpecificOutput objects
- [ ] hookRunner handles BeforeTool input modification
- [ ] executeToolWithHooks accepts tool parameter
- [ ] coreToolHookTriggers applies modifications and rebuilds invocation
- [ ] coreToolScheduler passes tool parameter
- [ ] Modification message appended to tool result
- [ ] Unit tests for modification scenarios
- [ ] Integration tests added (if infrastructure exists) or SKIP documented
- [ ] npm run typecheck passes
- [ ] npm run test -- packages/core/src/hooks/ passes
- [ ] npm run test -- packages/core/src/core/ passes
