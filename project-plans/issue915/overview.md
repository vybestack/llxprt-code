# Issue #915 — Functional Specification

**Title**: Safe provider/model switching for tool-calling transcripts
**Issue**: #915
**Status**: Draft functional spec

This document is intentionally **functional-only**. It defines required behavior and outcomes, not implementation phases or task sequencing.

---

## 1) Problem Statement (Functional)

Provider/model switching at turn boundaries can produce hard API failures when the outbound transcript violates tool-calling protocol rules.

Common trigger conditions:
- User switches provider/model after an unsatisfactory model response.
- Load balancer round-robins to a different backend on the next turn.
- Automatic failover sends the next turn to a different provider family.
- Prior turns contain partial tool interactions (cancelled or incomplete fan-out).

The user-facing failure is an HTTP 400 from strict providers caused by malformed tool-call/tool-result structure.

---

## 2) Scope and Non-Goals

### In scope
- Turn-boundary transcript correctness across provider/model changes.
- Correct handling of mixed content turns (thinking + tool calls + tool results + text).
- Deterministic tool ID projection for providers with non-standard ID constraints (including Kimi and Mistral).
- Compression/summarization safety relative to tool interaction integrity.
- Unification of tool execution paths: all modes (interactive CLI, non-interactive CLI, subagent) must use the same tool execution and result-handling flow. See [tool-execution-unification.md](./tool-execution-unification.md).

### Out of scope
- Mid-stream rerouting while a model is still producing a response.
- New user commands or UI changes.
- Changes to how users trigger provider switches.

---

## 3) Required Functional Outcomes

1. **Given valid canonical interaction state, provider-facing transcript assembly must not emit tool adjacency/pairing violations** for strict providers.
2. **Round-robin/failover provider-family changes must preserve conversation continuity at turn boundaries.**
3. **Thinking blocks and tool blocks must coexist** without corrupting tool protocol rendering.
4. **For any emitted tool-call set, provider-facing transcripts must emit a protocol-valid completion set** (real completions when present; otherwise policy-defined synthetic cancellation/interruption completions).
5. **Tool IDs must remain canonical internally and be projected per provider format at egress** while preserving call/result pairing.
6. **All execution modes must use the same tool execution and result-handling path.** Interactive CLI, non-interactive CLI, and subagent must not have divergent tool-result processing, filtering, or history-write behavior.

---

## 4) Functional Invariants

For any outbound provider transcript (given valid canonical interaction state):

1. Every tool result must reference exactly one prior tool call.
2. Every tool call included in transcript must have a corresponding tool result in the transcript (real or synthetic cancellation/interruption completion per closure policy).
3. Tool results must appear in provider-valid placement (including strict adjacency where required).
4. Duplicate effective tool results for the same call must not be emitted in a way that breaks provider protocol.
5. Tool call/result ID pairing must remain stable after provider-specific ID translation.

### Closure policy for incomplete interactions

When emitted tool-call sets are incomplete, missing completions are represented as synthetic cancellation/interruption completions in provider-facing transcripts. This closure policy is required for strict-provider protocol validity.


---

## 5) Functional Before/After Picture (Requested Sequence)

### Input shape from a single assistant turn

User requested sequence:

`chat -> model -> [thinking] [tool_call] [tool_response] [thinking] [5x tool_calls] [1x tool_response] [thinking] [big streamed model text]`

Assume internal canonical call IDs:
- `C1 = hist_tool_1`
- `C2..C6 = hist_tool_2..hist_tool_6`

### Today (current observable functional behavior)

Internal history may contain:

- AI content: thinking + `tool_call(C1)`
- Tool content: `tool_response(C1)`
- AI content: thinking + `tool_call(C2..C6)`
- Tool content: `tool_response(C3)` only
- AI content: thinking + streamed text

At next turn boundary, provider-safe curation attempts to repair structure before send.

### Target functional behavior (post-#915)

For provider-facing transcript construction, that same turn resolves to a protocol-valid shape:

