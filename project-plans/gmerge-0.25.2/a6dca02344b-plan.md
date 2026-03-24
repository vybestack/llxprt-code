# Playbook: Refactor BeforeAgent and AfterAgent Hook Event Output Semantics

**Upstream SHA:** `a6dca02344b`
**Upstream Subject:** Refactor beforeAgent and afterAgent hookEvents to follow desired output (#16495)
**Upstream Stats:** hooks / agent lifecycle refactor; adapt in place

## What Upstream Does

Upstream changes the `beforeAgent` and `afterAgent` hook event outputs so they follow the newer hook-output contract rather than ad hoc lifecycle-specific behavior. In practical terms, the upstream intent is:

1. `beforeAgent` should return a normalized hook-output object that can cleanly signal allow/deny/stop semantics and any prompt augmentation.
2. `afterAgent` should return a normalized hook-output object that can cleanly signal post-turn continuation behavior without bespoke formatting.
3. The trigger layer should emit the desired output shape consistently so callers do not need event-specific special cases.
4. The runtime should preserve user-visible hook behavior while relying on the shared hook output contract.

## Why REIMPLEMENT in LLxprt

1. LLxprt already has substantial hook infrastructure with `DefaultHookOutput`, `BeforeAgentHookOutput`, and `AfterAgentHookOutput`, plus `triggerBeforeAgentHook()` and `triggerAfterAgentHook()` in `packages/core/src/core/lifecycleHookTriggers.ts`.
2. LLxprt already uses `BeforeAgentHookOutput` / `AfterAgentHookOutput` in the real runtime path in `packages/core/src/core/client.ts`, so this work must integrate with current LLxprt hook output semantics rather than upstream’s exact internal wiring.
3. The repo already has tests around lifecycle hook triggers and client behavior for before/after agent hook handling, so the safest path is to normalize output generation where LLxprt actually consumes it instead of introducing new architecture.
4. This batch must preserve LLxprt’s existing hook semantics, including blocking/continuation handling already exercised in `client.ts` and `client.test.ts`.
5. The source of truth says this is REIMPLEMENT, not PICK, because LLxprt’s HookSystem and lifecycle flow have diverged.

## LLxprt File Existence Map

**Present and relevant:**
- `packages/core/src/hooks/types.ts` — contains `BeforeAgentHookOutput`, `AfterAgentHookOutput`, and shared hook output helpers.
- `packages/core/src/core/lifecycleHookTriggers.ts` — constructs lifecycle hook outputs for BeforeAgent / AfterAgent.
- `packages/core/src/hooks/hookEventHandler.ts` — fires `BeforeAgent` and `AfterAgent` events.
- `packages/core/src/hooks/hookAggregator.ts` — shared aggregation path for hook outputs.
- `packages/core/src/core/client.ts` — real runtime consumer of BeforeAgent / AfterAgent outputs.
- `packages/core/src/core/lifecycleHookTriggers.test.ts` — direct trigger coverage.
- `packages/core/src/core/client.test.ts` — runtime behavior coverage for lifecycle hook outputs.

**Absent and should remain absent for this batch:**
- Any upstream `/agents` or agent-registry files.
- Any new lifecycle-hook subsystem.

## Files to Modify/Create

**Modify only as needed:**
- `packages/core/src/hooks/types.ts`
- `packages/core/src/core/lifecycleHookTriggers.ts`
- `packages/core/src/core/client.ts`
- `packages/core/src/core/lifecycleHookTriggers.test.ts`
- `packages/core/src/core/client.test.ts`

**Do not create new files unless a narrowly scoped test helper is truly required.** Prefer adapting existing tests.

## Preflight Checks

```bash
grep -n "BeforeAgentHookOutput\|AfterAgentHookOutput" packages/core/src/hooks/types.ts

grep -n "triggerBeforeAgentHook\|triggerAfterAgentHook" \
  packages/core/src/core/lifecycleHookTriggers.ts

grep -n "BeforeAgent hook blocked\|AfterAgent hook" \
  packages/core/src/core/client.ts

grep -n "BeforeAgent hook result handling\|AfterAgent hook result handling" \
  packages/core/src/core/client.test.ts
```

Preflight intent:
- Confirm the lifecycle hook output classes already exist.
- Confirm trigger functions already construct those outputs.
- Confirm `client.ts` remains the live runtime integration point.
- Confirm tests already cover LLxprt’s current semantics before changing behavior.

## Implementation Steps

1. Read `packages/core/src/hooks/types.ts` to verify exactly which shared output fields and helper methods `BeforeAgentHookOutput` and `AfterAgentHookOutput` inherit today.
2. Read `packages/core/src/core/lifecycleHookTriggers.ts` to confirm how aggregated hook output is converted into lifecycle-specific output classes.
3. Read the BeforeAgent / AfterAgent handling in `packages/core/src/core/client.ts` to identify any remaining event-specific assumptions that bypass shared hook-output semantics.
4. Rework lifecycle output normalization so `BeforeAgent` and `AfterAgent` use the shared LLxprt hook-output contract consistently, but preserve current runtime meaning:
   - `BeforeAgent` should keep blocking/stop behavior for the current turn.
   - `AfterAgent` should keep LLxprt’s continuation semantics already implemented in `client.ts`.
5. If any lifecycle-specific formatting or fallback logic exists only because trigger output is not normalized, move that logic into the output classes or trigger layer rather than duplicating it in callers.
6. Keep the public hook JSON shape aligned with LLxprt’s existing hook API; do not rename events or switch to upstream-only field names if LLxprt already exposes accepted semantics.
7. Update trigger tests to assert the normalized output objects still carry the expected fields and helper behavior.
8. Update runtime tests in `client.test.ts` to cover the exact LLxprt lifecycle semantics after normalization, especially:
   - BeforeAgent block/stop behavior.
   - BeforeAgent prompt augmentation/additional context.
   - AfterAgent continuation or stop handling as LLxprt currently intends.
9. Keep the scope limited to lifecycle hook output semantics. Do not broaden into model-hook or tool-hook changes.

## Verification

Batch B45 requires QUICK verification:

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/core/src/core/lifecycleHookTriggers.test.ts
npm run test -- --reporter=verbose packages/core/src/core/client.test.ts
```

## Execution Notes/Risks

- The most important constraint is to integrate with **existing LLxprt hook output semantics**, not blindly mirror upstream internals.
- `client.ts` already contains LLxprt-specific BeforeAgent / AfterAgent logic. Preserve observable behavior unless the playbook’s refactor clearly requires normalization with no user-facing regression.
- Avoid changing generic hook output behavior for unrelated events.
- Avoid introducing `/agents`, `AgentRegistry`, or any upstream agent architecture.
- Be careful with `AfterAgent` semantics: LLxprt already appears to intentionally treat some blocking/stop conditions as continuation control, so review tests before changing anything.
- If you must choose between upstream structure and current LLxprt behavior, preserve LLxprt behavior and document the divergence in code/test naming rather than changing architecture.
