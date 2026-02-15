# Issue #915 — Requirements Specification (EARS)

**Title**: Safe provider/model switching for tool-calling transcripts  
**Issue**: #915  
**Source Documents**:  
- `project-plans/issue915/overview.md`  
- `project-plans/issue915/technical-overview.md`  
- `project-plans/issue915/dataflow-before-after.md`  
- `project-plans/issue915/tool-execution-unification.md`  
**Notation**: Strict EARS (Ubiquitous, Event-Driven, State-Driven, Optional Feature, Unwanted Behavior)  
**Normative Language**: SHALL (required behavior), SHOULD (target-state architectural direction with accepted current deviation)

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
**While** a prior model turn is in-flight and not terminal, **the system SHALL** keep tool execution and generation bound to the currently selected provider for that in-flight turn.

### REQ-915-003 (Event-Driven)
**Pattern**: Event-Driven  
**When** a provider/model switch is selected after a turn reaches terminal state, **the system SHALL** apply the new provider/model to the next request assembly only.

### REQ-915-004 (Event-Driven)
**Pattern**: Event-Driven  
**When** provider-family selection changes due to manual switch, round-robin, or failover, **the system SHALL** produce a protocol-valid outbound transcript for the newly selected provider that includes all prior conversation state relevant to the next request.

### REQ-915-050 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** a provider/model switch is requested while a model turn is in-flight and not terminal, **then the system SHALL NOT** apply the switch to the in-flight turn; the switch SHALL be deferred until the current turn reaches terminal state. Violating this invariant would invalidate tool call/result binding for the in-flight turn (see overview §6, technical-overview §2.1).

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
**Requirement**: The system SHALL enforce provider-required tool result placement, including strict adjacency for providers that require adjacency. Adjacency reconstruction SHALL preserve all real tool completions and SHALL NOT replace any real completion with a synthetic completion.

### REQ-915-009 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** multiple effective tool results exist for the same canonical call identity during render, **then the system SHALL** emit at most one effective completion for that call in the outbound transcript.

### REQ-915-010 (State-Driven)
**Pattern**: State-Driven  
**While** canonical interaction state is valid, **the system SHALL** render tool call/result pairing and ordering deterministically within a single provider render scope, such that repeated renders from unchanged state and identical provider selection produce identical pairing and ordering.

### REQ-915-049 (State-Driven)
**Pattern**: State-Driven  
**While** canonical interaction state is valid and canonical call identities are non-empty, **the system SHALL** produce collision-free projected IDs within a single provider render scope such that distinct canonical call identities map to distinct provider IDs.  
*Degenerate input note: When canonical call identity is empty or degenerate, REQ-915-022 applies. Some current projection strategies (e.g., Anthropic empty-ID fallback using `Date.now() + Math.random()`) produce non-deterministic projected IDs in this degenerate case. These are tracked defects (technical-overview §6.4) and not accepted design; however, they are outside #915 acceptance scope. #915 requires collision-freedom for non-degenerate input.*

### REQ-915-047 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** tool_call blocks are found inside a tool-speaker message in canonical history, **then the system SHALL** correct the speaker attribution before transcript rendering.

---

## 4. Domain: Incomplete Fan-Out Closure Policy

### REQ-915-011 (State-Driven)
**Pattern**: State-Driven  
**While** an emitted tool-call set is incomplete (K<N real completions), **the system SHALL** emit exactly one policy-defined synthetic interruption/cancellation completion for each call lacking a real completion, such that the total emitted completion count equals the emitted call count.

### REQ-915-012 (Event-Driven)
**Pattern**: Event-Driven  
**When** a turn includes multiple tool calls and only a subset have real tool responses, **the system SHALL** preserve every real completion unchanged and SHALL NOT replace or duplicate any real completion when adding synthetic completions for the missing calls. Result placement MAY be reordered to satisfy provider adjacency requirements (see technical-overview §3.1).

