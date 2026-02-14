# Issue #915 — Tool Execution Path Unification

**Companion**: [overview.md](./overview.md), [technical-overview.md](./technical-overview.md) §9
**Status**: Draft

This document analyzes the three divergent tool execution paths and specifies the required unified behavior.

---

## 1) The Three Paths Today

### 1.1 Interactive CLI (`useGeminiStream.ts`)

```
Model returns tool calls via stream
  → GeminiChat.recordHistory() writes AI response (with tool_call blocks) to HistoryService
  → CoreToolScheduler.schedule(allToolCalls) — one scheduler per session
  → Tools execute in parallel (batched, buffered ordering)
  → onAllToolCallsComplete callback fires
  → handleCompletedTools():
      - filters: keeps functionResponse parts only (functionCall already in history)
      - sends filtered parts via submitQuery(responseParts, {isContinuation: true})
      - EXCEPT cancellation paths: manually splits functionCall/functionResponse
        and calls geminiClient.addHistory() — 4 ad-hoc write sites (lines 1446, 1454, 1596, 1603)
  → GeminiChat.sendMessageStream() — next round-trip
```

**Scheduler lifetime**: Session-scoped (created once, reused across turns).
**Parallelism**: Full — all tool calls from a model turn scheduled as one batch.
**Filtering**: Explicit (functionResponse only), except cancellation paths which do manual splitting.
**History writes**: Mixed — normal path through sendMessageStream, cancellation through manual addHistory.

### 1.2 Non-interactive CLI (`nonInteractiveCli.ts`)

```
Model returns tool calls via stream events (GeminiEventType.ToolCallRequest)
  → GeminiChat internally records history via recordHistory()
  → Tool calls collected into functionCalls[] array
  → For each tool call (sequential):
      const completed = await executeToolCall(config, requestInfo, signal)
        → internally: creates throwaway CoreToolScheduler, runs one tool, disposes scheduler
      toolResponseParts.push(...completed.response.responseParts)  // NO FILTERING
  → currentMessages = toolResponseParts
  → geminiClient.sendMessageStream(currentMessages) — next round-trip
```

**Scheduler lifetime**: Per-tool throwaway (created and destroyed for each individual tool call).
**Parallelism**: None — strictly sequential, one tool at a time.
**Filtering**: None — all responseParts pushed unfiltered.
**History writes**: Implicit only (through sendMessageStream).

### 1.3 Subagent non-interactive (`subagent.ts` `processFunctionCalls`)

```
Model returns tool calls (collected as FunctionCall[])
  → For each tool call (sequential):
      const completed = await executeToolCall(schedulerConfig, requestInfo, signal)
        → same throwaway scheduler pattern
      for (const part of completed.response.responseParts):
          if ('functionCall' in part) continue   // ← FILTERS functionCall parts
          toolResponseParts.push(part)
  → return [{role: 'user', parts: toolResponseParts}]
  → fed back to GeminiChat.sendMessageStream() — next round-trip
```

