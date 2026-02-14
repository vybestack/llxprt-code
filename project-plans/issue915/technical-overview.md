# Issue #915 — Technical Specification

**Title**: Tool interaction integrity across provider/model switching
**Issue**: #915
**Companion**: [overview.md](./overview.md)
**Status**: Draft technical spec

This document is a **technical specification only**. It defines technical contracts, data semantics, and required behavior at component boundaries. It intentionally contains **no implementation plan**.

---

## 1) Existing Technical Context

### 1.1 Canonical content model

Conversation history is represented as `IContent[]` with block-level polymorphism:
- `text`
- `thinking`
- `tool_call`
- `tool_response`
- other media/code blocks

Primary type location:
- `packages/core/src/services/history/IContent.ts`

### 1.2 Request assembly boundary

Provider-facing transcript assembly is currently centralized at:
- `HistoryService.getCuratedForProvider(...)`
  - `splitToolCallsOutOfToolMessages(...)`
  - `ensureToolCallContinuity(...)`
  - `ensureToolResponseCompleteness(...)`
  - `ensureToolResponseAdjacency(...)` — note: this pass performs destructive reconstruction (strips all tool responses from original positions and re-inserts them adjacent to their calls), not simple reordering
  - `deepCloneWithoutCircularRefs(...)` — final serialization safety pass, required because tool call `parameters` can contain arbitrary objects with circular references

Primary location:
- `packages/core/src/services/history/HistoryService.ts`

### 1.3 Turn-boundary invocation point

Next-turn send paths construct request transcript via `getCuratedForProvider(...)` before provider invocation:
- `packages/core/src/core/geminiChat.ts` (primary path, including subagent instantiations via `GeminiChat`)

### 1.4 Provider egress translation

Providers translate canonical `IContent` into provider wire messages and provider-specific tool IDs:
- OpenAI/OpenAI-compatible: `OpenAIProvider.buildMessagesWithReasoning(...)`
- Anthropic: `AnthropicProvider` message construction with `tool_use/tool_result`
- OpenAI Vercel path: conversion utilities in `openai-vercel/messageConversion.ts`

---

## 2) Technical Problem Definition

Current architecture must satisfy strict provider tool protocol rules at request time, especially under provider-family changes between turns. Failures are caused when tool interactions become invalid in outbound transcript shape (orphaned calls/results, non-adjacent results, duplicates, mismatched IDs).

The technical requirement is not mid-stream reroute correctness; it is **deterministic, protocol-valid transcript rendering at turn boundary** from canonical conversation state.

A compounding issue is that the codebase currently has **three divergent tool execution paths** that process tool results differently, with inconsistent filtering, sequencing, and history integration. These divergent paths independently create or fail to prevent the invalid transcript states described above. See [tool-execution-unification.md](./tool-execution-unification.md) for detailed analysis.

### 2.1 In-flight binding invariant

Any in-flight assistant generation and associated tool execution remain bound to the provider selected for that in-flight turn until terminal turn state (completion or cancellation finalization). Provider changes only affect subsequent request assembly.


---

## 3) Protocol Constraints to Satisfy

### 3.1 Structural constraints

For outbound tool interactions:
1. Every emitted tool result references an emitted tool call.
2. Every emitted tool call has a corresponding emitted completion result (real or synthetic interruption/cancellation per policy).
3. Ordering respects provider protocol (strict adjacency where required).
4. No duplicate effective tool results break provider validation.

### 3.2 ID consistency constraints

Within a transcript render, ID projection must be injective (one-to-one) over canonical call identities and reference-consistent for results:
- `internal call identity` -> one `provider call identity`
- `internal result.callId identity` -> same `provider call identity` as its paired call
- distinct internal call identities in that render must not collide to the same provider call identity

### 3.3 Mixed-content compatibility

`thinking` blocks must coexist with `tool_call` and `tool_response` content without invalidating tool protocol rendering.

---

## 4) Canonical-to-Provider Architecture Contract

### 4.1 Three-layer contract

1. **Canonical conversation layer**
   - Source of semantic interaction truth.
   - Provider-neutral IDs (`hist_tool_*` canonical identity semantics).

2. **Provider transcript rendering layer**
   - Produces protocol-valid interaction sequence from canonical state.
   - Enforces pairing, adjacency, dedupe, ordering invariants.

3. **Provider wire translation layer**
   - Converts rendered canonical transcript to provider wire payload.
   - Applies provider-specific ID and message-shape projection.

### 4.2 Responsibility separation

- Transcript renderer enforces **interaction validity**.
- Provider adapter enforces **provider syntax/shape**.
- Provider adapters must not infer missing interaction semantics that belong to renderer.
- **Known current deviation:** The Anthropic provider adapter currently performs its own tool_use/tool_result adjacency enforcement, orphan synthesis, and deduplication (parallel to HistoryService repair passes). This dual-repair pattern is a recognized area for consolidation.

