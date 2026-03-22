# Playbook: Support Explicit Stop and Block Execution Control in Model Hooks

**Upstream SHA:** `e1e3efc9d04`  
**Upstream Subject:** feat(hooks): Support explicit stop and block execution control in model hooks (#15947)  
**Upstream Stats:** 7 files, ~517 insertions / ~65 deletions

## What Upstream Does

Upstream introduces first-class model-hook execution control and propagates it through the stream pipeline:

1. Adds two explicit stream control events:
   - `agent_execution_stopped`
   - `agent_execution_blocked`
2. Uses dedicated errors in `geminiChat.ts` to carry stop/block state from hook-processing points to `sendMessageStream()` catch handling.
3. In `turn.ts`, maps those stream events to top-level Gemini events and handles them distinctly:
   - stopped → yield event and terminate turn
   - blocked → yield event and continue loop so any follow-up chunk can be processed
4. Removes synthetic stop-response generation from `AfterModelHookOutput.getModifiedResponse()` in `hooks/types.ts`; stop is no longer represented as fake model text.
5. Adds targeted tests in:
   - `geminiChatHookTriggers.test.ts`
   - `geminiChat.test.ts`
   - `hooks/types.test.ts`

## LLxprt Reimplementation Strategy (Deliberate Divergence)

LLxprt keeps its existing HookSystem architecture:
- `triggerBeforeModelHook()` / `triggerAfterModelHook()` return typed classes (`BeforeModelHookOutput` / `AfterModelHookOutput`), not upstream plain result structs.
- Stop/block semantics are queried via methods (`shouldStopExecution()`, `isBlockingDecision()`, `getEffectiveReason()`, etc.), not direct fields.

This playbook preserves that architecture and ports upstream behavior at the caller/event-flow layer.

### Active path vs secondary path

- **Primary path (must match upstream intent):**
  `sendMessageStream()` → `makeApiCallAndProcessStream()` → `turn.ts` → `useGeminiStream.ts`
- **Secondary path (non-turn direct calls):**
  `generateDirectMessage()` (used by `client.generateDirectMessage()`, e.g. `autoPromptGenerator.ts`)

This batch focuses on the primary turn path first; direct-path adjustments are minimal and local.

## LLxprt File Existence Map

**Present (verified):**
- `packages/core/src/hooks/types.ts` (contains synthetic stop-response hack in `AfterModelHookOutput.getModifiedResponse()`)
- `packages/core/src/core/geminiChat.ts` (`StreamEventType` currently only `CHUNK` and `RETRY`)
- `packages/core/src/core/geminiChatHookTriggers.ts` (typed trigger wrappers already in place)
- `packages/core/src/core/turn.ts` (no AgentExecutionStopped/Blocked event mapping yet)
- `packages/cli/src/ui/hooks/useGeminiStream.ts` (no handling for new stop/block events yet)
- `packages/core/src/core/turn.test.ts` (existing event-mapping tests; best fit for turn mapping coverage)
- `packages/core/src/core/geminiChat.runtime.test.ts` and other focused `geminiChat.*.test.ts` files (existing test topology)
- `packages/core/src/hooks/types.test.ts` (currently minimal; can be extended)

**Not present yet (to create):**
- `packages/core/src/core/geminiChatHookTriggers.test.ts`
- `packages/core/src/core/geminiChat.hook-control.test.ts` (LLxprt-focused stream stop/block propagation tests)

## Files to Modify

### 1) `packages/core/src/hooks/types.ts`

**Required change (exact):** remove synthetic stop-response generation from `AfterModelHookOutput.getModifiedResponse()`.

Delete the `if (this.shouldStopExecution()) { ... synthetic STOP response ... }` block.

Post-change behavior:
- If `hookSpecificOutput.llm_response` exists, return translated modified response.
- Otherwise return `undefined`.

This aligns with upstream intent: stop is control flow, not fake content.

---

### 2) `packages/core/src/core/geminiChat.ts`

#### 2a. Add new stream event variants

Extend `StreamEventType` with:
- `AGENT_EXECUTION_STOPPED`
- `AGENT_EXECUTION_BLOCKED`

Extend `StreamEvent` union with reason-bearing variants:
- `{ type: AGENT_EXECUTION_STOPPED; reason: string }`
- `{ type: AGENT_EXECUTION_BLOCKED; reason: string }`

#### 2b. Add control-flow errors

Add:
- `AgentExecutionStoppedError` (reason)
- `AgentExecutionBlockedError` (reason + optional syntheticResponse)

Place near existing stream-related errors (`InvalidStreamError`, `EmptyStreamError`).

#### 2c. Wire BeforeModel into **streaming** path (primary gap)

In `makeApiCallAndProcessStream()` (inside the `apiCall` flow, before provider call), use `triggerBeforeModelHook()` and apply this exact order:
1. `shouldStopExecution()` → throw `AgentExecutionStoppedError`
2. `isBlockingDecision()` → throw `AgentExecutionBlockedError` (include synthetic response if any)
3. apply request modifications via `applyLLMRequestModifications()`

If synthetic response is present, ensure candidates have `finishReason` (set `STOP` when missing) before attaching to blocked error, to avoid downstream invalid-stream handling.

#### 2d. Wire AfterModel into streaming path at one exact location

**Placement decision (explicit):** apply AfterModel per streamed provider chunk inside the generator created in `makeApiCallAndProcessStream()` (`for await (const iContent of streamResponse)`), before yielding converted chunk.

Per chunk:
1. call `triggerAfterModelHook(configForHooks, iContent)`
2. if `shouldStopExecution()` → throw `AgentExecutionStoppedError`
3. if `isBlockingDecision()` → throw `AgentExecutionBlockedError` with synthetic response equal to:
   - `afterModelResult.getModifiedResponse()` when present, else
   - current converted chunk (preserve already-produced response semantics)
4. else if `getModifiedResponse()` exists, yield modified response
5. else yield converted chunk as-is

This removes ambiguity and keeps stop/block semantics in the same stream-control pipeline as upstream.

#### 2e. Handle stop/block in `sendMessageStream()` catch block

Before invalid-stream retry checks:
- `AgentExecutionStoppedError`:
  - yield `{ type: AGENT_EXECUTION_STOPPED, reason }`
  - clear `lastError`
  - `return`
- `AgentExecutionBlockedError`:
  - yield `{ type: AGENT_EXECUTION_BLOCKED, reason }`
  - if synthetic response exists, yield follow-up `CHUNK`
  - clear `lastError`
  - `return`

#### 2f. Direct path (`generateDirectMessage`) — minimal safety updates only

Do **not** add turn/event plumbing to direct path.

Add only local stop handling so behavior does not regress when synthetic stop hack is removed:
- BeforeModel: check `shouldStopExecution()` before block checks; throw `AgentExecutionStoppedError`.
- AfterModel: check `shouldStopExecution()` before modified-response application; throw `AgentExecutionStoppedError`.

Keep existing direct-path block/synthetic handling pattern otherwise.

---

### 3) `packages/core/src/core/turn.ts`

Add new `GeminiEventType` entries:
- `AgentExecutionStopped = 'agent_execution_stopped'`
- `AgentExecutionBlocked = 'agent_execution_blocked'`

Add corresponding event type aliases and include them in `ServerGeminiStreamEvent` union.

In `Turn.run()` stream loop, handle before `const resp = streamEvent.value`:
- stopped event → yield mapped event with reason, then `return`
- blocked event → yield mapped event with reason, then `continue`

This mirrors upstream control-flow semantics while staying LLxprt-native.

---

### 4) `packages/cli/src/ui/hooks/useGeminiStream.ts`

Add explicit handling for:
- `ServerGeminiEventType.AgentExecutionStopped`
- `ServerGeminiEventType.AgentExecutionBlocked`

**Decision (explicit, non-silent):** surface reason to user via `addItem({ type: MessageType.INFO, text: ... })`.

Suggested text:
- stopped: `Execution stopped by hook: <reason>`
- blocked: `Execution blocked by hook: <reason>`

Do not end stream loop manually here; rely on core/turn semantics.

---

### 5) `packages/core/src/core/geminiChatHookTriggers.ts`

No signature or return-shape change planned.

Keep typed wrappers (`BeforeModelHookOutput` / `AfterModelHookOutput`) as-is.

Validation is test-driven via new trigger tests (below). If tests reveal mismatch in method-surface behavior from `result.finalOutput`, apply minimal fixes in this file only.

## Tests

### A. Create `packages/core/src/core/geminiChatHookTriggers.test.ts`

Primary goals:
- verify typed output wrappers preserve stop/block semantics from aggregated hook output
- verify non-blocking failure behavior (returns `undefined` on hook errors)

Cases:
- BeforeModel: stop, block, synthetic response passthrough, no-op
- AfterModel: stop, block, modified response passthrough, no-op
- disabled hooks / missing hook system / thrown hook errors

### B. Create `packages/core/src/core/geminiChat.hook-control.test.ts`

Focused stream-control tests for `GeminiChat.sendMessageStream()`:
- before-model stop → emits stopped event and terminates
- before-model block with synthetic response → blocked event then chunk
- after-model stop → emits stopped event
- after-model block → blocked event then follow-up chunk
- stop/block do not enter retry loop

Use existing `GeminiChat` test setup patterns from `geminiChat.runtime.test.ts` and other `geminiChat.*.test.ts` files.

### C. Extend `packages/core/src/core/turn.test.ts`

Add mapping tests:
- stream `AGENT_EXECUTION_STOPPED` → `GeminiEventType.AgentExecutionStopped`, then end
- stream `AGENT_EXECUTION_BLOCKED` + subsequent chunk → blocked event then content event

### D. Extend `packages/core/src/hooks/types.test.ts`

Add assertions for `AfterModelHookOutput.getModifiedResponse()`:
- returns `undefined` when stop is requested and no `llm_response`
- still returns translated modified response when `llm_response` exists

### E. Extend `packages/cli/src/ui/hooks/useGeminiStream.test.tsx`

Add UI behavior tests:
- stopped event adds info message with reason
- blocked event adds info message with reason and does not crash/prematurely abort processing

## Preflight Checks

```bash
# Current stream event coverage
grep -n "enum StreamEventType" packages/core/src/core/geminiChat.ts
grep -n "StreamEventType.RETRY" packages/core/src/core/turn.ts

# Current model-hook trigger call sites in geminiChat
grep -n "triggerBeforeModelHook\|triggerAfterModelHook" packages/core/src/core/geminiChat.ts

# Confirm synthetic stop-response hack exists before edit
grep -n "shouldStopExecution\|synthetic stop response" packages/core/src/hooks/types.ts

# Confirm turn currently has no stopped/blocked event types
grep -n "AgentExecutionStopped\|AgentExecutionBlocked" packages/core/src/core/turn.ts

# Confirm UI currently has no stopped/blocked cases
grep -n "AgentExecutionStopped\|AgentExecutionBlocked" packages/cli/src/ui/hooks/useGeminiStream.ts

# Confirm direct-message call sites (secondary path)
grep -R -n "generateDirectMessage(" packages/cli/src/ui packages/core/src/core
```

## Implementation Steps

1. Edit `hooks/types.ts` to remove synthetic stop-response block from `AfterModelHookOutput.getModifiedResponse()`.
2. Add new stream event variants + error classes in `geminiChat.ts`.
3. Add BeforeModel hook handling to streaming `apiCall` path in `makeApiCallAndProcessStream()`.
4. Add AfterModel hook handling per streamed provider chunk in `makeApiCallAndProcessStream()` generator.
5. Update `sendMessageStream()` catch handling for stop/block errors.
6. Add minimal stop checks in `generateDirectMessage()` (no turn/event plumbing).
7. Update `turn.ts` enum + union + `Turn.run()` mapping logic for new stream events.
8. Update `useGeminiStream.ts` switch to handle stopped/blocked events with explicit info messages.
9. Add/extend tests (A–E above).
10. Run verification suite.

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Most important non-negotiable:** "hooks" here means LLxprt HookSystem events and outputs, not React hooks.
- Keep LLxprt typed hook-output architecture; do not introduce upstream plain trigger-result interfaces.
- Keep changes scoped to model-hook execution control. Do not mix in unrelated `/agents` architecture work.
- Ensure blocked-path follow-up chunk behavior is preserved (`turn.ts` must `continue` on blocked event).
- Ensure new stream event variants are handled before any `streamEvent.value` access in `Turn.run()`.
- Keep direct-path changes minimal and local to avoid widening scope.

## Relationship to Other Playbooks

- `c7d17dda49d-plan.md` (hooks systemMessage behavior) is complementary but separate.
- `a6dca02344b-plan.md` (beforeAgent/afterAgent refactor) is separate hook family work.
