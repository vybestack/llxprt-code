# Issue #915 — Requirements Specification (EARS)

**Title**: Safe provider/model switching for tool-calling transcripts  
**Issue**: #915  
**Source Documents**:  
- `project-plans/issue915/overview.md`  
- `project-plans/issue915/technical-overview.md`  
- `project-plans/issue915/dataflow-before-after.md`  
- `project-plans/issue915/tool-execution-unification.md`  
**Notation**: Strict EARS (Ubiquitous, Event-Driven, State-Driven, Optional Feature, Unwanted Behavior)  
**Normative Language**: SHALL

---

## 1. Scope

This document defines atomic, testable functional and technical requirements for Issue #915 in strict EARS form. Requirements are grouped by domain and use IDs `REQ-915-###`.

---

## 2. Domain: Turn-Boundary Provider Switching

### REQ-915-001 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL assemble outbound provider transcripts at next-request turn boundaries using canonical conversation state.

### REQ-915-002 (State-Driven)
**Pattern**: State-Driven  
**When** a prior model turn is in-flight and not terminal, **the system SHALL** keep tool execution and generation bound to the currently selected provider for that in-flight turn.

### REQ-915-003 (Event-Driven)
**Pattern**: Event-Driven  
**When** a provider/model switch is selected after a turn reaches terminal state, **the system SHALL** apply the new provider/model to the next request assembly only.

### REQ-915-004 (Event-Driven)
**Pattern**: Event-Driven  
**When** provider-family selection changes due to manual switch, round-robin, or failover, **the system SHALL** preserve conversation continuity by producing a protocol-valid outbound transcript for the selected provider.

### REQ-915-005 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** transcript assembly would otherwise emit malformed tool interaction structure, **then the system SHALL** prevent send of malformed structure by rendering a provider-valid call/result structure before provider invocation.

---

## 3. Domain: Tool Call/Result Integrity

### REQ-915-006 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL ensure every emitted tool result references exactly one emitted prior tool call within the same outbound transcript render.

### REQ-915-007 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL ensure every emitted tool call has one corresponding emitted completion result in the outbound transcript, where completion is real or policy-defined synthetic interruption/cancellation.

### REQ-915-008 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL enforce provider-required tool result placement, including strict adjacency for providers that require adjacency.

### REQ-915-009 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** multiple effective tool results exist for the same canonical call identity during render, **then the system SHALL** emit at most one effective completion for that call in the outbound transcript.

### REQ-915-010 (State-Driven)
**Pattern**: State-Driven  
**While** canonical interaction state is valid, **the system SHALL** render tool call/result pairing deterministically such that repeated renders from unchanged state produce equivalent pairing outcomes.

---

## 4. Domain: Incomplete Fan-Out Closure Policy

### REQ-915-011 (State-Driven)
**Pattern**: State-Driven  
**While** an emitted tool-call set is incomplete (K<N real completions), **the system SHALL** emit policy-defined synthetic interruption/cancellation completions for each missing completion to produce a protocol-valid completion set.

### REQ-915-012 (Event-Driven)
**Pattern**: Event-Driven  
**When** a turn includes multiple tool calls and only a subset have real tool responses, **the system SHALL** preserve real completions and add only missing synthetic completions.

### REQ-915-013 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** closure policy would be required to satisfy strict-provider protocol validity, **then the system SHALL** apply closure before outbound send.

---

## 5. Domain: Canonical Identity and Provider ID Projection

### REQ-915-014 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL maintain provider-neutral canonical tool call identity internally across turns.

### REQ-915-015 (Event-Driven)
**Pattern**: Event-Driven  
**When** rendering for provider egress, **the system SHALL** project canonical tool identities to provider-required ID format without changing logical call/result pairing.

### REQ-915-016 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL apply injective ID mapping within a transcript render, such that one canonical call identity maps to exactly one provider ID and distinct canonical call identities map to distinct provider IDs.

### REQ-915-017 (State-Driven)
**Pattern**: State-Driven  
**While** a call/result pair is rendered, **the system SHALL** assign the same projected provider ID to both the tool call and its paired tool result reference.

### REQ-915-018 (Event-Driven)
**Pattern**: Event-Driven  
**When** the selected provider format is OpenAI-style, **the system SHALL** emit projected tool IDs conforming to `call_*`.

### REQ-915-019 (Event-Driven)
**Pattern**: Event-Driven  
**When** the selected provider format is Anthropic-style, **the system SHALL** emit projected tool IDs conforming to `toolu_*`.

### REQ-915-020 (Event-Driven)
**Pattern**: Event-Driven  
**When** the selected provider format is Kimi, **the system SHALL** emit projected tool IDs conforming to `functions.{toolName}:{globalIndex}`.

