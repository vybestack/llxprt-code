# REIMPLEMENT Playbook: e92f60b — migrate BeforeModel/AfterModel hooks to HookSystem

## Upstream Change Summary

Upstream migrated the BeforeModel and AfterModel hooks from `geminiChatHookTriggers.ts` into `HookSystem`:

1. **Added methods to `HookSystem`**:
   - `fireBeforeModelEvent()`
   - `fireAfterModelEvent()`
   - `fireBeforeToolSelectionEvent()`

2. **Updated `geminiChat.ts`**:
   - Uses `hookSystem.fireBeforeModelEvent()` directly
   - Uses `hookSystem.fireAfterModelEvent()` directly
   - Simplified hook checking

3. **Removed separate trigger imports**: No longer imports `fireBeforeModelHook`, `fireAfterModelHook`

## LLxprt Current State

**CRITICAL DIFFERENCES FROM UPSTREAM — READ CAREFULLY**

**`packages/core/src/hooks/hookSystem.ts`**

LLxprt's `HookSystem` already has `fireBeforeModelEvent()`, `fireAfterModelEvent()`, and `fireBeforeToolSelectionEvent()` methods. HOWEVER, they return `AggregatedHookResult` (a wrapper), NOT typed upstream result objects (`BeforeModelHookResult`, `AfterModelHookResult`, etc.):

```typescript
async fireBeforeModelEvent(llmRequest: unknown): Promise<AggregatedHookResult>
async fireAfterModelEvent(llmRequest: unknown, llmResponse: unknown): Promise<AggregatedHookResult>
async fireBeforeToolSelectionEvent(llmRequest: unknown): Promise<AggregatedHookResult>
```

The upstream plan calls for these to return typed result objects like `BeforeModelHookResult`. LLxprt's architecture diverges here: results are wrapped in `AggregatedHookResult` and callers must unwrap via `result.finalOutput`.

**`packages/core/src/core/geminiChatHookTriggers.ts`**

LLxprt has trigger functions (`triggerBeforeModelHook`, `triggerAfterModelHook`, `triggerBeforeToolSelectionHook`) that:
- Check `config.getEnableHooks?.()` and `config.getHookSystem?.()`
- Call `hookSystem.initialize()` 
- Call `hookSystem.fire*Event()`
- Unwrap `result.finalOutput` and return typed output objects (`BeforeModelHookOutput`, etc.)

**`packages/core/src/core/geminiChat.ts`**

LLxprt's `GeminiChat` is a thin coordinator that delegates to decomposed modules: `TurnProcessor`, `StreamProcessor`, `DirectMessageProcessor`, `CompressionHandler`, `ConversationManager`. It does NOT call the model or hook triggers directly. Hook calls happen inside `TurnProcessor` and/or `StreamProcessor`, NOT in `geminiChat.ts`.

> **IMPORTANT**: The upstream change that moves hook calls into `geminiChat.ts` directly using `hookSystem.fire*` does NOT apply to LLxprt's architecture. The hook trigger call sites are in `TurnProcessor` and/or `StreamProcessor`. Do NOT add hook calls to `geminiChat.ts`.

## Correct LLxprt Architecture Assessment

The migration goal is: **have `TurnProcessor`/`StreamProcessor` call `hookSystem.fire*` directly, instead of going through the standalone trigger functions in `geminiChatHookTriggers.ts`.**

This eliminates the middleman trigger functions while preserving the same semantics.

### Step 1: Identify actual hook call sites

Before implementing, read these files to find where `triggerBeforeModelHook`, `triggerAfterModelHook`, and `triggerBeforeToolSelectionHook` are actually called:

- `packages/core/src/core/TurnProcessor.ts`
- `packages/core/src/core/StreamProcessor.ts`
- Any other files that import from `geminiChatHookTriggers.ts`

Use grep: `grep -r "triggerBeforeModelHook\|triggerAfterModelHook\|triggerBeforeToolSelectionHook" packages/core/src/`