### REQ-915-013 (Unwanted Behavior)
**Pattern**: Unwanted Behavior  
**If** an outbound transcript would otherwise be sent with an incomplete completion set that violates strict-provider protocol validity, **then the system SHALL** apply closure (per REQ-915-011 and REQ-915-012) before outbound send, guaranteeing no incomplete completion set reaches the provider wire.

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
**When** the selected provider format is Anthropic-style, **the system SHALL** emit projected tool IDs conforming to `toolu_*`. *Note: Current Anthropic ID projection bypasses the shared ToolIdStrategy framework via a private method in AnthropicProvider. This is a known architectural deviation, not a behavioral requirement.*

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

### REQ-915-023 (State-Driven)
**Pattern**: State-Driven  
**While** reasoning policy includes thinking blocks in provider context, **the system SHALL** include thinking blocks without violating tool protocol constraints.

### REQ-915-024 (State-Driven)
**Pattern**: State-Driven  
**While** reasoning policy excludes thinking blocks from provider context, **the system SHALL** preserve valid tool call/result pairing and placement independently of thinking exclusion.

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
**Requirement**: The system SHALL apply identical filtering semantics across all execution modes by excluding functionCall parts from tool results fed back to provider continuation input.

### REQ-915-033 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL integrate tool results into conversation history through the same continuation path used for normal user-to-model turns, rather than ad-hoc direct history writes.

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

### REQ-915-037 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL centralize interaction-validity repair responsibilities in the transcript renderer. Provider adapters SHOULD limit themselves to provider syntax/shape projection without duplicating validity repair logic.  
*Note: The Anthropic adapter currently performs its own validity repair as a known deviation (see technical-overview §4.2). Consolidation of this deviation into the renderer is a target-state goal, not a hard acceptance criterion for #915. REQ-915-037 defines the architectural direction; existing adapter-level repair is acceptable until consolidation is completed.*

### REQ-915-038 (Ubiquitous) — Non-Regression
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL perform final transcript serialization safely for provider send even when tool call parameters contain complex object structures.  
*Classification: Non-regression constraint derived from existing behavior (technical-overview §1.2, deepClone pass). Not a new behavioral requirement introduced by #915; included to guard against regression during refactoring.*

### REQ-915-046 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL scope canonical tool interaction state to the session lifetime and SHALL support reconstruction of that state from conversation history as a fallback when authoritative session-scoped state is unavailable.

### REQ-915-048 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL infer tool interaction completion status from the canonical content model using the following precedence: (1) if `error` is present, the interaction is errored; (2) else if `isComplete` is true, the interaction is complete; (3) else if `result` is non-null and no error is present, the interaction is complete; (4) else the interaction is pending. This inference SHALL be used for state reconstruction and transcript rendering decisions.

---

## 10. Domain: Observability and Diagnostics

### REQ-915-039 (Event-Driven)
**Pattern**: Event-Driven  
**When** debug/error diagnostics are emitted for transcript rendering and provider boundary handling, **the system SHALL** include, at minimum, canonical call IDs, emitted call IDs, emitted result IDs, dedupe decision outcome and rationale, synthetic completion reason code, and selected provider format.

### REQ-915-040 (Ubiquitous)
**Pattern**: Ubiquitous  
**Requirement**: The system SHALL emit diagnostics that distinguish three fault classes — canonical-state corruption, renderer pairing/ordering faults, and provider projection faults — by including at minimum a fault-class identifier and the associated canonical call IDs in each diagnostic event emitted in debug/error paths.

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
**When** the same tool-calling model turn is executed in interactive CLI, non-interactive CLI, and subagent modes, **the system SHALL** demonstrate identical scheduler batching, identical result filtering, and identical continuation-path history integration behavior.

---

## 12. Traceability Matrix