### REQ-915-021 (Event-Driven)
**Pattern**: Event-Driven  
**When** the selected provider format is Mistral, **the system SHALL** emit projected tool IDs as exactly 9 alphanumeric characters.

### REQ-915-022 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** provider ID normalization receives degenerate/empty call identity input, **then the system SHALL** still produce deterministic, collision-free projected IDs within transcript scope.

---

## 6. Domain: Thinking and Mixed Content Compatibility

### REQ-915-023 (Optional Feature)
**Pattern**: Optional Feature  
**Where** reasoning policy includes thinking blocks in provider context, **the system SHALL** include thinking blocks without violating tool protocol constraints.

### REQ-915-024 (Optional Feature)
**Pattern**: Optional Feature  
**Where** reasoning policy excludes thinking blocks from provider context, **the system SHALL** preserve valid tool call/result pairing and placement independently of thinking exclusion.

### REQ-915-025 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL support mixed assistant content (thinking, tool calls, tool results, text) while preserving provider-valid tool interaction rendering.

---

## 7. Domain: Compression and Summarization Safety

### REQ-915-026 (Event-Driven)
**Pattern**: Event-Driven  
**When** compression or summarization is applied to conversation history, **the system SHALL** preserve sufficient canonical interaction truth to render provider-valid tool interactions on future sends.

### REQ-915-027 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** compression removes one side of a historical call/result pair from retained text, **then the system SHALL** still render provider-valid paired representation using real or policy-defined synthetic completion.

### REQ-915-028 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL prevent compression outcomes from causing orphan tool calls or orphan tool results in outbound provider transcripts.

---

## 8. Domain: Tool Execution Path Unification

### REQ-915-029 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL use one unified tool execution and result-handling flow across interactive CLI, non-interactive CLI, and subagent modes.

### REQ-915-030 (State-Driven)
**Pattern**: State-Driven  
**While** a session is active in any execution mode, **the system SHALL** use a session-scoped CoreToolScheduler for tool scheduling in that mode.

### REQ-915-031 (Event-Driven)
**Pattern**: Event-Driven  
**When** a model turn returns multiple tool calls, **the system SHALL** schedule the calls as a batch for parallel execution rather than sequential per-call scheduler instantiation.

### REQ-915-032 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL apply identical filtering semantics across all execution modes by excluding functionCall parts from tool results fed back to GeminiChat continuation input.

### REQ-915-033 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL route tool result continuation through GeminiChat sendMessageStream path rather than ad-hoc manual history writes.

### REQ-915-034 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** cancellation occurs during tool execution, **then the system SHALL** complete cancellation handling through scheduler lifecycle and normal continuation path without introducing divergent manual history-write behavior.

### REQ-915-035 (Optional Feature)
**Pattern**: Optional Feature  
**Where** a single-shot non-turn-loop execution context is used, **the system SHALL** permit single-tool utility execution without imposing turn-loop batching requirements on that context.

---

## 9. Domain: Canonical-to-Provider Layer Responsibilities

### REQ-915-036 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL separate responsibilities such that transcript rendering enforces interaction validity and provider adapters enforce provider syntax/shape projection.

### REQ-915-037 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** validity repair responsibilities are duplicated across renderer and provider adapters, **then the system SHALL** maintain equivalent protocol-valid outcomes at provider boundary for strict providers.

### REQ-915-038 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL perform final transcript serialization safely for provider send even when tool call parameters contain complex object structures.

---

## 10. Domain: Observability and Diagnostics

### REQ-915-039 (Event-Driven)
**Pattern**: Event-Driven  
**When** debug/error diagnostics are emitted for transcript rendering and provider boundary handling, **the system SHALL** include canonical call IDs, emitted call IDs, emitted result IDs, dedupe decisions, synthetic completion reasons, and selected provider format.

### REQ-915-040 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL provide diagnostics sufficient to distinguish canonical-state corruption, renderer pairing/ordering faults, and provider projection faults.

---

## 11. Domain: Acceptance Scenarios (Behavioral)

### REQ-915-041 (Event-Driven)
**Pattern**: Event-Driven  
**When** a completed tool-interaction turn is followed by manual provider-family switch, **the system SHALL** complete the next request without provider tool-protocol 400 caused by malformed call/result structure.

### REQ-915-042 (Event-Driven)
**Pattern**: Event-Driven  
**When** providers alternate across turns due to round-robin selection, **the system SHALL** maintain valid tool interaction ordering/pairing without duplicate or out-of-order protocol failure.

### REQ-915-043 (Event-Driven)
**Pattern**: Event-Driven  
**When** failover selects a different provider family for a subsequent turn, **the system SHALL** render and send a protocol-valid next-turn transcript.