---

## 5) Tool Interaction State Semantics

### 5.1 Logical interaction model

Each tool interaction is defined by a canonical call identity and lifecycle state:
- pending
- complete
- cancellation/interruption-complete
- error

Required fields conceptually:
- canonical call id
- tool name
- arguments snapshot
- completion payload and/or error
- completion status marker

### 5.2 Completion status inference

`ToolResponseBlock.isComplete` is optional in the canonical model. Lifecycle state must therefore be inferred from a combination of `isComplete`, `error`, and whether `result` is non-null — not from any single field.

### 5.3 Idempotency semantics

For any canonical call identity:
- repeated writes of logically identical completion must not produce duplicate emitted completions.
- final emitted transcript contains at most one effective completion for strict protocol pairing.

### 5.4 Incomplete fan-out semantics

Given a turn with N tool calls and K<N real completions, renderer must still emit protocol-valid completion set where missing completions are represented by policy-compliant interruption/cancellation completions.

---

## 6) Provider-Specific Tool ID Technical Contract

### 6.1 Existing ID utilities and strategies

Current code already defines provider-specific ID projection behavior:
- Generic OpenAI normalization:
  - `packages/core/src/providers/utils/toolIdNormalization.ts`
- Format strategy selection and mapping:
  - `packages/core/src/tools/ToolIdStrategy.ts`

Detected/targeted formats include:
- openai (`call_*`)
- anthropic (`toolu_*` — currently handled by a private method in `AnthropicProvider`, not via the shared `ToolIdStrategy` framework)
- kimi (`functions.{name}:{index}`)
- mistral (strict 9-char alphanumeric)

### 6.2 Kimi technical requirements

Kimi tool IDs in OpenAI-compatible mode may require `functions.{toolName}:{globalIndex}` format. Mapping must be deterministic for all call/result references in the same transcript render.

### 6.3 Mistral technical requirements

Mistral tool IDs must satisfy strict lexical constraints:
- exactly 9 chars
- alphanumeric only

Additionally, message-shape rules differ (e.g., tool message name requirements in Mistral mode), but these remain provider-adapter responsibilities.

### 6.4 Required ID behavior

For any canonical call/result pair in a render:
- call and corresponding result reference must use the same projected provider ID.
- distinct canonical call identities in that render must not collide to the same provider ID.
- projection rules may differ by selected provider, but must remain deterministic for the selected provider on that turn.
- **Known edge case:** `normalizeToAnthropicToolId('')` currently uses `Date.now() + Math.random()` as a fallback for empty IDs, which violates determinism. Similarly, `normalizeToOpenAIToolId('')` produces the bare prefix `call_`, which could collide if multiple empty-ID calls exist. These degenerate cases must be addressed to satisfy the collision-free requirement.

---

## 7) Technical Rendering Semantics for Requested Sequence

Requested sequence:

`chat -> model -> [thinking] [tool_call] [tool_response] [thinking] [5x tool_calls] [tool_response] [thinking] [streamed text]`

Assume canonical IDs:
- `C1=hist_tool_1`
- `C2..C6=hist_tool_2..hist_tool_6`

### 7.1 Current boundary semantics (observed)

1. Model/tool runtime writes canonical history entries (mixed thinking/tool/text blocks).
2. At next turn send, `getCuratedForProvider(...)` applies repair passes over `IContent[]`.
3. Resulting canonical transcript is passed to selected provider adapter.
4. Adapter applies provider ID/message projection (OpenAI/Anthropic/Kimi/Mistral rules).

Potential risk point: interaction validity depends on successful repair inference from message blocks.

### 7.2 Required boundary semantics

1. Canonical interaction state contains complete lifecycle truth for calls/responses.
2. Transcript renderer builds provider-valid canonical transcript deterministically from canonical state.
3. Provider adapter projects IDs/messages for selected provider format.
4. Output is protocol-valid regardless of provider-family switch between turns.

### 7.3 Resulting rendered interaction shape (canonical)

Rendered canonical transcript for strict providers should be equivalent to:
- `tool_call(C1)` + `tool_response(C1)` real
- `tool_call(C2..C6)` + completion set:
  - real: `tool_response(C3)`
  - synthetic interruption/cancelled: `tool_response(C2,C4,C5,C6)`
- thinking/text inclusion per reasoning policy, without altering tool pairing validity

### 7.4 Provider projection example

From canonical render above:
- OpenAI: `C* -> call_*`
- Anthropic: `C* -> toolu_*`
- Kimi: `C* -> functions.{tool}:{index}`
- Mistral: `C* -> [A-Za-z0-9]{9}`

Call/result references must remain paired post-projection.

---

## 8) Compression/Context-Management Technical Contract

Compression or history reduction must not create invalid outbound tool interaction state.

