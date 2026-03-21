# Playbook: Properly Use systemMessage for Hooks in UI

**Upstream SHA:** `c7d17dda49d`
**Upstream Subject:** fix: properly use systemMessage for hooks in UI (#16250)
**Upstream Stats:** hooks/UI behavior fix; moderate LLxprt adaptation

## What Upstream Does

Upstream fixes hook-driven UI messaging so `systemMessage` emitted by model-hook outcomes is actually surfaced to the user in the right cases instead of being dropped or overshadowed by stop/block behavior. The upstream flow is tied to its own trigger and hook result wiring, where hook outcomes can continue, stop, or block execution and also emit an informational system message.

## Why REIMPLEMENT in LLxprt

1. LLxprt already has hook output semantics for `systemMessage`, `stopReason`, and blocking decisions in the hook type layer.
2. LLxprt's current implementation already checks model-hook results in core execution paths, but the exact user-visible handling must be adapted to LLxprt's current hook/event model rather than copied from upstream trigger flow.
3. `packages/core/src/core/geminiChat.ts` already awaits `triggerBeforeModelHook()` and `triggerAfterModelHook()` and already acts on blocking/synthetic response and response mutation.
4. LLxprt's hook/event architecture has its own `HookSystem`, `HookEventHandler`, aggregator semantics, and output classes. This batch should preserve that architecture.
5. The missing work is ensuring UI-visible/system-visible hook messages are preserved coherently for LLxprt's model execution flow, especially when a hook both communicates a message and affects stop/block decisions.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/core/geminiChat.ts` — current before/after model hook integration points
- [OK] `packages/core/src/core/geminiChatHookTriggers.ts` — typed hook trigger wrappers already return hook outputs
- [OK] `packages/core/src/hooks/types.ts` — includes `systemMessage`, `stopReason`, `shouldStopExecution()`, `isBlockingDecision()`, and effective-reason helpers
- [OK] `packages/core/src/hooks/hookEventHandler.ts` — common hook output processing already extracts `systemMessage` / stop semantics
- [OK] `packages/core/src/hooks/hookAggregator.ts` — aggregation logic already carries `systemMessage`
- [OK] `packages/core/src/hooks/hooks-caller-application.test.ts` — contains characterization coverage around model/tool hook callers
- [OK] `packages/core/src/core/geminiChat.issue1729.test.ts` and other nearby core tests — possible place for focused regression coverage if needed

**Probably not required for this batch:**
- `packages/cli/src/ui/hooks/useGeminiStream.ts` for the main behavior change, because LLxprt's model-hook decisions already happen inside core `geminiChat.ts`; verify before touching UI.

## Files to Modify/Create

### Modify: `packages/core/src/core/geminiChat.ts`
- Preserve and correctly surface `systemMessage` when before/after model hooks return it.
- Ensure stop/block handling and user-visible text follow LLxprt's current hook output semantics.
- Keep synthetic response support, response mutation, and existing provider-neutral execution flow intact.

### Modify: `packages/core/src/hooks/hooks-caller-application.test.ts`
- Add or unskip caller-level tests that prove `systemMessage` is used correctly in LLxprt's actual model-call path.
- Cover interactions between `systemMessage` and stop/block decisions.

### Modify: other existing core tests only if required by local coverage patterns
- Prefer extending existing hook/model tests over creating brand-new parallel test suites.

**No new architecture files are expected for this batch.**

## Preflight Checks

```bash
# Inspect current BeforeModel / AfterModel hook handling in geminiChat
sed -n '1428,1565p' packages/core/src/core/geminiChat.ts

# Inspect hook output semantics
sed -n '135,420p' packages/core/src/hooks/types.ts

# Inspect existing characterization tests around hook callers
sed -n '430,720p' packages/core/src/hooks/hooks-caller-application.test.ts

# Inspect trigger wrappers
sed -n '1,180p' packages/core/src/core/geminiChatHookTriggers.ts
```

## Implementation Steps

1. **Read current model-hook handling in `packages/core/src/core/geminiChat.ts`.**
   - Confirm how `BeforeModel` results are used before provider invocation.
   - Confirm how `AfterModel` results are used after the provider response is converted.
   - Identify where `systemMessage` is currently ignored, replaced, or only partially surfaced.

2. **Read LLxprt hook semantics in `packages/core/src/hooks/types.ts` and related hook processing files.**
   - Respect existing helpers like `getEffectiveReason()`, `shouldStopExecution()`, `isBlockingDecision()`, and any synthetic-response helpers.
   - Adapt to LLxprt's event/result model instead of mirroring upstream's trigger-flow assumptions.

3. **Implement the behavior in `geminiChat.ts` using LLxprt-native semantics.**
   - For `BeforeModel`:
     - if blocked, preserve any hook `systemMessage` in the user-visible/system-visible output path while still honoring the block decision;
     - if stopped, preserve the message semantics and stop reason coherently;
     - if continuing, ensure `systemMessage` is not silently lost.
   - For `AfterModel`:
     - preserve `systemMessage` alongside any modified response;
     - if stop semantics apply after the response, ensure the stop signal and message are both represented according to LLxprt behavior.
   - Use existing LLxprt response/content structures rather than inventing a separate UI event type.

4. **Prefer core-level response shaping over UI-hook rewiring unless inspection proves otherwise.**
   - LLxprt already executes these decisions in core model flow, so a focused core fix is more architecture-consistent than copying upstream UI trigger handling into `useGeminiStream.ts`.
   - Only touch `useGeminiStream.ts` if you confirm the message can only be surfaced there.

5. **Add caller-level regression tests.**
   - A `BeforeModel` hook that returns only `systemMessage` should surface it without breaking the normal response flow.
   - A `BeforeModel` hook that blocks with a reason and a `systemMessage` should surface the right combined user-visible result according to LLxprt conventions.
   - An `AfterModel` hook that appends a `systemMessage` should preserve the model response and include the hook message.
   - An `AfterModel` hook that stops execution with a `stopReason` and `systemMessage` should keep LLxprt's stop semantics coherent.

6. **Run verification.**
   - At minimum: `npm run lint`, `npm run typecheck`
   - Prefer targeted hook/core tests covering the actual caller path

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/core/src/hooks/hooks-caller-application.test.ts
# Run any focused geminiChat/core hook regression tests touched by the implementation.
```

## Execution Notes/Risks

- **Key repo fact:** LLxprt already has hook output semantics around `systemMessage`, `stopReason`, and blocking decisions. The adaptation should use those semantics rather than importing upstream assumptions.
- **Key repo fact:** `extension.ts returns resolvedSettings` and `settingsIntegration.ts merges user then workspace` are unrelated to this batch; do not mix concerns from other reimplementations.
- **Risk:** `geminiChat.ts` is a central execution path. Keep changes surgical and provider-neutral.
- **Risk:** there can be subtle precedence questions when both `systemMessage` and block/stop reasons are present. Use current LLxprt helper semantics and existing characterization tests as the source of truth.
- **Risk:** if surfaced via response text/content, avoid duplicating the same hook message multiple times across synthetic responses, finish messages, or later UI layers.
- **Do not** replace LLxprt's `HookSystem`, hook aggregator, or output classes.
- **Do not** reimplement upstream trigger flow verbatim.
- **Do not** broaden scope into unrelated hook command/UI refactors in this batch.
