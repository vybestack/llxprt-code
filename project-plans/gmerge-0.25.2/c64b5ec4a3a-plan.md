# Playbook: Add HookSystem Facade Wrapper Methods

**Upstream SHA:** `c64b5ec4a3a`
**Upstream Subject:** feat(hooks): simplify hook firing with HookSystem wrapper methods (#15982)
**Upstream Stats:** ~3 files, moderate insertions

## What Upstream Does

Upstream adds convenience wrapper methods directly on `HookSystem` that delegate to the internal `HookEventHandler`. Instead of callers doing:
```typescript
const eventHandler = hookSystem.getEventHandler();
await eventHandler.fireBeforeToolEvent(toolName, toolInput);
```
They can now do:
```typescript
await hookSystem.fireBeforeToolEvent(toolName, toolInput);
```

This simplifies the call sites in trigger files (`coreToolHookTriggers.ts`, `lifecycleHookTriggers.ts`, `geminiChatHookTriggers.ts`) by removing the `getEventHandler()` boilerplate.

## Why REIMPLEMENT in LLxprt

1. LLxprt's `HookSystem` (in `packages/core/src/hooks/hookSystem.ts`, lines 38-182) was rewritten per PLAN-20260216-HOOKSYSTEMREWRITE and exposes only `getRegistry()`, `getEventHandler()`, `isInitialized()`, `setHookEnabled()`, `getAllHooks()`, and `dispose()` — it does NOT have any fire* wrapper methods.
2. LLxprt's `HookEventHandler` (in `packages/core/src/hooks/hookEventHandler.ts`) has the full fire* API across 11 methods: `fireBeforeToolEvent` (line 187), `fireAfterToolEvent` (line 201), `fireBeforeModelEvent` (line 219), `fireAfterModelEvent` (line 239), `fireBeforeToolSelectionEvent` (line 261), `fireSessionStartEvent` (line 283), `fireSessionEndEvent` (line 305), `firePreCompressEvent` (line 326), `fireBeforeAgentEvent` (line 347), `fireAfterAgentEvent` (line 368), `fireNotificationEvent` (line 391).
3. LLxprt's trigger files currently call `config.getHookSystem()?.getEventHandler()?.fire*()`.
4. The wrapper pattern is valuable but must handle LLxprt's lazy initialization (`HookSystemNotInitializedError`) and the `dispose()` lifecycle correctly. The `getEventHandler()` method (line 135) already throws `HookSystemNotInitializedError` when `this.eventHandler` is null, so wrappers inherit that guard for free by delegating through `this.getEventHandler()`.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/hooks/hookSystem.ts` — `HookSystem` class (lines 38-182), no fire* methods, `getEventHandler()` at line 135 throws `HookSystemNotInitializedError` if `this.eventHandler` is null
- [OK] `packages/core/src/hooks/hookSystem.ts` — `eventHandler: HookEventHandler | null = null` at line 44
- [OK] `packages/core/src/hooks/hookEventHandler.ts` — Full fire* API: 11 public async methods (lines 187-407)
- [OK] `packages/core/src/hooks/hookEventHandler.ts` — Return types: `DefaultHookOutput | undefined` for BeforeTool/AfterTool, `AggregatedHookResult` for all others
- [OK] `packages/core/src/hooks/types.ts` — `DefaultHookOutput` class at line 135, `SessionStartSource` enum at line 560, `SessionEndReason` enum at line 587, `PreCompressTrigger` enum at line 605, `NotificationType` enum at line 527
- [OK] `packages/core/src/hooks/hookAggregator.ts` — `AggregatedHookResult` type (exported)
- [OK] `packages/core/src/core/coreToolHookTriggers.ts` — Uses `config.getHookSystem()` → `getEventHandler()` pattern
- [OK] `packages/core/src/core/lifecycleHookTriggers.ts` — Same pattern
- [OK] `packages/core/src/core/geminiChatHookTriggers.ts` — Same pattern
- [OK] `packages/core/src/hooks/hookSystem.test.ts` — Tests for HookSystem
- [OK] `packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts` — Lifecycle tests
- [OK] `packages/core/src/hooks/__tests__/hookSystem-integration.test.ts` — Integration tests

## Files to Modify / Create

### 1. Modify: `packages/core/src/hooks/hookSystem.ts`

Add 11 wrapper methods that delegate to `this.getEventHandler()`. Each method must match the exact signature of the corresponding `HookEventHandler` method. Place them after `getAllHooks()` (line 171) and before `dispose()` (line 179).

Add required imports at the top of the file:
```typescript
import type { AggregatedHookResult } from './hookAggregator.js';
import type {
  DefaultHookOutput,
  SessionStartSource,
  SessionEndReason,
  PreCompressTrigger,
} from './types.js';
import { type NotificationType } from './types.js';
```

Note: `NotificationType` is a value enum (used in parameter position), so it needs a value import, not just a type import. Check whether the trigger files pass `NotificationType` values or string literals to determine if the value import is strictly needed.

Wrapper methods to add:

```typescript
// --- Convenience wrappers delegating to HookEventHandler ---

async fireBeforeToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined> {
  return this.getEventHandler().fireBeforeToolEvent(toolName, toolInput);
}

async fireAfterToolEvent(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResponse: Record<string, unknown>,
): Promise<DefaultHookOutput | undefined> {
  return this.getEventHandler().fireAfterToolEvent(toolName, toolInput, toolResponse);
}

async fireBeforeModelEvent(llmRequest: unknown): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireBeforeModelEvent(llmRequest);
}

async fireAfterModelEvent(llmRequest: unknown, llmResponse: unknown): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireAfterModelEvent(llmRequest, llmResponse);
}

async fireBeforeToolSelectionEvent(llmRequest: unknown): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireBeforeToolSelectionEvent(llmRequest);
}

async fireSessionStartEvent(context: { source: SessionStartSource }): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireSessionStartEvent(context);
}

async fireSessionEndEvent(context: { reason: SessionEndReason }): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireSessionEndEvent(context);
}

async firePreCompressEvent(context: { trigger: PreCompressTrigger }): Promise<AggregatedHookResult> {
  return this.getEventHandler().firePreCompressEvent(context);
}

async fireBeforeAgentEvent(context: { prompt: string }): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireBeforeAgentEvent(context);
}

async fireAfterAgentEvent(context: {
  prompt: string;
  prompt_response: string;
  stop_hook_active: boolean;
}): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireAfterAgentEvent(context);
}

async fireNotificationEvent(
  type: NotificationType,
  message: string,
  details: Record<string, unknown>,
): Promise<AggregatedHookResult> {
  return this.getEventHandler().fireNotificationEvent(type, message, details);
}
```

### 2. Modify: `packages/core/src/hooks/hookSystem.test.ts`

Add tests verifying each wrapper method delegates correctly:
- **Delegation test:** Initialize HookSystem, mock `HookEventHandler` methods on the event handler, call `hookSystem.fire*()`, verify the handler method was called with correct args.
- **Not-initialized test:** Call `hookSystem.fireBeforeToolEvent()` before `initialize()` — verify `HookSystemNotInitializedError` is thrown (this comes for free from `getEventHandler()` at line 136-141).
- Test at least 3-4 representative methods (BeforeTool, BeforeModel, SessionStart, Notification) rather than all 11 to keep test surface manageable while still validating the pattern.

### 3. (Deferred to later batch) Update trigger files

This batch adds the wrappers. A future batch (e.g., 8a2e0fac0d8 — "Add other hook wrapper methods to hooksystem") or trigger-refactoring batches can simplify call sites from:
```typescript
hookSystem.getEventHandler().fireBeforeToolEvent(...)
```
to:
```typescript
hookSystem.fireBeforeToolEvent(...)
```

Do NOT update trigger files in this batch — that is a separate concern and avoids inflating the diff.

## Preflight Checks

```bash
# Verify HookSystem class has no fire* methods
grep -c "fire.*Event" packages/core/src/hooks/hookSystem.ts
# Expected: 0

# Verify HookEventHandler has 11 fire* methods
grep -c "async fire.*Event" packages/core/src/hooks/hookEventHandler.ts
# Expected: 11

# Verify getEventHandler() exists and throws when not initialized
grep -n "getEventHandler" packages/core/src/hooks/hookSystem.ts
# Expected: line 135

# Verify HookSystemNotInitializedError import exists
grep "HookSystemNotInitializedError" packages/core/src/hooks/hookSystem.ts

# Verify types needed for wrapper signatures exist
grep -n "SessionStartSource\|SessionEndReason\|PreCompressTrigger\|NotificationType" \
  packages/core/src/hooks/types.ts
```

## Implementation Steps

1. **Read** `hookSystem.ts` to confirm current method list, import structure, and where to insert new methods (after line 171, before line 179).
2. **Read** `hookEventHandler.ts` lines 187-407 to capture exact method signatures (parameter types and return types) for all 11 fire* methods.
3. **Read** `types.ts` to confirm type imports needed: `DefaultHookOutput` (line 135), `SessionStartSource` (line 560), `SessionEndReason` (line 587), `PreCompressTrigger` (line 605), `NotificationType` (line 527).
4. **Read** `hookAggregator.ts` to confirm `AggregatedHookResult` export.
5. **Add imports** to `hookSystem.ts` for the types needed by the wrapper signatures.
6. **Add 11 wrapper methods** after `getAllHooks()`, each calling `this.getEventHandler().fire*()`.
7. **Add tests** in `hookSystem.test.ts`:
   - Test delegation for representative methods
   - Test `HookSystemNotInitializedError` when called before `initialize()`
8. **Run verification.**

## Verification

```bash
npm run typecheck
npm run lint
npm run test -- --reporter=verbose packages/core/src/hooks/hookSystem.test.ts
npm run test -- --reporter=verbose packages/core/src/hooks/
npm run build
```

## Execution Notes / Risks

- **Risk: Signature drift.** If `HookEventHandler` signatures change before this batch runs (e.g., from a prior batch adding `mcp_context` parameters to BeforeTool/AfterTool), the wrapper signatures must match. Always re-read `hookEventHandler.ts` before implementing.
- **Risk: Import cost for `NotificationType`.** `NotificationType` is a value enum (line 527 of `types.ts`), which means importing it brings runtime code. Since it's used in the `fireNotificationEvent` parameter type, a value import is needed if callers pass enum members. If only `type` is needed (because callers pass strings), use `import type`. Check existing call sites in `coreToolHookTriggers.ts` to decide.
- **Do NOT** update trigger files in this batch. The wrappers are additive — existing `getEventHandler()` call pattern continues to work.
- **Do NOT** expose `HookEventHandler` internals (like `buildFailureEnvelope`, `makeEmptySuccessResult`, `processCommonHookOutputFields`) through the wrappers — only the public fire* API.
- The `getEventHandler()` call at line 135-141 already throws `HookSystemNotInitializedError` when `this.eventHandler` is null, so the wrappers inherit that guard for free — no additional null checks needed in the wrappers.
- Keep `@plan` and `@requirement` annotation style consistent with existing methods in `hookSystem.ts`.
