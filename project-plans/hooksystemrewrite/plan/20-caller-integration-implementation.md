# Phase 20: Caller Integration — Implementation

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P20

## Prerequisites
- P19 completed (failing tests exist)
- Verification: All 8 tests from P19 FAIL
- `npm run test -- hooks-caller-integration.test.ts` shows 8 failures

## Purpose

Implement the changes required to make P19 tests pass. This is the GREEN phase of TDD.

## Implementation Tasks

### Task 1: Change Trigger Function Return Types

**File:** `packages/core/src/core/coreToolHookTriggers.ts`

```typescript
// BEFORE
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<void> { ... }

// AFTER
export async function triggerBeforeToolHook(
  config: Config,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<BeforeToolHookOutput | undefined> {
  if (!config.getEnableHooks?.()) {
    return undefined;
  }
  
  const hookSystem = config.getHookSystem();
  if (!hookSystem) {
    return undefined;
  }
  
  try {
    await hookSystem.initialize();
    const eventHandler = hookSystem.getEventHandler();
    const result = await eventHandler.fireBeforeToolEvent(toolName, toolInput);
    
    if (!result || !result.finalOutput) {
      return undefined;
    }
    
    return new BeforeToolHookOutput(result.finalOutput);
  } catch (error) {
    debugLogger.warn(`BeforeTool hook failed (non-blocking):`, error);
    return undefined;
  }
}
```

**Same pattern for:**
- `triggerAfterToolHook` → `Promise<AfterToolHookOutput | undefined>`
- `triggerBeforeModelHook` → `Promise<BeforeModelHookOutput | undefined>`
- `triggerAfterModelHook` → `Promise<AfterModelHookOutput | undefined>`
- `triggerBeforeToolSelectionHook` → `Promise<BeforeToolSelectionHookOutput | undefined>`

### Task 2: Add Missing Output Wrapper Methods

**File:** `packages/core/src/hooks/types.ts`

Add methods that are tested but may not exist:

```typescript
// BeforeToolHookOutput additions
getModifiedToolInput(): Record<string, unknown> | undefined {
  return this.hookSpecificOutput?.tool_input;
}

// AfterToolHookOutput additions  
getAdditionalContext(): string | undefined {
  return this.hookSpecificOutput?.additionalContext;
}

// BeforeToolSelectionHookOutput additions
getModifiedToolConfig(): HookToolConfig | undefined {
  return this.hookSpecificOutput?.toolConfig;
}

// BeforeModelHookOutput additions
getSyntheticResponse(): HookLLMResponse | undefined {
  return this.hookSpecificOutput?.llm_response;
}
```

### Task 3: Use HookSystem Singleton (Fix Per-Call Recreation)

**Current broken pattern (in all trigger files):**
```typescript
const hookRegistry = new HookRegistry(config);
await hookRegistry.initialize();
const hookPlanner = new HookPlanner(hookRegistry);
const hookRunner = new HookRunner();
```

**Fixed pattern:**
```typescript
const hookSystem = config.getHookSystem();
if (!hookSystem) return undefined;
await hookSystem.initialize();
const eventHandler = hookSystem.getEventHandler();
```

### Task 4: Fix Fake Data in Model Hooks

**File:** `packages/core/src/core/geminiChatHookTriggers.ts`

```typescript
// BEFORE (line ~159)
llm_request: {} as never,

// AFTER
llm_request: defaultHookTranslator.toHookLLMRequest(actualRequest),
```

This requires passing the actual `GenerateContentParameters` to `triggerAfterModelHook` and `triggerBeforeToolSelectionHook`.

### Task 5: Ensure HookEventHandler.fire*Event Returns Correctly

**File:** `packages/core/src/hooks/hookEventHandler.ts`

Verify that `fireBeforeToolEvent`, `fireAfterToolEvent`, etc. return `AggregatedHookResult` (not void).

Current implementation should already do this, but verify the return path.

## Files to Modify

| File | Changes |
|------|---------|
| `coreToolHookTriggers.ts` | Return typed outputs, use HookSystem singleton |
| `geminiChatHookTriggers.ts` | Return typed outputs, use HookSystem singleton, pass real llm_request |
| `types.ts` | Add missing output wrapper methods if needed |
| `hookEventHandler.ts` | Verify return types are correct |

## Verification Commands

```bash
# Run the failing tests — they should now PASS
cd packages/core
npm run test -- hooks-caller-integration.test.ts --no-coverage

# Expected: 8 passing tests

# Run full suite to ensure no regressions
npm run test
npm run typecheck
npm run lint
npm run build
```

## Success Criteria for P20

- [ ] All 8 tests from P19 now PASS
- [ ] `triggerBeforeToolHook` returns `Promise<BeforeToolHookOutput | undefined>`
- [ ] `triggerAfterToolHook` returns `Promise<AfterToolHookOutput | undefined>`
- [ ] `triggerBeforeModelHook` returns `Promise<BeforeModelHookOutput | undefined>`
- [ ] `triggerAfterModelHook` returns `Promise<AfterModelHookOutput | undefined>`
- [ ] `triggerBeforeToolSelectionHook` returns `Promise<BeforeToolSelectionHookOutput | undefined>`
- [ ] HookSystem singleton is used (no per-call recreation)
- [ ] Model hooks receive real `llm_request` (not `{} as never`)
- [ ] Full test suite passes
- [ ] TypeScript compiles without errors

## Phase Completion Marker
- Update `project-plans/hooksystemrewrite/.completed/P20.md`
- Set Status: COMPLETED when all criteria met