### Step 2: Understand the existing trigger function semantics

Each trigger function in `geminiChatHookTriggers.ts`:
1. Guards with `config.getEnableHooks?.()` check
2. Gets `hookSystem` via `config.getHookSystem?.()`
3. Calls `hookSystem.initialize()`
4. Fires event, gets `AggregatedHookResult`
5. Unwraps `result.finalOutput` and wraps in typed output class
6. Returns the typed output or `undefined`

The migration must preserve all of these semantics at the call site.

### Step 3: Migration approach

**Option A (Preferred)**: Move the logic from trigger functions into `HookSystem` facade methods, returning typed output objects instead of `AggregatedHookResult`.

This means changing the return types of `HookSystem.fireBeforeModelEvent()` etc. from `Promise<AggregatedHookResult>` to `Promise<BeforeModelHookOutput | undefined>`.

**Option B (Safe fallback)**: Keep trigger functions but simplify them to thin wrappers with no logic beyond the HookSystem call, and keep call sites unchanged.

> Option A is the cleaner migration. Option B is acceptable if the return type change is too disruptive. Choose based on the actual call sites found in Step 1.

### If Option A is chosen:

**`packages/core/src/hooks/hookSystem.ts`** changes:

```typescript
// Change return types to match what callers actually need:

async fireBeforeModelEvent(
  llmRequest: unknown,
): Promise<BeforeModelHookOutput | undefined> {
  const result = await this.getEventHandler().fireBeforeModelEvent(llmRequest);
  if (result.finalOutput) {
    return new BeforeModelHookOutput(result.finalOutput);
  }
  return undefined;
}

async fireAfterModelEvent(
  llmRequest: unknown,
  llmResponse: unknown,
): Promise<AfterModelHookOutput | undefined> {
  const result = await this.getEventHandler().fireAfterModelEvent(llmRequest, llmResponse);
  if (result.finalOutput) {
    return new AfterModelHookOutput(result.finalOutput);
  }
  return undefined;
}

async fireBeforeToolSelectionEvent(
  llmRequest: unknown,
): Promise<BeforeToolSelectionHookOutput | undefined> {
  const result = await this.getEventHandler().fireBeforeToolSelectionEvent(llmRequest);
  if (result.finalOutput) {
    return new BeforeToolSelectionHookOutput(result.finalOutput);
  }
  return undefined;
}
```

> IMPORTANT: These method signatures currently return `AggregatedHookResult`. Changing them is a breaking change for any existing callers. Before changing, grep for all callers of `hookSystem.fireBeforeModelEvent`, `hookSystem.fireAfterModelEvent`, `hookSystem.fireBeforeToolSelectionEvent` and update all of them.

The trigger functions also add error handling (try/catch returning `undefined` on failure). This must be preserved — either in `HookSystem` or at call sites.

**`packages/core/src/core/TurnProcessor.ts` (and/or `StreamProcessor.ts`)** changes:

Replace calls to trigger functions with direct `hookSystem.fire*` calls:

```typescript
// Before:
import { triggerBeforeModelHook } from './geminiChatHookTriggers.js';
// ...
const beforeModelResult = await triggerBeforeModelHook(config, request);

// After:
const hookSystem = config.getHookSystem?.();
if (hookSystem && config.getEnableHooks?.()) {
  try {
    await hookSystem.initialize();
    const beforeModelResult = await hookSystem.fireBeforeModelEvent(llmRequest);
    // ... use beforeModelResult
  } catch (error) {
    // Hooks are fail-open — log and continue
    debugLogger.debug('BeforeModel hook failed (non-blocking):', error);
  }
}
```

**`packages/core/src/core/geminiChatHookTriggers.ts`** outcome:

- If ALL call sites are migrated to call `hookSystem.fire*` directly: remove the trigger function file entirely.
- If some call sites remain (e.g., other consumers): retain the file but simplify to thin wrappers, or keep as-is.

