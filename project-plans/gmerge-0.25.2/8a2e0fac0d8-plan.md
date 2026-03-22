# Playbook: Add LLxprt-Native HookSystem Wrapper Methods

**Upstream SHA:** `8a2e0fac0d8`
**Upstream Subject:** Add other hook wrapper methods to hooksystem (#16361)
**Upstream Stats:** hooks/facade refactor; small-to-moderate LLxprt adaptation

## What Upstream Does

Upstream rounds out the `HookSystem` facade by adding the remaining event-firing wrapper methods so callers can invoke hook events directly on `HookSystem` instead of pulling `getEventHandler()` and calling the handler manually. The goal is a cleaner call surface, reduced boilerplate, and a single public facade for hook firing.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this batch **REIMPLEMENT** because LLxprt’s hook subsystem was rewritten and should expose facade methods in an LLxprt-native way rather than through an upstream patch.
2. LLxprt already has `packages/core/src/hooks/hookSystem.ts` as the facade object, plus `packages/core/src/hooks/hookEventHandler.ts` as the execution engine.
3. The earlier wrapper-method batch (`c64b5ec4a3a`) covers the initial facade concept, but this commit’s intent is to finish the facade so wrapper methods integrate with LLxprt’s existing hook facade/event model rather than leaving trigger files coupled to `getEventHandler()`.
4. Current LLxprt trigger files still fetch the handler explicitly:
   - `packages/core/src/core/coreToolHookTriggers.ts`
   - `packages/core/src/core/lifecycleHookTriggers.ts`
   - `packages/core/src/core/geminiChatHookTriggers.ts`
5. The user explicitly noted that hook wrapper methods should integrate with the existing LLxprt hook facade/event model. That means this batch should use `HookSystem` as the public firing surface and keep `HookEventHandler` as an internal collaborator.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/hooks/hookSystem.ts` — public hook facade; currently exposes lifecycle/registry accessors and may already have partial wrapper coverage depending on prior batches
- [OK] `packages/core/src/hooks/hookEventHandler.ts` — internal hook firing implementation with `fire*` methods
- [OK] `packages/core/src/core/coreToolHookTriggers.ts` — still calls `hookSystem.getEventHandler()` directly for tool hooks
- [OK] `packages/core/src/core/lifecycleHookTriggers.ts` — still calls `hookSystem.getEventHandler()` directly for lifecycle hooks
- [OK] `packages/core/src/core/geminiChatHookTriggers.ts` — still calls `hookSystem.getEventHandler()` directly for model/tool-selection hooks
- [OK] `packages/core/src/hooks/hookSystem.test.ts` — unit tests for facade behavior
- [OK] `packages/core/src/hooks/__tests__/hookSystem-integration.test.ts` — direct-path integration coverage

**No new architecture required:**
- This batch should stay inside the existing `HookSystem` / trigger-file structure.

## Files to Modify/Create

### Modify: `packages/core/src/hooks/hookSystem.ts`
- Ensure `HookSystem` exposes the full wrapper surface needed by current trigger callers.
- Method signatures must match LLxprt’s current `HookEventHandler` methods and return types exactly.
- Wrapper methods should delegate through `this.getEventHandler()` so initialization guards and `HookSystemNotInitializedError` behavior remain centralized.

### Modify: `packages/core/src/core/coreToolHookTriggers.ts`
- Replace direct `getEventHandler().fireBeforeToolEvent(...)` / `fireAfterToolEvent(...)` usage with `hookSystem.fireBeforeToolEvent(...)` / `hookSystem.fireAfterToolEvent(...)`.
- Preserve current initialization, non-blocking error handling, and typed output wrapping.

### Modify: `packages/core/src/core/lifecycleHookTriggers.ts`
- Replace direct event-handler calls with the matching `HookSystem` wrapper methods for session/agent lifecycle events.
- Preserve existing return-shape logic and logging behavior.

### Modify: `packages/core/src/core/geminiChatHookTriggers.ts`
- Replace direct event-handler calls with `HookSystem` wrapper methods for `BeforeModel`, `AfterModel`, and `BeforeToolSelection`.
- Preserve request/response translation to LLxprt hook payloads.

### Modify: `packages/core/src/hooks/hookSystem.test.ts`
- Add or update facade tests to verify representative wrapper methods delegate correctly and still throw `HookSystemNotInitializedError` when called too early.

### Maybe modify: `packages/core/src/core/*HookTriggers*.test.ts`
- Update mocks if tests currently expect `getEventHandler()` usage rather than facade-method usage.
- Keep tests focused on observable behavior, not private plumbing.

## Preflight Checks

```bash
# Inspect current HookSystem public API
sed -n '1,260p' packages/core/src/hooks/hookSystem.ts

# Inspect current direct getEventHandler() usage in trigger files
grep -n "getEventHandler" packages/core/src/core/coreToolHookTriggers.ts
grep -n "getEventHandler" packages/core/src/core/lifecycleHookTriggers.ts
grep -n "getEventHandler" packages/core/src/core/geminiChatHookTriggers.ts

# Review current HookEventHandler fire methods/signatures
grep -n "async fire.*Event" packages/core/src/hooks/hookEventHandler.ts

# Review existing HookSystem tests
sed -n '1,260p' packages/core/src/hooks/hookSystem.test.ts
```

## Implementation Steps

1. Read `hookSystem.ts` and inventory the current wrapper-method coverage as it exists in the repo at execution time.
2. Read `hookEventHandler.ts` and confirm the exact signatures/return types of the remaining `fire*` methods.
3. Fill in any missing wrapper methods on `HookSystem` so the facade is complete for current trigger-file call sites.
4. Update `coreToolHookTriggers.ts` to call facade methods directly on `hookSystem`.
5. Update `lifecycleHookTriggers.ts` to call facade methods directly on `hookSystem`.
6. Update `geminiChatHookTriggers.ts` to call facade methods directly on `hookSystem`.
7. Adjust unit/integration tests and mocks to reflect the facade-level API while preserving LLxprt’s existing non-blocking trigger semantics.
8. Run verification.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/core/src/hooks/hookSystem.test.ts
npm run test -- --reporter=verbose packages/core/src/core
npm run build
```

## Execution Notes / Risks

- **Key repo fact:** hook wrapper methods should integrate with LLxprt’s existing hook facade/event model.
- **Risk:** this batch may run after `c64b5ec4a3a`; re-read the current tree first so you do not duplicate already-landed wrappers or regress signatures changed by other hook batches.
- **Risk:** some tests may mock `HookSystem` with only `getEventHandler()` defined. Those test doubles must be updated to include the facade methods used by the trigger under test.
- **Risk:** avoid bypassing `initialize()` or changing current trigger-level error swallowing. The facade refactor is about API shape, not hook execution semantics.
- **Do not** expose `HookEventHandler` internals or move logic out of trigger files beyond swapping the public call surface.
- **Do not** invent new hook events or rename existing LLxprt hook methods for upstream parity.
- **Success criteria:** trigger files use `HookSystem` as the stable public hook-firing facade, while LLxprt keeps the same event translations, return wrapping, and non-blocking behavior.