| Requirement ID | Source | overview.md | technical-overview.md | dataflow-before-after.md | tool-execution-unification.md |
|---|---|---|---|---|---|
| REQ-915-001 | Direct | §6 | §1.3, §7.2 | turn boundary flow |  |
| REQ-915-002 | Direct | §6 | §2.1 | in-flight discussion |  |
| REQ-915-003 | Direct | §6 | §2.1, §7.2 | "Where it changes" |  |
| REQ-915-004 | Direct | §6, §10 | §11 | provider switch section |  |
| REQ-915-005 | Direct | §1, §3, §4 | §2, §3 | "Where it breaks today" |  |
| REQ-915-006 | Direct | §4 | §3.1 | transcript assembly steps |  |
| REQ-915-007 | Direct | §4 | §3.1, §5.4 | repair/closure examples |  |
| REQ-915-008 | Direct | §4 | §3.1 | adjacency discussion |  |
| REQ-915-009 | Direct | §4 | §3.1, §5.3 | duplicate risk discussion |  |
| REQ-915-010 | Direct | §4 | §3.2, §7.2 | deterministic builder narrative |  |
| REQ-915-011 | Direct | §4, §5 | §5.4, §7.3 | incomplete/cancellation examples |  |
| REQ-915-012 | Direct | §5 | §3.1, §7.3 | 5-call scenario |  |
| REQ-915-013 | Direct | §4 | §3.1 | strict provider failure context |  |
| REQ-915-014 | Direct | §7 | §4.1, §6 | canonical ID narrative |  |
| REQ-915-015 | Direct | §7 | §4.1, §6 | provider projection flow |  |
| REQ-915-016 | Direct | §7 | §3.2, §6.4 | projection examples |  |
| REQ-915-017 | Direct | §7 | §3.2, §6.4 | projection examples |  |
| REQ-915-018 | Direct | §7 | §6.1, §7.4 | OpenAI conversion |  |
| REQ-915-019 | Direct | §7 | §6.1, §7.4 | Anthropic conversion |  |
| REQ-915-020 | Direct | §7 | §6.1, §6.2, §7.4 |  |  |
| REQ-915-021 | Direct | §7 | §6.1, §6.3, §7.4 |  |  |
| REQ-915-022 | Derived | | §6.4 (edge cases) |  |  |
| REQ-915-023 | Direct | §8 | §3.3, §7.3 | mixed thinking/tool flow |  |
| REQ-915-024 | Direct | §8 | §3.3 | mixed thinking/tool flow |  |
| REQ-915-025 | Direct | §8 | §3.3 | scenario baseline |  |
| REQ-915-026 | Direct | §9 | §8 | compression case |  |
| REQ-915-027 | Direct | §9 | §8 | compression case |  |
| REQ-915-028 | Direct | §9 | §8 | compression failure mode |  |
| REQ-915-029 | Direct | §3, §10 | §9 |  | §1–§4 |
| REQ-915-030 | Derived |  | §9.3 |  | §1, §4 |
| REQ-915-031 | Derived |  | §9.3 |  | §1–§4 |
| REQ-915-032 | Derived |  | §9.1, §9.3 |  | §1.2, §3.1, §4 |
| REQ-915-033 | Derived |  | §9.3 |  | §4.1 |
| REQ-915-034 | Derived |  | §9.3, §9.4 |  | §4.2 |
| REQ-915-035 | Derived |  | §9.4 |  | §4.3 |
| REQ-915-036 | Direct |  | §4.1, §4.2 | flow layering |  |
| REQ-915-037 | Derived |  | §4.2 (known deviation — target-state) |  |  |
| REQ-915-038 | Non-regression |  | §1.2 (deepClone pass) |  |  |
| REQ-915-039 | Derived |  | §10 |  |  |
| REQ-915-040 | Derived |  | §10 |  |  |
| REQ-915-041 | Direct | §10(1) | §11, §12 | provider switch section |  |
| REQ-915-042 | Direct | §10(2) | §11, §12 | multi-turn flow |  |
| REQ-915-043 | Direct | §10(3) | §11, §12 | failover continuity context |  |
| REQ-915-044 | Direct | §10(4) | §5.4, §7.3 | 5-call examples |  |
| REQ-915-045 | Direct | §10(6) | §9, §12(6) | path comparison in flow | §1–§4 |
| REQ-915-046 | Direct |  | §5.1 | ledger lifetime / reconstruction |  |
| REQ-915-047 | Direct | §3(8), §4 | §1.2 |  |  |
| REQ-915-048 | Direct |  | §5.2 |  |  |
| REQ-915-049 | Direct |  | §3.2, §6.4 |  |  |
| REQ-915-050 | Direct | §6 | §2.1 |  |  |

---

## 13. Verification Notes

Each requirement is intended to be testable via transcript-render assertions, provider-adapter payload validation, mode-parity execution tests, and scenario-driven end-to-end runs corresponding to the acceptance scenarios above.