> Add a grep verification step: after migration, verify `grep -r "geminiChatHookTriggers" packages/core/src/` returns no results (or only test files if any tests depend on it).

## Files to Read (Required Before Implementation)

1. `packages/core/src/hooks/hookSystem.ts` — verify current return types
2. `packages/core/src/core/geminiChatHookTriggers.ts` — understand exact semantics
3. `packages/core/src/core/geminiChat.ts` — confirm it does NOT call hooks directly
4. `packages/core/src/core/TurnProcessor.ts` — find actual hook call sites
5. `packages/core/src/core/StreamProcessor.ts` — find actual hook call sites
6. `packages/core/src/core/geminiChat.test.ts` — understand current test mock patterns

Run: `grep -r "triggerBeforeModelHook\|triggerAfterModelHook\|triggerBeforeToolSelectionHook\|geminiChatHookTriggers" packages/core/src/`

## Files to Modify

- `packages/core/src/hooks/hookSystem.ts` — change return types of `fire*Model*` methods (if Option A)
- `packages/core/src/core/TurnProcessor.ts` (and/or `StreamProcessor.ts`) — replace trigger function calls with direct hookSystem calls
- `packages/core/src/core/geminiChatHookTriggers.ts` — simplify or remove
- `packages/core/src/core/geminiChat.test.ts` — update mocks if hook call patterns change

## Files to Verify (Do NOT modify unless broken)

- `packages/core/src/core/geminiChat.ts` — should NOT need changes (it does not call hooks)

## Regression Verification

After implementation, run ALL of:

1. `npm run test -- packages/core/src/core/geminiChat.test.ts`
2. `npm run test -- packages/core/src/hooks/`
3. `grep -r "geminiChatHookTriggers" packages/core/src/` — expect no results if file removed (test files excepted)
4. `grep -r "triggerBeforeModelHook\|triggerAfterModelHook\|triggerBeforeToolSelectionHook" packages/core/src/` — expect no results if all migrated
5. Manual smoke test: hooks fire correctly for BeforeModel, AfterModel, BeforeToolSelection events

## Key Architectural Constraints

1. **LLxprt's `geminiChat.ts` does NOT call hooks** — the file is a thin coordinator. Hook calls are in `TurnProcessor`/`StreamProcessor`. Do not add hook calls to `geminiChat.ts`.
2. **`HookSystem.fire*` currently returns `AggregatedHookResult`** — this is a breaking change if altered. Update ALL callers before changing signatures.
3. **Hooks are fail-open** — any error from hook execution must be caught and logged; it must never block model execution.
4. **`hookSystem.initialize()` must be called before first fire** — this is already done in trigger functions. Preserve this at call sites.
5. **`geminiChatHookTriggers.ts` should be removed if unused** — but only after all call sites are verified migrated. Grep to confirm.
6. **Do not reference `client.ts`** — LLxprt uses `geminiChat.ts` (and `TurnProcessor.ts`, `StreamProcessor.ts`). There is no `client.ts`.

## Test Update Pattern

If hook mocking moves to `HookSystem` directly:

```typescript
// In geminiChat.test.ts (or TurnProcessor.test.ts):
let mockHookSystem: Partial<HookSystem>;

beforeEach(() => {
  mockHookSystem = {
    initialize: vi.fn().mockResolvedValue(undefined),
    fireBeforeModelEvent: vi.fn().mockResolvedValue(undefined),
    fireAfterModelEvent: vi.fn().mockResolvedValue(undefined),
    fireBeforeToolSelectionEvent: vi.fn().mockResolvedValue(undefined),
  };
  mockConfig.getHookSystem = vi.fn().mockReturnValue(mockHookSystem);
  mockConfig.getEnableHooks = vi.fn().mockReturnValue(true);
});
```

Note: mock `fireBeforeModelEvent` to return `undefined` (no output) for happy path, and return a `BeforeModelHookOutput` instance for hook-blocking tests.