### REQ-915-044 (Event-Driven)
**Pattern**: Event-Driven  
**When** a turn contains 5 tool calls and exactly 1 real completion, **the system SHALL** emit a complete provider-valid interaction set with 1 real completion and 4 policy-defined synthetic completions.

### REQ-915-045 (Event-Driven)
**Pattern**: Event-Driven  
**When** the same tool-calling model turn is executed in interactive CLI, non-interactive CLI, and subagent modes, **the system SHALL** demonstrate equivalent scheduler batching, equivalent result filtering, and equivalent continuation-path history integration behavior.

---

## 12. Traceability Matrix

| Requirement ID | overview.md | technical-overview.md | dataflow-before-after.md | tool-execution-unification.md |
|---|---|---|---|---|
| REQ-915-001 | §6 | §1.3, §7.2 | “Today/After” turn boundary flow |  |
| REQ-915-002 | §6 | §2.1 | in-flight discussion |  |
| REQ-915-003 | §6 | §2.1, §7.2 | “Where it changes” |  |
| REQ-915-004 | §6, §10 | §11 | provider switch section |  |
| REQ-915-005 | §1, §3 | §2, §3 | “Where it breaks today” |  |
| REQ-915-006 | §4 | §3.1 | transcript assembly steps |  |
| REQ-915-007 | §4 | §3.1, §5.4 | repair/closure examples |  |
| REQ-915-008 | §4 | §3.1 | adjacency discussion |  |
| REQ-915-009 | §4 | §3.1, §5.3 | duplicate risk discussion |  |
| REQ-915-010 | §4 | §5, §7.2 | deterministic builder narrative |  |
| REQ-915-011 | §4, §5 | §5.4, §7.3 | incomplete/cancellation examples |  |
| REQ-915-012 | §5 | §7.3 | 5-call scenario |  |
| REQ-915-013 | §4 | §3.1 | strict provider failure context |  |
| REQ-915-014 | §7 | §4.1, §6 | canonical ID narrative |  |
| REQ-915-015 | §7 | §4.1, §6 | provider projection flow |  |
| REQ-915-016 | §7 | §3.2, §6.4 | projection examples |  |
| REQ-915-017 | §7 | §3.2, §6.4 | projection examples |  |
| REQ-915-018 | §7 | §6.1, §7.4 | OpenAI conversion |  |
| REQ-915-019 | §7 | §6.1, §7.4 | Anthropic conversion |  |
| REQ-915-020 | §7 | §6.1, §6.2, §7.4 |  |  |
| REQ-915-021 | §7 | §6.1, §6.3, §7.4 |  |  |
| REQ-915-022 |  | §6.4 edge cases |  |  |
| REQ-915-023 | §8 | §3.3, §7.3 | mixed thinking/tool flow |  |
| REQ-915-024 | §8 | §3.3 | mixed thinking/tool flow |  |
| REQ-915-025 | §8 | §3.3 | scenario baseline |  |
| REQ-915-026 | §9 | §8 | compression case |  |
| REQ-915-027 | §9 | §8 | compression case |  |
| REQ-915-028 | §9 | §8 | compression failure mode |  |
| REQ-915-029 | §3, §10 | §9 |  | §1–§4 |
| REQ-915-030 |  | §9.3 | scheduler lifetime comparisons | §1, §4 |
| REQ-915-031 |  | §9.3 | parallel vs sequential | §1–§4 |
| REQ-915-032 |  | §9.1, §9.3 | filtering differences | §1.2, §3.1, §4 |
| REQ-915-033 |  | §9.3 | continuation path | §4.1 |
| REQ-915-034 |  | §9.3, §9.4 | cancellation corruption narrative | §4.2 |
| REQ-915-035 |  | §9.4 |  | §4.3 |
| REQ-915-036 |  | §4.1, §4.2 | flow layering |  |
| REQ-915-037 |  | §4.2 (known deviation) |  |  |
| REQ-915-038 |  | §1.2 deepClone pass | serialization mention |  |
| REQ-915-039 |  | §10 |  |  |
| REQ-915-040 |  | §10 |  |  |
| REQ-915-041 | §10(1) | §11, §12 | provider switch section |  |
| REQ-915-042 | §10(2) | §11, §12 | multi-turn flow |  |
| REQ-915-043 | §10(3) | §11, §12 | failover continuity context |  |
| REQ-915-044 | §10(4) | §5.4, §7.3 | 5-call examples |  |
| REQ-915-045 | §10(6) | §9, §12(6) | path comparison in flow | §1–§4 |

---

## 13. Verification Notes

Each requirement is intended to be testable via transcript-render assertions, provider-adapter payload validation, mode-parity execution tests, and scenario-driven end-to-end runs corresponding to the acceptance scenarios above.