Technical contract:
1. Compression may reduce textual/tool payload verbosity.
2. Compression must preserve sufficient canonical interaction information for provider-valid transcript rendering.
3. If one side of pair is omitted from textual history, renderer still has canonical interaction truth to emit valid pairing.

---

## 9) Tool Execution Path Unification

### 9.1 Current divergence

Three distinct tool execution patterns exist:

| Path | Scheduler lifetime | Parallelism | functionCall filtering | History writes |
|------|-------------------|-------------|----------------------|----------------|
| **Interactive CLI** (`useGeminiStream.ts`) | Long-lived, session-scoped | Parallel (batched) | Manual split into separate history entries | 4 ad-hoc manual writes in cancellation paths |
| **Non-interactive CLI** (`nonInteractiveCli.ts`) | Per-tool throwaway via `executeToolCall()` | Sequential (one tool at a time) | **None** — pushes all `responseParts` unfiltered | Implicit via `sendMessageStream` |
| **Subagent non-interactive** (`subagent.ts` `processFunctionCalls`) | Per-tool throwaway via `executeToolCall()` | Sequential (one tool at a time) | Explicit: filters out `functionCall` parts (Issue #244) | Implicit via `sendMessageStream` |

The subagent's `runInteractive()` path uses a fourth variation: long-lived `CoreToolScheduler` with promise-based await and proper filtering — essentially the correct pattern that the other non-interactive paths should adopt.

### 9.2 Problems caused by divergence

1. **Inconsistent `functionCall` filtering**: The non-interactive CLI does not filter `functionCall` parts from `responseParts`. Today this is masked because `CoreToolScheduler` only emits `functionResponse` parts, but the invariant is undocumented and unenforceable. The subagent defensively filters (with Issue #244 comment); the non-interactive CLI does not.

2. **Lost parallelism**: `executeToolCall()` creates a throwaway `CoreToolScheduler` per tool call, executing tools sequentially. For a model turn returning 5 tool calls, this means 5 serial executions instead of parallel batched execution.

3. **Maintenance hazard**: Bug fixes and invariant enforcement must be applied to three separate code paths. History shows fixes applied to some paths but not others (Issue #244 filtering present in subagent, absent in non-interactive CLI).

4. **Incompatible with single write boundary**: A validated `HistoryService.add()` boundary requires all tool result paths to feed through the same contract. Three divergent paths means three integration points to maintain.

### 9.3 Required unified behavior

All execution modes must:
- Use a single long-lived `CoreToolScheduler` per session (or per subagent session).
- Schedule all tool calls from a model turn as a batch (enabling parallel execution).
- Apply identical `functionCall` filtering on results before feeding back to `GeminiChat`.
- Write tool interaction state through the same boundary.
- Handle cancellation through the same scheduler lifecycle (not ad-hoc manual history writes).

The subagent `runInteractive()` pattern (long-lived scheduler, promise-based await, explicit filtering) demonstrates that this works without requiring the interactive CLI's callback-driven UI machinery.

### 9.4 Scope relationship

`executeToolCall()` may remain as a utility for genuinely single-tool-execution use cases (e.g., `agents/executor.ts`), but the non-interactive CLI turn loop and subagent non-interactive turn loop must not use it as a per-tool-call wrapper in a sequential loop. They should schedule full batches through a session-scoped scheduler.

---

## 10) Observability and Diagnostics Requirements

To diagnose protocol failures, renderer/provider boundary must emit structured diagnostics (at least in debug/error paths) containing:
- canonical call IDs seen
- emitted call IDs
- emitted result IDs
- dedupe decisions
- synthetic completion reasons
- provider format chosen

Diagnostics should allow distinguishing:
- canonical-state corruption
- renderer pairing/ordering fault
- provider projection fault

---

## 11) Compatibility and Behavioral Guarantees

1. No change to user-facing command workflow is required.
2. No requirement for mid-stream provider rerouting support.
3. Existing provider adapter specializations (including Kimi/Mistral constraints) remain first-class and preserved.
4. For turn-boundary provider changes (manual, round-robin, failover), outbound transcripts generated from valid canonical interaction state must satisfy provider tool-protocol constraints.

---

## 12) Acceptance Conditions (Technical)

A transcript render is technically acceptable iff:

1. Pairing invariant holds (1:1 call/result completeness per emitted call set).
2. Placement invariant holds for target provider protocol (including strict adjacency cases).
3. ID projection invariant holds for selected provider format, including Kimi/Mistral strict formats.
4. Dedup invariant holds (no duplicate effective completion that violates provider protocol).
5. Mixed thinking/tool/text transcript remains valid under reasoning inclusion policy.
6. Tool execution path invariant holds: all execution modes (interactive CLI, non-interactive CLI, subagent) use session-scoped batch scheduling, identical result filtering, and the same history write path — no ad-hoc manual history writes for tool results or cancellations.