**Scheduler lifetime**: Per-tool throwaway (same as non-interactive CLI).
**Parallelism**: None — strictly sequential.
**Filtering**: Explicit — filters out functionCall parts (Issue #244 comment).
**History writes**: Implicit only (through sendMessageStream).

### 1.4 Subagent interactive (`subagent.ts` `runInteractive`)

This is essentially the correct pattern already:

```
CoreToolScheduler created per session (via getOrCreateScheduler)
  → handleCompletion callback resolves a promise
  → scheduler.schedule(allToolCalls) — full batch
  → Tools execute in parallel
  → completionPromise resolves with CompletedToolCall[]
  → buildPartsFromCompletedCalls():
      for each completed call:
          for (const part of call.response.responseParts):
              if ('functionCall' in part) continue  // ← FILTERS
              aggregate.push(part)
  → aggregate sent back to GeminiChat
```

**Scheduler lifetime**: Session-scoped.
**Parallelism**: Full — batched.
**Filtering**: Explicit.
**History writes**: Implicit through GeminiChat.

---

## 2) Side-by-Side Comparison

| Aspect | Interactive CLI | Non-interactive CLI | Subagent non-interactive | Subagent interactive |
|--------|----------------|--------------------|--------------------------|-----------------------|
| **Scheduler lifetime** | Session-scoped | Per-tool throwaway | Per-tool throwaway | Session-scoped |
| **Parallel execution** | [OK] Batched | [ERROR] Sequential | [ERROR] Sequential | [OK] Batched |
| **functionCall filtering** | [OK] (normal path) | [ERROR] **Missing** | [OK] (Issue #244) | [OK] |
| **Cancellation handling** | Ad-hoc manual history writes | Whole-session abort only | Whole-session abort only | Promise-based |
| **History write mechanism** | Mixed (implicit + 4 manual sites) | Implicit only | Implicit only | Implicit only |
| **Model interaction** | GeminiChat | GeminiChat | GeminiChat | GeminiChat |

---

## 3) Specific Defects in Current Divergence

### 3.1 Missing functionCall filtering in non-interactive CLI

`nonInteractiveCli.ts` line 503-505:
```typescript
if (toolResponse.responseParts) {
    toolResponseParts.push(...toolResponse.responseParts);
}
```

Compare to `subagent.ts` line 1435-1441:
```typescript
for (const part of toolResponse.responseParts) {
    if ('functionCall' in part) {
        continue;  // Issue #244
    }
    toolResponseParts.push(part);
}
```

Today this doesn't cause visible failures because `CoreToolScheduler` currently only emits `functionResponse` parts in `responseParts` (confirmed at lines 355, 682, 1621, 1992 — all annotated "Only functionResponse — the functionCall is already in history"). But this is an undocumented, unenforced invariant. The non-interactive CLI depends on it by accident; the subagent defends against it explicitly.

### 3.2 Wasted scheduler creation

`executeToolCall()` (in `nonInteractiveToolExecutor.ts`) creates a fresh `CoreToolScheduler` per call:
```
5 tool calls → 5 scheduler instances created and destroyed
```

`CoreToolScheduler` constructor sets up policy engine, logging, callback wiring, and internal state tracking. This is wasted work when the caller could batch all 5 calls on one scheduler.

### 3.3 Lost parallelism

If the model returns 5 independent tool calls (e.g., 5 file reads), the interactive CLI executes them in parallel. The non-interactive CLI executes them sequentially. For I/O-bound tools this can be a significant latency penalty.

### 3.4 Bug fix application inconsistency

Issue #244 (functionCall duplication causing Anthropic orphan tool_use blocks) was fixed in the subagent path but not in the non-interactive CLI path. This is not an isolated incident — it's a structural maintenance problem. Any future invariant enforcement (e.g., from #915's write boundary) must be applied to N paths instead of 1.

---

## 4) Required Unified Behavior

### 4.1 Single execution pattern

All modes must:
1. Use a **session-scoped** `CoreToolScheduler` (one per interactive session, one per subagent session, one per non-interactive CLI invocation).
2. Schedule all tool calls from a model turn as a **single batch** (enabling parallel execution).
3. Await batch completion via **promise** (not per-tool sequential await).
4. Apply **identical result filtering** (exclude `functionCall` parts from parts fed back to GeminiChat).
5. Feed filtered results back through `GeminiChat.sendMessageStream()` — not through manual `addHistory()` calls.

### 4.2 Cancellation through scheduler, not ad-hoc writes

The interactive CLI's 4 manual `addHistory()` sites in cancellation paths (`useGeminiStream.ts` lines 1446, 1454, 1596, 1603) must be eliminated. Cancellation must flow through `CoreToolScheduler`'s lifecycle:
- Scheduler records terminal state (cancelled/interrupted).
- Scheduler emits `responseParts` with synthetic cancellation responses (already does this).
- Caller sends these through normal `sendMessageStream()` path.
- History writes happen through GeminiChat's standard `recordHistory()`.

### 4.3 executeToolCall() scope

`executeToolCall()` remains available as a low-level utility for genuinely single-shot tool execution (e.g., `agents/executor.ts` where there is no turn loop). But turn loops (non-interactive CLI, subagent non-interactive) must not use it as a per-call wrapper.

---

## 5) Impact on #915

The tool execution path unification is a prerequisite for clean #915 delivery because:

1. **Single write boundary**: A validated `HistoryService.add()` boundary requires all tool result paths to feed through the same contract. Three divergent paths means three integration points that must independently maintain the contract.

2. **Ledger/index population**: If tool lifecycle state is tracked (whether as a parallel ledger or computed index), the `CoreToolScheduler` is the natural single writer. Per-tool throwaway schedulers would each maintain their own isolated state, losing cross-call context (e.g., "5 tools were scheduled, 3 completed, 2 were cancelled").

3. **Transcript builder input**: The transcript builder needs to know the lifecycle state of all tool calls in a turn. A session-scoped scheduler has this; 5 throwaway schedulers each know about 1 call.

4. **Cancellation correctness**: The 4 ad-hoc history write sites in `useGeminiStream.ts` are the primary corruption source identified in #915. Eliminating them by routing cancellation through the scheduler's normal path directly addresses the root cause.

---

## 6) Affected Code Locations

| File | Current pattern | Required change |
|------|----------------|-----------------|
| `packages/cli/src/nonInteractiveCli.ts` (line ~410-510) | Sequential `executeToolCall()` loop, no filtering | Batch schedule on session-scoped scheduler, filter results, await batch |
| `packages/core/src/core/subagent.ts` `processFunctionCalls` (line ~1340-1450) | Sequential `executeToolCall()` loop, with filtering | Batch schedule on session-scoped scheduler, reuse existing filtering |
| `packages/cli/src/ui/hooks/useGeminiStream.ts` (lines 1446, 1454, 1596, 1603) | Manual `addHistory()` in cancellation paths | Eliminate: route through scheduler → normal sendMessageStream path |
| `packages/core/src/core/nonInteractiveToolExecutor.ts` | `executeToolCall()` function | No change needed — remains as single-shot utility, but callers in turn loops stop using it |
| `packages/core/src/core/subagent.ts` `runInteractive` | Already correct pattern (session-scoped scheduler, batch, filter) | Reference implementation — other paths should converge toward this |