- `tool_call(C1)` paired with `tool_response(C1)` (real)
- `tool_call(C2..C6)` paired with:
  - `tool_response(C3)` (real)
  - `tool_response(C2,C4,C5,C6)` as interruption/cancellation completions when no real result exists and completion policy requires closure

Thinking blocks remain available according to reasoning/context policy, without breaking call/result protocol.

The user still sees coherent conversation output; provider receives a structurally valid transcript.

---

## 6) Turn-Boundary Switching Semantics

Switching is functionally defined at **next request assembly time**, never mid-stream:

- Previous turn already ended (normal completion or cancellation).
- New provider/model is selected for the next turn.
- Transcript assembly must render provider-valid call/result structure from canonical conversation state.
- Any in-flight assistant generation and associated tool execution remain bound to the provider selected for that in-flight turn until completion or cancellation is finalized.

This applies equally to:
- Manual provider/model switch.
- Load balancer round-robin selection.
- Failover selection after provider error conditions.

---

## 7) Tool ID Functional Requirements (including Kimi/Mistral)

### Canonical internal identity
- Internal tool interaction identity is provider-neutral and stable across turns.
- Canonical IDs are preserved in conversation state independent of provider.

### Provider egress projection
At provider send time, IDs are projected to provider-required format while preserving pairing:

- **OpenAI-style**: `call_*`
- **Anthropic-style**: `toolu_*`
- **Kimi format**: `functions.{toolName}:{globalIndex}`
- **Mistral format**: exactly 9 alphanumeric characters

### Required behavior
1. For a given transcript, each tool call/result pair maps to matching projected IDs.
2. Projection must be deterministic and collision-free within transcript scope (one canonical call identity maps to exactly one provider ID; distinct canonical call identities map to distinct provider IDs in that render).
3. Provider-required constraints (format/length/character set/extra fields) must be satisfied without changing logical call/result pairing.

---

## 8) Thinking + Tools Functional Contract

Thinking content is first-class conversation content, but it must not invalidate tool protocol.

Required behavior:
- Thinking blocks may appear before/after tool blocks in assistant content.
- Thinking inclusion/exclusion in provider context follows reasoning policy.
- Tool call/result pairing and adjacency rules are enforced independently of whether thinking is included.

---

## 9) Compression and Summarization Functional Contract

Compression/summarization must preserve tool interaction integrity for future provider sends.

Required behavior:
- Compression cannot leave orphan tool calls/results in provider-facing transcript assembly.
- If compression removes one side of a pair from retained conversational text, transcript assembly must still produce a provider-valid paired representation (real or policy-appropriate synthetic completion).

---

## 10) Acceptance Criteria (Functional)

1. **Manual switch scenario**
   - Given a completed prior turn with tool interactions,
   - when user switches to another provider family,
   - the next request succeeds without tool protocol 400s.

2. **Round-robin scenario**
   - Given alternating providers across turns,
   - tool interactions remain valid and no duplicate/out-of-order protocol failures occur.

3. **Failover scenario**
   - Given failover to a different provider family after retry/failure handling,
   - next-turn transcript remains protocol-valid.

4. **Incomplete fan-out scenario**
   - Given 5 tool calls where only 1 real tool result exists,
   - outbound transcript is rendered as a complete, provider-valid interaction set using policy-defined synthetic completion for missing results.

5. **Kimi and Mistral ID scenario**
   - Given canonical internal tool IDs,
   - outbound IDs satisfy each provider's required format while preserving exact call/result pairing.

6. **Execution path unification scenario**
   - Given the same model turn producing 5 tool calls,
   - interactive CLI, non-interactive CLI, and subagent all:
     - execute tools through the same scheduler-based batch pattern,
     - apply identical result filtering,
     - feed results back through GeminiChat without ad-hoc manual history writes.

---

## 11) User Impact Summary

User-visible change:
- Fewer hard provider errors when switching models/providers after tool-heavy turns.
- More reliable continuity when round-robin/failover changes backend provider family.

Non-change:
- No new user workflow is required.
- No expectation of mid-stream provider redirection.
