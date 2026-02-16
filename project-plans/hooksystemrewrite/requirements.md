# LLxprt Code Hook System Rewrite — EARS Requirements

This document specifies requirements for the Hook System rewrite using the
**EARS (Easy Approach to Requirements Syntax)** format. Every requirement uses
one of five sentence templates:

| EARS Type | Template |
|---|---|
| **Ubiquitous** | The \<system\> shall \<action\>. |
| **Event-driven** | When \<trigger\>, the \<system\> shall \<action\>. |
| **State-driven** | While \<state\>, the \<system\> shall \<action\>. |
| **Unwanted behavior** | If \<unwanted condition\>, then the \<system\> shall \<action\>. |
| **Optional/feature-driven** | Where \<feature is enabled\>, the \<system\> shall \<action\>. |

### Markers

- **[Target]** — Requirement describes new/future behavior not yet implemented in the current codebase. Implementation is required as part of the rewrite.

### Errata

- **overview.md config path:** The companion design document `overview.md`
  (§6.1, §7.1, §9) still references `tools.enableHooks`. The correct
  config path is `enableHooks` (top-level, no `tools.` prefix), as
  verified in `config.ts` which defines `enableHooks?: boolean` and
  `getEnableHooks(): boolean`. Requirements in this document use the
  correct path. The overview.md path is a known erratum pending a
  separate documentation fix.
<!-- R3-01: Added erratum note for overview.md config path discrepancy. -->

### Review Remediation Log

This document has been updated to address 48 review findings from
`requirements-review-1.md`, 41 review findings from
`requirements-review-2.md`, 22 review findings from
`requirements-review-3.md`, and 8 review findings from
`requirements-review-4.md`. Each change is annotated with the review finding
ID (e.g., `[R1-XX]`, `[R2-XX]`, `[R3-XX]`, `[R4-XX]`) in a trailing comment for traceability.

---

## 1. Initialization & Lifecycle

### HOOK-001
**Type:** Optional/feature-driven
**Requirement:** Where `enableHooks` is set to `true`, the Config shall create a `HookSystem` instance lazily on the first call to `getHookSystem()`.
**Traces to:** technical-overview.md §4.1
<!-- R2-03: Fixed config path from `tools.enableHooks` to `enableHooks` (top-level). Verified: config.ts defines `enableHooks?: boolean` and `getEnableHooks(): boolean` with no `tools.` prefix. -->

### HOOK-002
**Type:** Event-driven
**Requirement:** When `getHookSystem()` is called and `getEnableHooks()` returns `false`, the Config shall return `undefined`.
**Traces to:** technical-overview.md §4.1

### HOOK-003
**Type:** Ubiquitous
**Requirement:** The HookSystem shall call `HookRegistry.initialize()` at most once per Config lifetime, regardless of how many hook events fire.
**Traces to:** technical-overview.md §3.1, §13 invariant 1; overview.md §7.8
<!-- R1-32: HOOK-004 retained as the mechanism-level companion to this invariant. See HOOK-004. -->

### HOOK-004
**Type:** Event-driven
**Requirement:** When `HookSystem.initialize()` is called a second or subsequent time, the HookSystem shall return immediately without re-initializing the registry.
**Traces to:** technical-overview.md §3.1 (idempotent)
<!-- R1-32: Retained as the mechanism-level companion to HOOK-003 (invariant vs. idempotency guard). -->

### HOOK-005
**Type:** Event-driven
**Requirement:** [Target] When `getEventHandler()` or `getRegistry()` is called before `initialize()`, the HookSystem shall throw a `HookSystemNotInitializedError`.
**Traces to:** technical-overview.md §3.1 invariants
<!-- R3-11: Marked [Target] — `HookSystemNotInitializedError` does not exist in current code. Only `HookRegistryNotInitializedError` exists (hookRegistry.ts). This class must be created as part of the rewrite. -->

### HOOK-006
**Type:** Ubiquitous
**Requirement:** The HookSystem shall expose `getRegistry()`, `getEventHandler()`, and `getStatus()` as its public accessors. Internally the HookSystem shall own single shared instances of `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`, reused across all event fires. The planner, runner, and aggregator are created by HookSystem and injected into `HookEventHandler` by HookSystem; they are not directly accessible from `HookSystem`'s public API.
**Traces to:** technical-overview.md §3.1, §13 invariant 2
<!-- R1-04: Reworded from "shall own exactly one instance each of…" (internal-state-prescriptive) to observable accessor-based requirement. -->
<!-- R2-01: Fixed — removed nonexistent `getPlanner()`, `getRunner()`, `getAggregator()` from public API. Per tech spec §3.1, HookSystem exposes only `initialize()`, `getEventHandler()`, `getRegistry()`, `getStatus()`. Planner/runner/aggregator are internal to HookEventHandler. -->
<!-- R4-04: Fixed ownership wording — "internal to HookEventHandler" was misleading. HookSystem owns/creates these instances and injects them into HookEventHandler. -->

### HOOK-007
**Type:** Ubiquitous
**Requirement:** The rewritten trigger functions shall never construct new instances of `HookRegistry`, `HookPlanner`, `HookRunner`, or `HookAggregator`; they shall obtain these from the `HookSystem` via `Config`.
**Traces to:** technical-overview.md §13 invariant 2; overview.md §7.1

### HOOK-008
**Type:** Event-driven
**Requirement:** When the first hook event fires, the trigger function shall call `hookSystem.initialize()` to perform lazy initialization before delegating to the event handler.
**Traces to:** technical-overview.md §4.2

### HOOK-009
**Type:** Ubiquitous
**Requirement:** The `HookSystem.getStatus()` method shall report `{ initialized: boolean; totalHooks: number }`.
**Traces to:** technical-overview.md §3.1

---

## 2. Zero Overhead When Disabled

### HOOK-010
**Type:** State-driven
**Requirement:** While `enableHooks` is `false`, the hook system shall not spawn any child processes or allocate hook infrastructure objects (HookRegistry, HookPlanner, HookRunner, HookAggregator). This is observable by verifying `getHookSystem()` returns `undefined`.
**Traces to:** overview.md §7.1
<!-- R1-35: Removed "add measurable latency" (untestable). Observable constraint is now absence of object allocation and process spawning. Latency is covered by HOOK-013 fast-path. -->
<!-- R2-03: Fixed `tools.enableHooks` → `enableHooks`. -->
<!-- R2-35: Added observable proxy: `getHookSystem()` returns `undefined`. -->

### HOOK-011
**Type:** State-driven
**Requirement:** While no hooks are configured for an event, the hook system shall not spawn any child processes and shall return before constructing HookInput payloads.
**Traces to:** overview.md §7.1
<!-- R1-36: Reworded from "allocate per-event infrastructure" to observable: no process spawn, no payload construction. -->

### HOOK-012
**Type:** State-driven
**Requirement:** While no hooks match the current event (after matcher filtering), the hook system shall not spawn any child processes.
**Traces to:** overview.md §7.1

### HOOK-013
**Type:** Ubiquitous
**Requirement:** The check for "are hooks relevant?" shall be synchronous and shall not perform file I/O — `config.getHookSystem()` shall return `undefined` synchronously when hooks are disabled. On the disabled/no-match fast path, no async operations shall be invoked.
**Traces to:** overview.md §7.1; technical-overview.md §4.1
<!-- R1-37: Reworded from "fast-path boolean check" (implementation-prescriptive) to observable constraints. -->
<!-- R2-36: Refined "no object allocations" (not observable without instrumentation) to scoped constraint: disabled/no-match fast path shall not invoke async operations. The `getHookSystem() returns undefined` clause is the testable assertion. -->

---

## 3. BeforeTool Hook Event

### HOOK-014
**Type:** Event-driven
**Requirement:** When a tool is about to execute, the hook system shall fire a `BeforeTool` event immediately before execution.
**Traces to:** overview.md §3.1

### HOOK-015
**Type:** Ubiquitous
**Requirement:** The `BeforeTool` hook input shall include `session_id`, `cwd`, `timestamp` (ISO 8601), `hook_event_name` (always `"BeforeTool"`), `transcript_path`, `tool_name`, and `tool_input`.
**Traces to:** overview.md §3.1 input table

### HOOK-016a
**Type:** Event-driven
**Requirement:** When a BeforeTool hook script exits with code 2 and stderr is non-empty, the hook system shall treat it as a block/deny decision, prevent the tool from executing, and use the stderr text as the blocking `reason` via `convertPlainTextToHookOutput()`.
**Traces to:** overview.md §3.1 "Block execution"; overview.md §4.3; Canonical Exit-Code Precedence Table (§35)
<!-- R1-01: Split from HOOK-016 (mixed two code paths). This covers exit-code-2 path. -->
<!-- R1-06: Corrected — exit code 2 does NOT parse stdout JSON; stderr becomes reason via convertPlainTextToHookOutput(). -->
<!-- R1-26: Captures exit-code-2 stderr-as-reason behavior. -->
<!-- R2-15: Split from combined requirement into separate 016a (non-empty stderr) and 016b (JSON block). Empty-stderr subcase of exit code 2 is covered in HOOK-067 and HOOK-197. -->

### HOOK-016b
**Type:** Event-driven
**Requirement:** When a BeforeTool hook script exits with code 0 and returns valid JSON on stdout containing `decision` = `"block"` or `"deny"`, the hook system shall prevent the tool from executing and use the `reason` field from the JSON output as the blocking reason.
**Traces to:** overview.md §3.1 "Block execution"; overview.md §4.2; Canonical Exit-Code Precedence Table (§35)
<!-- R1-01: Split from HOOK-016. This covers the exit-0-with-JSON-block path. -->

### HOOK-017
**Type:** Event-driven
**Requirement:** [Target] When a BeforeTool hook blocks a tool, the caller shall construct a `ToolResult` whose `llmContent` field contains the blocking `reason` string (from `DefaultHookOutput.getEffectiveReason()`), so that the model receives the block reason as the tool's output.
**Traces to:** overview.md §3.1 "Block execution"; technical-overview.md §5.1
<!-- R2-08: Marked [Target] — currently callers fire-and-forget hook results; awaiting and constructing ToolResult is target behavior. -->
<!-- R2-32: Made testable — specified the field (`llmContent`), the source (`getEffectiveReason()`), and the observable outcome. -->

### HOOK-018
**Type:** Event-driven
**Requirement:** When a BeforeTool hook script exits with code 0 and returns `decision` = `"allow"` or `"approve"` (or no decision field), the tool shall execute normally.
**Traces to:** overview.md §3.1 "Allow execution"

### HOOK-019
**Type:** Event-driven
**Requirement:** [Target] When a BeforeTool hook script returns a modified `tool_input` in `hookSpecificOutput`, the tool shall execute with the modified arguments instead of the originals.
**Traces to:** overview.md §3.1 "Modify tool input"
<!-- R1-08: BeforeTool input chaining is target behavior — applyHookOutputToInput() has no BeforeTool branch. -->

### HOOK-020
**Type:** Event-driven
**Requirement:** [Target] When a BeforeTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user.
**Traces to:** overview.md §3.1 "Stop the agent"
<!-- R2-09: Marked [Target] — hook system alone cannot terminate the agent loop; the caller must act on the result. Currently callers fire-and-forget. -->

### HOOK-021
**Type:** Event-driven
**Requirement:** When a BeforeTool event is fired, the hook planner shall invoke only hooks whose `matcher` regex matches the `tool_name`; hooks with non-matching matchers shall be skipped.
**Traces to:** overview.md §3.1 "Matching"
<!-- R1-02: Reworded from "When only hooks whose matcher regex matches..." (embedded state in event template) to proper event-driven EARS. -->

### HOOK-022
**Type:** Event-driven
**Requirement:** When a BeforeTool hook has no `matcher` configured, the hook shall fire for all tools.
**Traces to:** overview.md §3.1 "Matching"

### HOOK-023
**Type:** Unwanted behavior
**Requirement:** If a BeforeTool hook script crashes, times out, or exits with any code other than 0 or 2, then the hook system shall allow the tool to execute normally (fail-open) and log a warning via `DebugLogger` at warn level including the exit code and stderr content.
**Traces to:** overview.md §3.1 "Error behavior"; Canonical Exit-Code Precedence Table (§35)
<!-- R1-03 (partial): Specified logging level and content for testability. -->
<!-- R2-33: Specified logger namespace (`DebugLogger`) for testability. -->

### HOOK-024
**Type:** Event-driven
**Requirement:** [Target] When `applyHookOutputToInput()` is called for a sequential BeforeTool chain, the HookRunner shall merge `hookSpecificOutput.tool_input` into the next hook's `tool_input` field.
**Traces to:** overview.md §3.1 "Modify tool input" note; technical-overview.md §5.1
<!-- R1-08: applyHookOutputToInput() currently only handles BeforeAgent and BeforeModel. BeforeTool branch does not exist yet. Marked [Target]. -->

---

## 4. AfterTool Hook Event

### HOOK-025
**Type:** Event-driven
**Requirement:** When a tool finishes executing, the hook system shall fire an `AfterTool` event immediately after execution and before the result is sent to the model.
**Traces to:** overview.md §3.2

### HOOK-026
**Type:** Ubiquitous
**Requirement:** The `AfterTool` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterTool"`), `transcript_path`, `tool_name`, `tool_input`, and `tool_response` (an object containing `llmContent`, `returnDisplay`, `metadata`, and optional `error` fields as defined by the `ToolResult` type).
**Traces to:** overview.md §3.2 input table
<!-- R1-20: Added tool_response structure specification. -->

### HOOK-027
**Type:** Event-driven
**Requirement:** [Target] When an AfterTool hook returns `additionalContext` in `hookSpecificOutput`, the hook system shall append that text to the tool result's LLM-facing content.
**Traces to:** overview.md §3.2 "Inject context"
<!-- R1-12: Application depends on callers; currently fire-and-forget. Marked [Target]. -->

### HOOK-028
**Type:** Event-driven
**Requirement:** [Target] When an AfterTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user.
**Traces to:** overview.md §3.2 "Stop the agent"
<!-- R1-12: Application depends on callers; currently fire-and-forget. Marked [Target]. -->

### HOOK-029
**Type:** Event-driven
**Requirement:** [Target] When an AfterTool hook returns `suppressOutput` = `true`, the tool result shall not be displayed to the user (the `suppressDisplay` flag shall be set on the ToolResult). The model shall still receive the tool result's LLM-facing content.
**Traces to:** overview.md §3.2 "Suppress output"
<!-- R1-38: Clarified observation points — suppressDisplay on ToolResult for user channel, llmContent unchanged for model channel. -->
<!-- R1-10: AfterModel suppressOutput has no display-integration logic yet; same principle applies here. -->

### HOOK-030
**Type:** Event-driven
**Requirement:** [Target] When an AfterTool hook returns a `systemMessage` field, the hook system shall inject that text into the tool result's LLM-facing content as a system-role annotation.
**Traces to:** overview.md §3.2 "Add system message"
<!-- R1-09: systemMessage injection infrastructure exists but no mechanism injects into conversation state. Marked [Target]. -->

### HOOK-031
**Type:** Unwanted behavior
**Requirement:** If an AfterTool hook script fails (crash, timeout, non-0/non-2 exit), then the hook system shall not modify the tool result and shall log a warning via `DebugLogger` at warn level including the exit code and stderr content (fail-open).
**Traces to:** overview.md §3.2 "Error behavior"; Canonical Exit-Code Precedence Table (§35)
<!-- R1-03: Split logging into separate testable property. -->
<!-- R2-17: Consistent with HOOK-196 — signal-killed processes have success:false (fail-open applies). -->
<!-- R2-33: Specified logger namespace (`DebugLogger`) for testability. -->

### HOOK-032
**Type:** Event-driven
**Requirement:** When AfterTool hooks are configured with a `matcher`, only scripts whose regex matches the `tool_name` shall be invoked.
**Traces to:** overview.md §3.2 "Matching"

---

## 5. BeforeModel Hook Event

### HOOK-033
**Type:** Event-driven
**Requirement:** When an LLM API call is about to be made, the hook system shall fire a `BeforeModel` event after the request is fully assembled.
**Traces to:** overview.md §3.3

### HOOK-034
**Type:** Ubiquitous
**Requirement:** The `BeforeModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeModel"`), `transcript_path`, and `llm_request` (in stable hook API format via the hook translator).
**Traces to:** overview.md §3.3 input table; technical-overview.md §3.2

### HOOK-035
**Type:** Ubiquitous
**Requirement:** The `BeforeModel` event handler shall use `defaultHookTranslator.toHookLLMRequest()` to convert `GenerateContentParameters` to the stable hook API format before sending to scripts.
**Traces to:** technical-overview.md §3.2, §7.3, §13 invariant 3

### HOOK-036
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and provides an `llm_response` in `hookSpecificOutput`, the caller shall skip the model call and use the synthetic response as if the model had responded. Currently callers fire-and-forget BeforeModel results (`void triggerBeforeModelHook(...)` in geminiChat.ts).
**Traces to:** overview.md §3.3 "Block with synthetic response"; Canonical Exit-Code Precedence Table (§35)
<!-- R1-44: Clarified that block-via-JSON only works on exit code 0 (stdout JSON not parsed on other exit codes). -->
<!-- R3-12: Marked [Target] — skipping the model call requires caller integration. Callers currently fire-and-forget. -->

### HOOK-037
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and does not provide an `llm_response`, the caller shall skip the model call and return an empty/no-op response. Currently callers fire-and-forget BeforeModel results.
**Traces to:** overview.md §3.3 "Block without response"
<!-- R1-44: Clarified exit-code-0 precondition. -->
<!-- R3-12: Marked [Target] — skipping the model call requires caller integration. -->

### HOOK-038
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook returns a modified `llm_request` in `hookSpecificOutput`, the caller shall send the modified request to the model instead of the original. Currently callers fire-and-forget BeforeModel results.
**Traces to:** overview.md §3.3 "Modify the request"
<!-- R3-12: Marked [Target] — sending the modified request requires caller integration. -->

### HOOK-039
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook adds messages to the `llm_request.messages` array, the caller shall append those additional context messages after the existing messages in the model call. Currently callers fire-and-forget BeforeModel results.
**Traces to:** overview.md §3.3 "Inject context"
<!-- R1-39: Specified append ordering. Messages are appended (not prepended). No deduplication is performed. -->
<!-- R3-12: Marked [Target] — appending messages requires caller integration. -->

### HOOK-040
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook returns `continue` = `false`, the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeModel results.
**Traces to:** overview.md §3.3 "Stop the agent"
<!-- R3-12: Marked [Target] — terminating the agent loop requires caller integration. -->

### HOOK-041
**Type:** Ubiquitous
**Requirement:** The BeforeModel hook shall fire on every model call without matcher filtering (no `tool_name` to match against).
**Traces to:** overview.md §3.3 "Matching"

### HOOK-042
**Type:** Unwanted behavior
**Requirement:** If a BeforeModel hook script fails (crash, timeout, or any exit code other than 0 or 2), then the hook system shall not prevent the model call and shall log a warning via `DebugLogger` at warn level (fail-open). Exit code determines failure vs. block as specified in the Canonical Exit-Code Precedence Table (§35).
**Traces to:** overview.md §3.3 "Error behavior"; Canonical Exit-Code Precedence Table (§35)
<!-- R1-44: Clarified precedence — exit code wins over output content. A script emitting block JSON but exiting non-zero/non-2 is treated as failure (fail-open), not block. -->
<!-- R2-33: Specified logger namespace. -->

---

## 6. AfterModel Hook Event

### HOOK-043
**Type:** Event-driven
**Requirement:** When the model responds, the hook system shall fire an `AfterModel` event after the complete response is available and before the response is processed by the agent.
**Traces to:** overview.md §3.4

### HOOK-044
**Type:** Ubiquitous
**Requirement:** The `AfterModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterModel"`), `transcript_path`, `llm_request` (the original request in stable hook API format), and `llm_response` (the model's response in stable hook API format).
**Traces to:** overview.md §3.4 input table; technical-overview.md §3.2

### HOOK-045
**Type:** Ubiquitous
**Requirement:** The `AfterModel` event handler shall use `defaultHookTranslator.toHookLLMResponse()` to convert `GenerateContentResponse` to the stable hook API format before sending to scripts.
**Traces to:** technical-overview.md §3.2, §13 invariant 3

### HOOK-046
**Type:** Event-driven
**Requirement:** [Target] When an AfterModel hook returns a modified `llm_response` in `hookSpecificOutput`, the caller shall use the modified response downstream instead of the original. Currently callers fire-and-forget AfterModel results.
**Traces to:** overview.md §3.4 "Modify the response"
<!-- R3-12: Marked [Target] — using the modified response requires caller integration. -->

### HOOK-047
**Type:** Event-driven
**Requirement:** [Target] When an AfterModel hook returns a completely new `llm_response`, the caller shall use the replacement as if the model had produced it. Currently callers fire-and-forget AfterModel results.
**Traces to:** overview.md §3.4 "Replace the response"
<!-- R3-12: Marked [Target] — using the replacement response requires caller integration. -->

### HOOK-048
**Type:** Event-driven
**Requirement:** [Target] When an AfterModel hook returns `continue` = `false`, the hook system shall generate a synthetic stop response containing the `stopReason` via `AfterModelHookOutput.getModifiedResponse()`, and the caller shall terminate the agent loop. Currently callers fire-and-forget AfterModel results (`void triggerAfterModelHook(...)` in geminiChat.ts).
**Traces to:** overview.md §3.4 "Stop the agent"; technical-overview.md §5.2
<!-- R1-15: Fixed trace — was pointing to source code (types.ts). Now traces to spec sections. -->
<!-- R3-09: Marked [Target] — AfterModel response modification requires caller integration. Same pattern as HOOK-019 (BeforeTool input modification). -->

### HOOK-049
**Type:** Event-driven
**Requirement:** [Target] When an AfterModel hook returns `suppressOutput` = `true`, the caller shall suppress the response from being displayed to the user while still processing it for tool calls and agent state. No caller acts on AfterModel outputs today (all callers use `void` prefix).
**Traces to:** overview.md §3.4 "Suppress output"
<!-- R1-10: No display-integration logic exists for AfterModel suppressOutput. Marked [Target]. -->
<!-- R3-08: Confirmed [Target] — no caller acts on AfterModel outputs today. Same situation as HOOK-029 (AfterTool suppressOutput). -->

### HOOK-050
**Type:** Ubiquitous
**Requirement:** The AfterModel hook shall fire after the streaming response has been fully collected into a complete `GenerateContentResponse` — not per-chunk. The "complete response" boundary is defined as the point where all streaming chunks have been received and concatenated into the final `GenerateContentResponse` object. **Note:** The AfterModel event fires today, but the current implementation passes `llm_request: {} as never` (a placeholder, not the real request) because the request is not available in the current trigger context (verified: `geminiChatHookTriggers.ts` line 153). [Target] The rewrite shall pass the actual `llm_request` (translated via `toHookLLMRequest()`) so that hook scripts receive real data.
**Traces to:** technical-overview.md §11, §11.1
<!-- R1-40: Added explicit definition of complete-response boundary. -->
<!-- R3-10: Added note that AfterModel fires today but with placeholder data (`{} as never`). The "with real data" part is [Target]. -->

### HOOK-051
**Type:** Ubiquitous
**Requirement:** The AfterModel hook shall fire on every model call without matcher filtering.
**Traces to:** overview.md §3.4 "Matching"

### HOOK-052
**Type:** Unwanted behavior
**Requirement:** If an AfterModel hook script fails, then the hook system shall not affect the model response and shall log a warning via `DebugLogger` at warn level (fail-open).
**Traces to:** overview.md §3.4 "Error behavior"
<!-- R2-33: Specified logger namespace. -->

---

## 7. BeforeToolSelection Hook Event

### HOOK-053
**Type:** Event-driven
**Requirement:** When the model is about to decide which tools to call, the hook system shall fire a `BeforeToolSelection` event before the LLM request that includes tool definitions is sent.
**Traces to:** overview.md §3.5

### HOOK-054
**Type:** Ubiquitous
**Requirement:** The `BeforeToolSelection` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeToolSelection"`), `transcript_path`, and `llm_request` (in stable hook API format).
**Traces to:** overview.md §3.5 input table

### HOOK-055
**Type:** Event-driven
**Requirement:** [Target] When a BeforeToolSelection hook returns `toolConfig` with `allowedFunctionNames` in `hookSpecificOutput`, the caller shall apply the `allowedFunctionNames` to the request's `toolConfig`, restricting which tools the model may call. Tool restriction works through `toolConfig.allowedFunctionNames` — the `tools` definitions list is passed through unchanged. Currently callers fire-and-forget BeforeToolSelection results (`void triggerBeforeToolSelectionHook(...)` in geminiChat.ts).
**Traces to:** overview.md §3.5 "Restrict available tools"
<!-- R1-11: Corrected — applyToolConfigModifications() updates toolConfig but returns tools unchanged. Does not filter tool definitions. -->
<!-- R1-45: Clarified single-hook behavior. Multi-hook union aggregation is specified in HOOK-099. -->
<!-- R3-12: Marked [Target] — applying tool restriction requires caller integration. -->

### HOOK-056
**Type:** Event-driven
**Requirement:** [Target] When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"AUTO"`, `"ANY"`, or `"NONE"`, the caller shall apply the specified tool-calling mode. Currently callers fire-and-forget BeforeToolSelection results.
**Traces to:** overview.md §3.5 "Change tool calling mode"
<!-- R3-12: Marked [Target] — applying tool-calling mode requires caller integration. -->

### HOOK-057
**Type:** Event-driven
**Requirement:** [Target] When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"NONE"`, the caller shall ensure the model cannot call any tools for that request. Currently callers fire-and-forget BeforeToolSelection results.
**Traces to:** overview.md §3.5 "Disable all tools"
<!-- R3-12: Marked [Target] — enforcing NONE mode requires caller integration. -->

### HOOK-058
**Type:** Event-driven
**Requirement:** [Target] When a BeforeToolSelection hook returns `continue` = `false`, the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeToolSelection results.
**Traces to:** overview.md §3.5 "Stop the agent"
<!-- R3-12: Marked [Target] — terminating the agent loop requires caller integration. -->

### HOOK-059
**Type:** Ubiquitous
**Requirement:** The BeforeToolSelection hook shall fire on every tool-selection request without matcher filtering.
**Traces to:** overview.md §3.5 "Matching"

### HOOK-060
**Type:** Unwanted behavior
**Requirement:** If a BeforeToolSelection hook script fails, then the hook system shall not modify the request's tool configuration and shall log a warning via `DebugLogger` at warn level (fail-open).
**Traces to:** overview.md §3.5 "Error behavior"
<!-- R1-03: Split into two independently testable outcomes: (1) no modification, (2) warning logged. -->
<!-- R2-33: Specified logger namespace. -->

---

## 8. Communication Protocol

### HOOK-061
**Type:** Ubiquitous
**Requirement:** The hook system shall write a single JSON object to each hook script's stdin, followed by EOF (stdin closed after writing).
**Traces to:** overview.md §4.1

### HOOK-062
**Type:** Ubiquitous
**Requirement:** The hook system shall include base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) plus event-specific fields in every stdin JSON object.
**Traces to:** overview.md §4.1

### HOOK-063
**Type:** Event-driven
**Requirement:** [Target] When a hook script exits with code 0 and writes valid JSON to stdout, the hook system shall parse the JSON and the caller shall apply the contained decisions and modifications to the operation.
**Traces to:** overview.md §4.2, §4.3
<!-- R1-12: Parsing happens in HookRunner, but application depends on callers (currently fire-and-forget for most events). Marked [Target] for the "apply" portion. -->

### HOOK-064
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and writes non-JSON text to stdout, the hook system shall treat it as `decision: 'allow'` with no modifications and convert the stdout text to a `systemMessage`.
**Traces to:** overview.md §4.2; hookRunner.ts `convertPlainTextToHookOutput()`
<!-- R1-12: Parsing is current behavior. Application of systemMessage is [Target] — see HOOK-030. -->

### HOOK-065
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and writes nothing to stdout, the hook system shall treat it as "allow with no modifications."
**Traces to:** overview.md §4.2
<!-- R1-14: Fixed trace — was "overview.md §" (missing section number). -->

### HOOK-066
**Type:** Event-driven
**Requirement:** When a hook script exits with code 2, the hook system shall treat it as a block/deny decision for the associated operation. Stdout is not parsed for JSON on exit code 2 — only stderr is used (see HOOK-067).
**Traces to:** overview.md §4.3; Canonical Exit-Code Precedence Table (§35)
<!-- R1-06: Clarified that stdout JSON is NOT parsed on exit code 2. -->

### HOOK-067a
**Type:** Event-driven
**Requirement:** When a hook script exits with code 2 and stderr is non-empty, the hook system shall use stderr content as the blocking reason via `convertPlainTextToHookOutput()`, producing `{ decision: 'deny', reason: <stderr_text> }`.
**Traces to:** overview.md §4.4; Canonical Exit-Code Precedence Table (§35)
<!-- R1-06: Corrected — exit code 2 never parses stdout JSON. Stderr is the sole source of the blocking reason. -->
<!-- R1-26: Captures the stderr-as-reason behavior. -->
<!-- R3-18: Split from HOOK-067 — this is the current (non-empty stderr) behavior. -->

### HOOK-067b
**Type:** Event-driven
**Requirement:** [Target] When a hook script exits with code 2 and stderr is empty (including the case where both stdout and stderr are empty), the hook system shall produce a blocking output with `decision: 'deny'` and a default reason string (e.g., `"Blocked by hook"`). In the current codebase, this edge case produces `output: undefined` because the stderr branch (`exitCode !== EXIT_CODE_SUCCESS && stderr.trim()`) is not entered when stderr is empty — `stderr.trim()` is falsy. The rewrite shall fix this to ensure exit code 2 always produces a blocking result regardless of stderr content.
**Traces to:** overview.md §4.4; Canonical Exit-Code Precedence Table (§35)
<!-- R3-18: Split from HOOK-067 — this is the target (empty stderr fix) behavior. -->
<!-- R4-02: Merged HOOK-197 into this requirement. HOOK-197 covered the "both stdout and stderr empty" subcase, which is subsumed by the "stderr is empty" condition here. -->

### HOOK-068
**Type:** Event-driven
**Requirement:** When a hook script exits with any code other than 0 or 2, the hook system shall treat the hook as failed, log a warning, and proceed with the operation (fail-open).
**Traces to:** overview.md §4.3; Canonical Exit-Code Precedence Table (§35)

### HOOK-069
**Type:** Ubiquitous
**Requirement:** The hook system shall capture stderr output from hook scripts for logging and diagnostics, and shall never parse stderr for decisions.
**Traces to:** overview.md §4.4

### HOOK-070
**Type:** Ubiquitous
**Requirement:** The hook system shall mark `success: true` only for exit code 0 in `HookExecutionResult`. Exit code 2, exit code 1, any other non-zero exit code, and exit code `null` (signal-killed) all produce `success: false` via the expression `exitCode === EXIT_CODE_SUCCESS` (see HOOK-196). In particular, exit code 2 produces `success: false` even though it represents an intentional block decision — the `success` field reflects execution health, not policy outcome (see HOOK-160, HOOK-213).
**Traces to:** overview.md §7.2 "Exit code 2 and success semantics"; Canonical Exit-Code Precedence Table (§35)
<!-- R2-18: Clarified interaction with signal-killed processes — success is independently computed from exitCode field mapping. -->
<!-- R3-03: Fixed — now explicitly mentions exit code 2 and all other non-zero codes producing `success: false`, not just exit code `null`. -->

---

## 9. Stable Hook API Data Formats

### HOOK-071
**Type:** Ubiquitous
**Requirement:** The hook system shall present LLM data to scripts in a stable, SDK-version-independent format using the `LLMRequest` and `LLMResponse` types defined in `hookTranslator.ts`.
**Traces to:** overview.md §5

### HOOK-072
**Type:** Ubiquitous
**Requirement:** The `LLMRequest` format shall include `model`, `messages` (array with `role` and `content`), `config` (temperature, maxOutputTokens, topP, topK, etc.), and `toolConfig` (mode, allowedFunctionNames).
**Traces to:** overview.md §5.1

### HOOK-073
**Type:** Ubiquitous
**Requirement:** The `LLMResponse` format shall include `text`, `candidates` (with content parts, finishReason, index, safetyRatings), and `usageMetadata`.
**Traces to:** overview.md §5.2

### HOOK-074
**Type:** Ubiquitous
**Requirement:** The `HookToolConfig` format shall include `mode` (`"AUTO"`, `"ANY"`, `"NONE"`) and `allowedFunctionNames` (array of strings).
**Traces to:** overview.md §5.3

---

## 10. Data Translation

### HOOK-075
**Type:** Ubiquitous
**Requirement:** The `HookTranslatorGenAIv1.toHookLLMRequest()` shall extract only text content from message parts and filter out non-text parts (images, function calls, function responses, inline data, file data). This is intentionally lossy for v1 — non-text parts are dropped, not preserved.
**Traces to:** overview.md §5 "Lossy translation caveat"; technical-overview.md §7.3
<!-- R2-05: Added explicit note that non-text filtering is intentional and lossy per spec. -->

### HOOK-076
**Type:** Event-driven
**Requirement:** When a message has no text content after filtering, the translator shall drop that message entirely from the `LLMRequest.messages` array.
**Traces to:** overview.md §5 "Lossy translation caveat"

### HOOK-077
**Type:** Ubiquitous
**Requirement:** The `HookTranslatorGenAIv1.toHookLLMResponse()` shall extract only text parts from candidate content and simplify safety ratings by stripping the `blocked` field. **Implementer note:** The TypeScript `LLMResponse` type in `hookTranslator.ts` still declares `blocked?: boolean` on `safetyRatings` entries, but the runtime `toHookLLMResponse()` implementation strips it during conversion. Ensure the type is updated to match runtime behavior, or add a code comment documenting the intentional omission.
**Traces to:** overview.md §5 "Lossy translation caveat"; technical-overview.md §7.3
<!-- R2-41: Added implementer note about type/runtime mismatch for `blocked` field. Verified: hookTranslator.ts line 54 declares `blocked?: boolean` in the type, but toHookLLMResponse() at line 289 strips it during mapping. -->

### HOOK-078
**Type:** Event-driven
**Requirement:** When `fromHookLLMRequest()` is called, the translator shall accept a `baseRequest` parameter and preserve SDK fields from the original request that the hook format cannot represent (e.g., `tools`, `systemInstruction`, non-text content parts).
**Traces to:** overview.md §5 "Lossy translation caveat"; technical-overview.md §7.3

### HOOK-079
**Type:** Event-driven
**Requirement:** When `fromHookLLMResponse()` is called, the translator shall reconstruct a `GenerateContentResponse` from text parts only; non-text parts from the original response shall not be preserved.
**Traces to:** technical-overview.md §7.3

---

## 11. Configuration

### HOOK-080
**Type:** Ubiquitous
**Requirement:** The hook system shall support the `hooks` configuration key in `settings.json` mapping event names to arrays of hook group definitions.
**Traces to:** overview.md §6.2

### HOOK-081
**Type:** Ubiquitous
**Requirement:** The hook system shall support five event names for the rewrite scope: `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, and `BeforeToolSelection`. The `HookEventName` enum defines additional events (`BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`, `Notification`) that are accepted in configuration but are outside the scope of this rewrite; hooks configured for those events will be registered and executed but their outputs will not be applied by callers.
**Traces to:** overview.md §6.2
<!-- R1-47: Clarified that out-of-scope events are accepted (not blocked) but outputs are not applied. -->

### HOOK-082
**Type:** Ubiquitous
**Requirement:** The hook group definition shall support optional `matcher` (regex pattern), optional `sequential` (boolean, default `false`), and required `hooks` (array of command configurations).
**Traces to:** overview.md §6.2

### HOOK-083
**Type:** Ubiquitous
**Requirement:** The hook command configuration shall require `type` and `command`. The `type` field shall be validated as `"command"` or `"plugin"` by the registry (see HOOK-191). An optional `timeout` (milliseconds, default 60000) is also supported. Note: the `HookType` enum currently defines only `Command`; the `"plugin"` value is accepted by validation but has no execution path in the runner (see HOOK-195). No `PluginHookConfig` type exists; only `CommandHookConfig` is defined.
**Traces to:** overview.md §6.2; hookRegistry.ts `validateHookConfig()`
<!-- R1-48: Noted the asymmetry between validation acceptance and execution support for plugin type. -->
<!-- R2-07: Added note that no PluginHookConfig type exists and only CommandHookConfig is defined. -->

### HOOK-084
**Type:** Ubiquitous
**Requirement:** The `hooks` configuration shall be supported at project (`.llxprt/settings.json`), user (`~/.llxprt/settings.json`), and system scope, merged by the Config layer before reaching the hook system.
**Traces to:** overview.md §6.4

### HOOK-085
**Type:** Ubiquitous
**Requirement:** The hook registry shall tag all hooks from `config.getHooks()` as `ConfigSource.Project` and all hooks from active extensions as `ConfigSource.Extensions`.
**Traces to:** overview.md §6.3; hookRegistry.ts `processHooksFromConfig()`

### HOOK-086
**Type:** Ubiquitous
**Requirement:** The hook registry shall apply ordering by `ConfigSource` priority when returning hooks for an event. In practice, only two tiers are used: Project (priority 1) and Extensions (priority 4). All hooks from `config.getHooks()` are tagged as `ConfigSource.Project`; all hooks from active extensions are tagged as `ConfigSource.Extensions`. Project hooks always precede Extensions hooks. The `ConfigSource` enum also defines `User` (priority 2) and `System` (priority 3) levels, but no production code path currently assigns hooks to these sources — they exist for forward compatibility only and are not exercised by `processHooksFromConfig()`.
**Traces to:** overview.md §6.3; hookRegistry.ts `getSourcePriority()`, `processHooksFromConfig()`
<!-- R1-23: Captured source-priority ordering with specific numeric values matching source code. -->
<!-- R2-22: Clarified that User and System sources are never assigned in production. Only Project and Extensions are used by `processHooksFromConfig()`. -->
<!-- R3-20: Fixed precedence wording to reflect two-tier reality (Project + Extensions only). Four-tier enum exists but only two tiers are used in production. -->

---

## 12. Matcher & Deduplication

### HOOK-087
**Type:** Event-driven
**Requirement:** When a hook entry has a `matcher` string, the hook planner shall treat it as a regular expression and test it against the `tool_name`.
**Traces to:** overview.md §6.2; hookPlanner.ts `matchesToolName()`

### HOOK-088
**Type:** Unwanted behavior
**Requirement:** If a `matcher` string is not a valid regular expression, then the hook planner shall treat it as a literal string for exact matching (fallback to literal on invalid regex).
**Traces to:** overview.md §6.2; hookPlanner.ts `matchesToolName()` catch block
<!-- R2-37: Added spec trace (overview.md §6.2) alongside source code reference. The fallback-to-literal behavior is implemented in `matchesToolName()` via a try/catch around `new RegExp(matcher)`. -->

### HOOK-089
**Type:** Event-driven
**Requirement:** When a hook entry has no `matcher` or an empty/wildcard matcher, the hook shall match all tools.
**Traces to:** hookPlanner.ts `matchesContext()`

### HOOK-090
**Type:** Event-driven
**Requirement:** When the same command string appears multiple times for the same event after matcher filtering, the hook planner shall execute it only once and keep the first encountered instance (which is from the highest-priority source due to source-priority sorting in HOOK-086).
**Traces to:** overview.md §7.9; hookPlanner.ts `deduplicateHooks()`

### HOOK-091
**Type:** Ubiquitous
**Requirement:** The deduplication key shall be `command:<command_string>` only — it shall not include event name, matcher, timeout, or source. Deduplication applies within a single event's execution plan, after matcher filtering, not across different events. The first occurrence (highest-priority source due to source-priority sorting in HOOK-086) shall be retained and subsequent duplicates shall be discarded.
**Traces to:** overview.md §7.9; hookPlanner.ts `getHookKey()`, `deduplicateHooks()`
<!-- R2-38: Clarified dedup scope — within single event after matcher filtering, not cross-event. Verified: `deduplicateHooks()` is called in `createExecutionPlan()` on the matcher-filtered entries for one event. -->
<!-- R3-05: Merged HOOK-185 into HOOK-091 — HOOK-185 added "first occurrence retained" which is already covered by HOOK-090. Consolidated the command-key dedup details here. -->

---

## 13. Composition & Aggregation — OR-Decision Merge (Tool Events)

### HOOK-092
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a BeforeTool or AfterTool event and any single hook returns a block decision, the aggregated result shall be a block.
**Traces to:** overview.md §7.3 "OR-decision logic"

### HOOK-093
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a tool event, the aggregator shall concatenate all `reason` strings (newline-separated) from all hooks.
**Traces to:** overview.md §7.3

### HOOK-094
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a tool event, the aggregator shall concatenate all `systemMessage` strings.
**Traces to:** overview.md §7.3

### HOOK-095
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a tool event, the aggregator shall concatenate all `additionalContext` strings.
**Traces to:** overview.md §7.3

### HOOK-096
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a tool event, the aggregator shall use OR logic for `suppressOutput` — any `true` value shall win.
**Traces to:** overview.md §7.3

### HOOK-097
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a tool event and any hook returns `continue` = `false`, the aggregated result shall stop the agent.
**Traces to:** overview.md §7.3

---

## 14. Composition & Aggregation — Field-Replacement Merge (Model Events)

### HOOK-098
**Type:** Event-driven
**Requirement:** When multiple hooks fire for a BeforeModel or AfterModel event, the aggregator shall shallow-merge `hookSpecificOutput` across hooks, with later hook outputs overriding earlier ones for the same fields. This merge strategy applies regardless of whether hooks execute in parallel or sequentially.
**Traces to:** overview.md §7.3 "field-replacement logic"; hookAggregator.ts `mergeWithFieldReplacement()`
<!-- R1-46: Removed "in parallel" qualifier — aggregator merge strategy applies to all execution modes. -->

---

## 15. Composition & Aggregation — Union Merge (Tool Selection)

### HOOK-099
**Type:** Event-driven
**Requirement:** When multiple hooks fire for BeforeToolSelection, the aggregator shall union (combine) all `allowedFunctionNames` from all hooks.
**Traces to:** overview.md §7.3 "union logic"; hookAggregator.ts `mergeToolSelectionOutputs()`
<!-- R1-45: Multi-hook union behavior for tool selection is captured here (complements single-hook HOOK-055). -->

### HOOK-100
**Type:** Event-driven
**Requirement:** When multiple hooks fire for BeforeToolSelection, the aggregator shall resolve mode by most-restrictive-wins: `NONE` > `ANY` > `AUTO`.
**Traces to:** overview.md §7.3; hookAggregator.ts `mergeToolSelectionOutputs()`

### HOOK-101
**Type:** Event-driven
**Requirement:** When any BeforeToolSelection hook specifies mode `NONE`, the aggregated result shall have mode `NONE` and an empty `allowedFunctionNames` list, regardless of other hooks' outputs.
**Traces to:** overview.md §7.3; overview.md §8.1

### HOOK-102
**Type:** Ubiquitous
**Requirement:** The aggregator shall sort `allowedFunctionNames` alphabetically for deterministic behavior.
**Traces to:** overview.md §7.3; hookAggregator.ts `mergeToolSelectionOutputs()`

---

## 16. Sequential Chaining

### HOOK-103
**Type:** State-driven
**Requirement:** While a hook group has `sequential: true`, the hooks in that group shall execute in array order, one at a time.
**Traces to:** overview.md §7.4

### HOOK-104
**Type:** Event-driven
**Requirement:** When hooks execute sequentially and a hook succeeds (`success: true`, i.e., exit code 0) with non-empty output, that hook's output shall be applied to the input before passing it to the next hook via `applyHookOutputToInput()`. If a hook does not succeed or produces no output, the input shall be passed unchanged to the next hook.
**Traces to:** overview.md §7.4; hookRunner.ts `executeHooksSequential()`
<!-- R4-03: Added `success` precondition — source code gates chaining on `result.success && result.output`. Without the success guard, a failed hook's partial output could corrupt the chain. -->

### HOOK-105
**Type:** Event-driven
**Requirement:** When hooks execute sequentially for BeforeModel, a modified `llm_request` from one hook shall become the `llm_request` for the next hook via shallow merge.
**Traces to:** overview.md §7.4; hookRunner.ts `applyHookOutputToInput()` BeforeModel case

### HOOK-106
**Type:** Event-driven
**Requirement:** [Target] When hooks execute sequentially for BeforeTool, a modified `tool_input` from one hook shall replace the `tool_input` for the next hook.
**Traces to:** overview.md §7.4; overview.md §3.1 "Modify tool input" note
<!-- R1-08: applyHookOutputToInput() has no BeforeTool branch. Marked [Target]. -->

### HOOK-107
**Type:** Event-driven
**Requirement:** [Target] When any hook in a sequential chain returns a block decision, the remaining hooks in the chain shall not execute.
**Traces to:** overview.md §7.4
<!-- R1-07: executeHooksSequential() does not currently check blocking decisions or break from the loop. Marked [Target]. -->

### HOOK-108
**Type:** State-driven
**Requirement:** While `sequential` is `false` (the default), all hooks for an event shall execute concurrently and their outputs shall be aggregated after all complete.
**Traces to:** overview.md §7.4

### HOOK-109
**Type:** Event-driven
**Requirement:** When any hook group for an event has `sequential: true`, the hook planner shall set `sequential: true` on the entire execution plan, causing all hooks for that event to run sequentially regardless of other groups' settings. Verified in source: `deduplicatedEntries.some(entry => entry.sequential === true)`.
**Traces to:** overview.md §7.4; hookPlanner.ts `createExecutionPlan()`
<!-- R1-22: Captured the sequential-escalation rule from hookPlanner. -->
<!-- R3-04: Merged HOOK-186 into HOOK-109 — both described sequential-escalation. HOOK-186 retired. -->

---

## 17. Error Handling & Resilience

### HOOK-110
**Type:** Ubiquitous
**Requirement:** The hook system shall never allow a hook failure to prevent tool execution or model calls — the only way to block is an explicit block decision (exit code 2 or `decision: 'block'|'deny'` on exit code 0). See the Canonical Exit-Code Precedence Table (§35) for complete exit-code-to-behavior mapping.
**Traces to:** overview.md §7.2; technical-overview.md §9.2
<!-- R1-34: Retained as the summary invariant. Per-event fail-open requirements (HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060) provide event-specific testable detail. R1-43: Clarified "decision block/deny on exit code 0". -->
<!-- R2-21: Cross-references canonical exit-code table. -->

### HOOK-111
**Type:** Ubiquitous
**Requirement:** The hook system shall never throw exceptions to callers — every public function in the trigger layer shall catch all exceptions and return a safe default.
**Traces to:** technical-overview.md §9.2

### HOOK-112
**Type:** Event-driven
**Requirement:** When 3 hooks run and 1 fails, the hook system shall aggregate and return the outputs of the 2 successful hooks (partial success preservation).
**Traces to:** technical-overview.md §9.2

### HOOK-113
**Type:** Event-driven
**Requirement:** When a hook infrastructure error occurs (HookSystem init failure, planner error), the `fire*Event()` method shall catch it, log at warn level via `DebugLogger`, and return an empty success result with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`.
**Traces to:** technical-overview.md §9.1
<!-- R2-04: Fixed factual error — `safeExecuteEvent()` (now `fire*Event()` try/catch) returns empty result with `success: true` on catch, not `success: false`. The `success: true` on infrastructure error reflects that the hook system did not *fail to execute hooks* — it failed to set up, and the safe default is to allow the operation (fail-open). -->

### HOOK-114
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and stdout contains invalid JSON, the hook system shall treat stdout as a plain-text `systemMessage` and proceed with `decision: 'allow'`.
**Traces to:** overview.md §9 table; hookRunner.ts `convertPlainTextToHookOutput()`

### HOOK-115
**Type:** Event-driven
**Requirement:** When `fireBeforeToolHook` encounters any uncaught exception, it shall return `undefined` (safe default allowing the tool to proceed).
**Traces to:** technical-overview.md §9.1, §5.1

### HOOK-116
**Type:** Event-driven
**Requirement:** When `fireBeforeModelHook` encounters any uncaught exception, it shall return `{ blocked: false }` (safe default allowing the model call to proceed).
**Traces to:** technical-overview.md §9.1, §5.2

---

## 18. Timeout Enforcement

### HOOK-117
**Type:** Event-driven
**Requirement:** When a hook script exceeds its configured timeout, the hook system shall send `SIGTERM` to the script process.
**Traces to:** overview.md §7.7; hookRunner.ts timeout handling
<!-- R1-24: Covered by HOOK-117/118/119 as a group. -->

### HOOK-118
**Type:** Event-driven
**Requirement:** When a hook script has not exited 5 seconds after receiving `SIGTERM`, the hook system shall send `SIGKILL`.
**Traces to:** overview.md §7.7; hookRunner.ts timeout handling
<!-- R1-24: Captured SIGTERM→SIGKILL escalation with 5s delay. -->

### HOOK-119
**Type:** Event-driven
**Requirement:** When a hook script is killed due to timeout, the hook system shall treat it as an error (fail-open) and log a warning including the timeout duration.
**Traces to:** overview.md §7.7

### HOOK-120
**Type:** Ubiquitous
**Requirement:** The default hook timeout shall be 60,000 milliseconds (60 seconds).
**Traces to:** overview.md §6.2; hookRunner.ts `DEFAULT_HOOK_TIMEOUT`

---

## 19. Environment Variables

### HOOK-121 *(merged into HOOK-188)*
This requirement has been merged into HOOK-188, which consolidates all environment variable injection requirements. ID retained for traceability.
<!-- R1-25: Original finding. -->
<!-- R3-06: Merged into HOOK-188 — HOOK-188 already consolidates HOOK-121/122/123 with parent-env inheritance detail. -->

### HOOK-122 *(merged into HOOK-188)*
This requirement has been merged into HOOK-188. ID retained for traceability.
<!-- R3-06: Merged into HOOK-188 — duplicate of GEMINI_PROJECT_DIR env var injection. -->

### HOOK-123 *(merged into HOOK-188)*
This requirement has been merged into HOOK-188. ID retained for traceability.
<!-- R3-06: Merged into HOOK-188 — duplicate of CLAUDE_PROJECT_DIR env var injection. -->

### HOOK-124 *(merged into HOOK-188)*
This requirement has been merged into HOOK-188. Command-string variable expansion is now covered in HOOK-188. ID retained for traceability.
<!-- R3-06: Merged into HOOK-188. -->

---

## 20. Mode Independence

### HOOK-125
**Type:** Ubiquitous
**Requirement:** The hook system shall not read from or depend on the process's TTY state — hook behavior shall be identical regardless of invocation mode: interactive (default TTY), non-interactive (`--prompt`), headless (`--headless`), or piped input/output. The hook system shall not depend on TTY availability or user interaction for any hook behavior.
**Traces to:** overview.md §7.5
<!-- R1-41: Reworded from "behave identically" to observable: "shall not read from or depend on the process's TTY state". -->
<!-- R2-40: Merged HOOK-126 into HOOK-125. HOOK-126 said "shall not depend on TTY availability or user interaction" — same constraint as HOOK-125 but less specific. Consolidated into one requirement. HOOK-126 ID retired (see note below). -->

### HOOK-126 *(merged into HOOK-125)*
This requirement has been merged into HOOK-125. The original text ("The hook system shall not depend on TTY availability or user interaction for any hook behavior") is a subset of HOOK-125's constraint. ID retained for traceability.
<!-- R2-40: Consolidated duplicate. -->

---

## 21. Caller Integration — Tool Pipeline

### HOOK-127
**Type:** Ubiquitous
**Requirement:** The rewritten `fireBeforeToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`.
**Traces to:** technical-overview.md §5.1
<!-- R1-33: Retained. HOOK-150 provides the full parameter signature; HOOK-127 specifies the return-type change from void. Both contribute distinct testable properties. -->

### HOOK-128
**Type:** Ubiquitous
**Requirement:** The rewritten `fireAfterToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`.
**Traces to:** technical-overview.md §5.1
<!-- R1-33: Retained. HOOK-151 provides the full parameter signature; HOOK-128 specifies the return-type change from void. -->

### HOOK-129
**Type:** Event-driven
**Requirement:** [Target] When `coreToolScheduler` receives a blocked BeforeTool result, it shall treat the block as a completed tool invocation that produced an error-like result, set status to `idle`, buffer the blocked result, and publish it so the model sees the block reason.
**Traces to:** technical-overview.md §5.1 "Scheduler status mapping"
<!-- R2-10: Marked [Target] — scheduler never receives hook results today. Requires HOOK-127/128/134 first. -->

### HOOK-130
**Type:** Ubiquitous
**Requirement:** [Target] The scheduler shall not retry blocked tool calls — the model shall decide how to proceed based on the block reason.
**Traces to:** technical-overview.md §5.1 "Scheduler status mapping"
<!-- R2-10: Marked [Target] — scheduler blocked-tool handling not implemented. Requires HOOK-127/128/134 first. -->

### HOOK-131
**Type:** Event-driven
**Requirement:** [Target] When `afterOutput.systemMessage` is present, the caller shall append it to `toolResult.llmContent` as a system-role annotation using the format `"\n\n[System] " + systemMessage`.
**Traces to:** technical-overview.md §6.1 "systemMessage Application Contract"
<!-- R1-16: The "\n\n[System] " format is defined in technical-overview.md, not overview.md. Trace is correct. -->
<!-- R1-09: systemMessage injection is target behavior. Marked [Target]. -->

### HOOK-132
**Type:** Event-driven
**Requirement:** [Target] When `afterOutput.suppressOutput` is `true`, the caller shall set `toolResult.suppressDisplay = true` so the result is sent to the LLM but not displayed to the user.
**Traces to:** technical-overview.md §5.1 step 10
<!-- R1-10: No display-integration logic exists. Marked [Target]. -->

### HOOK-133
**Type:** Ubiquitous
**Requirement:** The `executeToolWithHooks` wrapper shall accept `(config, toolName, toolInput, executeFn)` and return `Promise<ToolResult>`, encapsulating the full before→execute→after lifecycle.
**Traces to:** technical-overview.md §5.1

### HOOK-134
**Type:** Ubiquitous
**Requirement:** [Target] No caller shall use `void` prefix on any hook trigger call — every caller shall `await` the result and apply it.
**Traces to:** technical-overview.md §13 invariant 4
<!-- R2-11: Marked [Target] — this is the central behavioral change of the rewrite. Currently ALL callers use `void` prefix (verified: geminiChat.ts and coreToolScheduler.ts both use `void trigger*Hook()`). -->

---

## 22. Caller Integration — Model Pipeline

### HOOK-135
**Type:** Ubiquitous
**Requirement:** The rewritten `fireBeforeModelHook` shall return `Promise<BeforeModelHookResult>` with fields `blocked`, `reason`, `syntheticResponse`, and `modifiedRequest`.
**Traces to:** technical-overview.md §5.2, §7.1

### HOOK-136
**Type:** Ubiquitous
**Requirement:** The rewritten `fireAfterModelHook` shall return `Promise<AfterModelHookResult>` with field `response` (either the modified or original `GenerateContentResponse`).
**Traces to:** technical-overview.md §5.2, §7.1

### HOOK-137
**Type:** Ubiquitous
**Requirement:** The rewritten `fireBeforeToolSelectionHook` shall return `Promise<BeforeToolSelectionHookResult>` with optional fields `toolConfig` and `tools`.
**Traces to:** technical-overview.md §5.2, §7.1

### HOOK-138
**Type:** Event-driven
**Requirement:** When `fireBeforeModelHook` returns `blocked: true` with a `syntheticResponse`, the caller (`geminiChat.ts`) shall skip the streaming API call entirely and yield the synthetic response directly.
**Traces to:** technical-overview.md §11.1 "BeforeModel blocking and streaming"

### HOOK-139
**Type:** Event-driven
**Requirement:** When `fireBeforeModelHook` returns a `modifiedRequest`, the caller shall use the modified `GenerateContentParameters` for the streaming API call.
**Traces to:** technical-overview.md §11.1 "BeforeModel request modification and streaming"

### HOOK-140
**Type:** Event-driven
**Requirement:** When `fireBeforeToolSelectionHook` returns a `toolConfig`, the caller shall apply it to the request's tool configuration.
**Traces to:** technical-overview.md §6.2

### HOOK-141
**Type:** Ubiquitous
**Requirement:** The callers shall deal in SDK types (`GenerateContentParameters`, `GenerateContentResponse`) and shall never touch `LLMRequest`/`LLMResponse` directly — the translator boundary shall be fully encapsulated within `HookEventHandler` and the output classes.
**Traces to:** technical-overview.md §7.3, §13 invariant 7

---

## 23. New Components

### HOOK-142
**Type:** Ubiquitous
**Requirement:** The `HookSystem` class shall be importable from `packages/core/src/hooks/hookSystem.ts` and shall own `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`.
**Traces to:** technical-overview.md §3.1, §12
<!-- R1-05: Reworded from file path specification to importability. -->

### HOOK-143
**Type:** Ubiquitous
**Requirement:** The `HookEventHandler` class shall be importable from `packages/core/src/hooks/hookEventHandler.ts` and shall expose `fireBeforeToolEvent`, `fireAfterToolEvent`, `fireBeforeModelEvent`, `fireAfterModelEvent`, and `fireBeforeToolSelectionEvent` methods.
**Traces to:** technical-overview.md §3.2, §12
<!-- R1-05: Reworded from file path specification to importability. -->

### HOOK-144
**Type:** Ubiquitous
**Requirement:** The `HookEventHandler` shall build `HookInput` payloads with base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) sourced from the `Config` object.
**Traces to:** technical-overview.md §3.2 step 1

### HOOK-145
**Type:** Event-driven
**Requirement:** When the execution plan is `null` (no matching hooks), the `HookEventHandler` shall return an empty success `AggregatedHookResult` with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`.
**Traces to:** technical-overview.md §3.2 "Empty result shape"

### HOOK-146
**Type:** Ubiquitous
**Requirement:** The `HookEventHandler` shall log telemetry at debug level for every event fire, including event name, hook count, total duration, and success/failure.
**Traces to:** technical-overview.md §10

### HOOK-147
**Type:** Ubiquitous
**Requirement:** The `HookEventHandler` shall wrap its entire `fire*Event()` body in try/catch and, on error, log a warning and return the empty success result (see HOOK-113 and HOOK-145) — never propagating exceptions.
**Traces to:** technical-overview.md §3.2 "Error handling"

### HOOK-148
**Type:** Ubiquitous
**Requirement:** [Target] The `HookSystemNotInitializedError` shall be a new error class introduced in `hookSystem.ts`, mirroring the existing `HookRegistryNotInitializedError` pattern. This class does not exist in the current codebase.
**Traces to:** technical-overview.md §3.1
<!-- R3-11: Marked [Target] — `HookSystemNotInitializedError` does not exist in current code. Only `HookRegistryNotInitializedError` exists. -->

### HOOK-149
**Type:** Ubiquitous
**Requirement:** [Target] The `ToolResult` type shall support an optional `suppressDisplay?: boolean` field so that AfterTool hooks can suppress display while preserving the LLM-facing content. The current `ToolResult` interface (in `tools.ts`) has fields `llmContent`, `returnDisplay`, `metadata?`, and `error?` — no `suppressDisplay` field exists. This field must be added as part of the rewrite. Same pattern as HOOK-029 (AfterTool suppressOutput) and HOOK-132 (caller sets suppressDisplay).
**Traces to:** technical-overview.md §5.1 step 10
<!-- R4-01: Added [Target] — `suppressDisplay` does not exist on the current `ToolResult` interface. Verified: tools.ts defines ToolResult with llmContent, returnDisplay, metadata?, error? only. -->

---

## 24. Trigger Function Contracts

### HOOK-150
**Type:** Ubiquitous
**Requirement:** The `fireBeforeToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`.
**Traces to:** technical-overview.md §5.1
<!-- R1-33: HOOK-150 specifies parameter+return contract. HOOK-127 specifies the return-type change from void. Both retained as they serve distinct roles. -->

### HOOK-151
**Type:** Ubiquitous
**Requirement:** The `fireAfterToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>, toolResponse: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`.
**Traces to:** technical-overview.md §5.1

### HOOK-152
**Type:** Ubiquitous
**Requirement:** The `fireBeforeModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeModelHookResult>`.
**Traces to:** technical-overview.md §5.2
<!-- R2-16: Rewritten from non-EARS legacy format to proper EARS Ubiquitous template. Original was marked as "non-EARS legacy format" in the document. -->

### HOOK-153
**Type:** Ubiquitous
**Requirement:** The `fireAfterModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters, llmResponse: GenerateContentResponse)` and return `Promise<AfterModelHookResult>`.
**Traces to:** technical-overview.md §5.2

### HOOK-154
**Type:** Ubiquitous
**Requirement:** The `fireBeforeToolSelectionHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeToolSelectionHookResult>`.
**Traces to:** technical-overview.md §5.2

---

## 25. Existing Hook Scripts — Backward Compatibility

### HOOK-155
**Type:** Ubiquitous
**Requirement:** The hook system shall not change the stdin JSON format, stdout JSON format, exit code semantics, environment variables, timeout behavior, or sequential chaining behavior visible to hook scripts.
**Traces to:** technical-overview.md §13 invariant 6

### HOOK-156
**Type:** Ubiquitous
**Requirement:** [Target] The rewritten hook system shall honor hook output decisions and modifications (blocking, input modification, context injection, etc.) that the current implementation parses but does not apply.
**Traces to:** technical-overview.md §13 invariant 6
<!-- R1-42: Reworded from narrative "outputs now actually take effect" to testable target requirement. -->

---

## 26. Output Field Contracts

### HOOK-157
**Type:** Ubiquitous
**Requirement:** The common hook output fields shall include `decision` (string or null), `reason` (string), `continue` (boolean), `stopReason` (string), `suppressOutput` (boolean), `systemMessage` (string), and `hookSpecificOutput` (object).
**Traces to:** overview.md §4.2 output table

### HOOK-158
**Type:** Event-driven
**Requirement:** When `decision` is absent or null in a hook's output, the hook system shall treat it as "no decision" (equivalent to allow).
**Traces to:** overview.md §4.2

### HOOK-159
**Type:** Ubiquitous
**Requirement:** The `systemMessage` field shall always be surfaced to the model through the LLM context channel, and shall never be displayed to the user as standalone UI output.
**Traces to:** technical-overview.md §6.1 "systemMessage Application Contract"

### HOOK-160
**Type:** Ubiquitous
**Requirement:** The `success` field on `AggregatedHookResult` shall represent hook execution health, not policy outcome — callers shall check `finalOutput.isBlockingDecision()` for policy decisions. See HOOK-213 and HOOK-214 for detailed semantics and terminology definitions.
**Traces to:** overview.md §7.2; technical-overview.md §3.2
<!-- R2-07: Removed overstated plugin support claim. This requirement is now purely about success semantics. The original HOOK-160 was about plugin support — that content has been moved to HOOK-195 (plugin type accepted but not executable) and HOOK-083 (plugin validation note). -->
<!-- R3-17/R3-19: Cross-referenced HOOK-213 and HOOK-214 for expanded success vs policy semantics. -->

---

## 27. Transcript Path

### HOOK-161
**Type:** Ubiquitous
**Requirement:** The `transcript_path` base field shall be set to an empty string `''` until `Config` exposes a `getTranscriptPath()` method.
**Traces to:** technical-overview.md §3.2 step 1 "transcript_path design decision"

---

## 28. HookEventHandler Internal Flow

### HOOK-162
**Type:** Event-driven
**Requirement:** When the `HookEventHandler` fires a tool event, it shall pass `{ toolName }` as context to the planner for matcher filtering.
**Traces to:** technical-overview.md §3.2 step 3

### HOOK-163
**Type:** Event-driven
**Requirement:** When the `HookEventHandler` fires a model event, it shall pass `undefined` as context (no matcher) to the planner.
**Traces to:** technical-overview.md §3.2 step 3

### HOOK-164
**Type:** Event-driven
**Requirement:** When the execution plan has `sequential: true`, the `HookEventHandler` shall delegate to `runner.executeHooksSequential()`.
**Traces to:** technical-overview.md §3.2 step 4
<!-- R2-05: This requirement is about execution strategy delegation, not translator behavior. The original HOOK-164 about preserving non-text parts was factually incorrect (specs describe lossy text-only translation) and has been removed. The HOOK-164 ID is reused for this previously unnumbered flow requirement. -->

### HOOK-165
**Type:** Event-driven
**Requirement:** When the execution plan has `sequential: false`, the `HookEventHandler` shall delegate to `runner.executeHooksParallel()`.
**Traces to:** technical-overview.md §3.2 step 4

### HOOK-166
**Type:** Event-driven
**Requirement:** When execution completes, the `HookEventHandler` shall call `aggregator.aggregateResults(results, eventName)` to produce the `AggregatedHookResult`.
**Traces to:** technical-overview.md §3.2 step 5

---

## 29. Tool Selection — applyToolConfigModifications

### HOOK-167
**Type:** Ubiquitous
**Requirement:** The `BeforeToolSelectionHookOutput.applyToolConfigModifications()` shall modify the `toolConfig` (mode and allowedFunctionNames) but shall not filter or remove tool definitions from the `tools` list.
**Traces to:** technical-overview.md §5.2 "Parameter contract note"

### HOOK-168
**Type:** Ubiquitous
**Requirement:** Tool restriction shall work through the `toolConfig.allowedFunctionNames` mechanism, not by removing tool definitions.
**Traces to:** technical-overview.md §5.2 "Parameter contract note"
<!-- R2-06/R2-14: Fixed — removed incorrect claim that dedup key includes matcher/sequential/source. -->
<!-- R3-07: Removed dedup key sentence — that topic is unrelated to tool restriction and is fully covered by HOOK-091. -->

---

## 30. BeforeToolHookOutput Compatibility

### HOOK-169
**Type:** Ubiquitous
**Requirement:** The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecision` as a compatibility field for blocking detection via `isBlockingDecision()`.
**Traces to:** types.ts `BeforeToolHookOutput.isBlockingDecision()`; overview.md §7.3

### HOOK-170
**Type:** Ubiquitous
**Requirement:** The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecisionReason` as a compatibility field for reason extraction via `getEffectiveReason()`.
**Traces to:** types.ts `BeforeToolHookOutput.getEffectiveReason()`

### HOOK-171
**Type:** Ubiquitous
**Requirement:** Hook scripts shall use the top-level `decision` field for reliable blocking — the compatibility `permissionDecision` field is only checked after aggregation and may be missed during multi-hook OR merging.
**Traces to:** overview.md §7.3 "Implementation caveat"

---

## 31. Streaming Constraints

### HOOK-172
**Type:** Ubiquitous
**Requirement:** The AfterModel hook shall fire once per model call, against the complete aggregated response — not per streaming chunk.
**Traces to:** technical-overview.md §11

### HOOK-173
**Type:** Ubiquitous
**Requirement:** AfterModel modifications shall apply to the stored/processed version of the response, not to content already displayed during streaming.
**Traces to:** technical-overview.md §11.1 "AfterModel and response timing"

### HOOK-174
**Type:** Event-driven
**Requirement:** When `fireBeforeModelHook` returns `blocked: true`, the caller shall skip opening any stream and shall not process any streaming chunks.
**Traces to:** technical-overview.md §11.1 "BeforeModel blocking and streaming"

---

## 32. File Manifest & Module Exports

### HOOK-175
**Type:** Ubiquitous
**Requirement:** The `packages/core/src/hooks/index.ts` shall export `HookSystem` and `HookEventHandler`.
**Traces to:** technical-overview.md §12

### HOOK-176
**Type:** Ubiquitous
**Requirement:** The `BeforeModelHookResult`, `AfterModelHookResult`, and `BeforeToolSelectionHookResult` types shall be exported from `geminiChatHookTriggers.ts`.
**Traces to:** technical-overview.md §7.1

---

## 33. Decision Summary Matrix

### HOOK-177
**Type:** Ubiquitous
**Requirement:** The BeforeTool event shall support blocking, tool input modification, and agent stopping.
**Traces to:** overview.md §8 table

### HOOK-178
**Type:** Ubiquitous
**Requirement:** The AfterTool event shall support context injection (`additionalContext`), output suppression, system message injection, and agent stopping — but shall not support blocking or direct output modification.
**Traces to:** overview.md §8 table

### HOOK-179
**Type:** Ubiquitous
**Requirement:** The BeforeModel event shall support blocking (with or without synthetic response), request modification, context injection (add messages), and agent stopping.
**Traces to:** overview.md §8 table

### HOOK-180
**Type:** Ubiquitous
**Requirement:** The AfterModel event shall support response modification, response replacement, output suppression, and agent stopping — but shall not support blocking.
**Traces to:** overview.md §8 table

### HOOK-181
**Type:** Ubiquitous
**Requirement:** The BeforeToolSelection event shall support tool restriction (`allowedFunctionNames`), mode change, and agent stopping — but shall not support blocking, input modification, or output modification.
**Traces to:** overview.md §8 table

---

## 34. New Requirements — Completeness Gaps (R1)

The following requirements were added to address completeness gaps identified
during review round 1. Each is annotated with the review finding that prompted it.

### HOOK-182
**Type:** Ubiquitous
**Requirement:** The `HookDecision` type shall include the value `"ask"`. When a hook returns `decision: "ask"`, the hook system shall treat it as a non-blocking decision (equivalent to `"allow"`). The `"ask"` value is reserved for future use (potential user-prompting behavior) and is not currently distinguished from `"allow"` in any code path.
**Traces to:** overview.md §4.2; types.ts `HookDecision` type
<!-- R1-17: "ask" is in the HookDecision type but had no requirement specifying its semantics. Verified in source: isBlockingDecision() checks only 'block'|'deny', so 'ask' is non-blocking. -->
<!-- R2-27: Added explanation of "ask" purpose — reserved for future use. -->

### HOOK-183
**Type:** Event-driven
**Requirement:** [Target] When a BeforeTool hook blocks execution and the `executeToolWithHooks` wrapper is used, the wrapper shall return a `ToolResult` whose `llmContent` field contains the blocking reason string (from `DefaultHookOutput.getEffectiveReason()`). The caller detects the block by checking `beforeOutput?.isBlockingDecision()` before calling `executeFn()` — there is no `blocked` property on `ToolResult`.
**Traces to:** technical-overview.md §5.1 "Scheduler status mapping"; overview.md §3.1
<!-- R1-18: No requirement described the stop-result structure for executeToolWithHooks. -->
<!-- R3-02: Fixed — removed invented `blocked: true` property on ToolResult. Per tech spec §5.1, callers detect block via `beforeOutput?.isBlockingDecision()` before calling `executeFn()`, and the blocked ToolResult contains the reason in `llmContent`. -->

### HOOK-184
**Type:** Event-driven
**Requirement:** When `fireBeforeModelHook` processes aggregated hook results, both `isBlockingDecision()` and `shouldStopExecution()` (i.e., `continue: false`) shall map to `blocked: true` in the returned `BeforeModelHookResult`. A hook that sets `continue: false` without a blocking decision still produces `blocked: true`.
**Traces to:** technical-overview.md §5.2; overview.md §7.2
<!-- R1-19: Captures the BeforeModel conflation of shouldStopExecution and blocked. -->

### HOOK-185 *(merged into HOOK-091)*
This requirement has been merged into HOOK-091. Both described command-based deduplication with first-occurrence retention. HOOK-090 already specifies first-occurrence behavior; HOOK-091 now consolidates all dedup key details. ID retained for traceability.
<!-- R1-21: Original finding. -->
<!-- R3-05: Merged into HOOK-091 — near-duplicate of command-based dedup. -->

### HOOK-186 *(merged into HOOK-109)*
This requirement has been merged into HOOK-109. Both described sequential-escalation behavior. ID retained for traceability.
<!-- R1-22: Original finding. -->
<!-- R3-04: Merged into HOOK-109 — near-duplicate of sequential-escalation rule. -->

### HOOK-187
**Type:** Ubiquitous
**Requirement:** The hook registry shall sort hooks by source priority when returning hooks for an event. The `getSourcePriority()` function defines a four-tier ordering: Project (1) > User (2) > System (3) > Extensions (4), where a lower number indicates higher priority. However, only two tiers are exercised in production: Project and Extensions. The User and System tiers exist in the `ConfigSource` enum for forward compatibility but have no assignment path in `processHooksFromConfig()`. See HOOK-086 for the production two-tier constraint.
**Traces to:** overview.md §6.3; hookRegistry.ts `getSourcePriority()`
<!-- R1-23: Missing source-priority ordering requirement. Verified against getSourcePriority() in source code. -->
<!-- R2-22: Added cross-reference to HOOK-086 for production source usage. -->
<!-- R3-20: Clarified two-tier reality — four-tier enum exists but only Project and Extensions are assigned in production. -->

### HOOK-188
**Type:** Ubiquitous
**Requirement:** The hook system shall inject the environment variables `LLXPRT_PROJECT_DIR`, `GEMINI_PROJECT_DIR`, and `CLAUDE_PROJECT_DIR` (all set to `input.cwd`) into every hook script's child process environment, inheriting all other environment variables from the parent process via `process.env`. Additionally, the hook system shall support `$LLXPRT_PROJECT_DIR`, `$GEMINI_PROJECT_DIR`, and `$CLAUDE_PROJECT_DIR` variable expansion in the `command` string itself (via `expandCommand()`).
**Traces to:** overview.md §7.6; hookRunner.ts env setup, `expandCommand()`
<!-- R1-25: Missing environment variables requirement. Consolidates HOOK-121/122/123 with parent-env inheritance detail. -->
<!-- R3-06: Now also consolidates HOOK-124 (command-string variable expansion). HOOK-121/122/123/124 retired with merge notes. -->

### HOOK-189
**Type:** Event-driven
**Requirement:** When a hook script exits with code 2 and stderr is non-empty, the hook system shall use the stderr text as the blocking reason by passing it through `convertPlainTextToHookOutput()` with exit code 2, producing `{ decision: 'deny', reason: <stderr_text> }`.
**Traces to:** overview.md §4.3, §4.4; hookRunner.ts `convertPlainTextToHookOutput()`
<!-- R1-26: Missing exit-code-2 stderr-as-reason behavior. Verified in source code. -->

### HOOK-190
**Type:** Ubiquitous
**Requirement:** The hook aggregator shall use three distinct merge strategies based on event type: (1) OR-merge for tool and agent events (BeforeTool, AfterTool, BeforeAgent, AfterAgent, SessionStart) — any block wins, messages concatenated; (2) field-replacement merge for model events (BeforeModel, AfterModel) — later outputs override earlier for same fields; (3) union-merge for tool selection (BeforeToolSelection) — function names unioned, mode resolved by most-restrictive-wins (NONE > ANY > AUTO).
**Traces to:** overview.md §7.3; hookAggregator.ts `mergeOutputs()`
<!-- R1-27: Missing aggregation semantics overview requirement. -->
<!-- Wording fix: Changed "tool events" to "tool and agent events" since BeforeAgent, AfterAgent, SessionStart are not tool events but use the same OR-merge strategy. -->

### HOOK-191
**Type:** Event-driven
**Requirement:** When the hook registry encounters a hook configuration with a `type` field that is not `'command'` or `'plugin'`, or a `type: 'command'` configuration without a `command` field, the registry shall discard the configuration and log a warning via `DebugLogger` at warn level.
**Traces to:** overview.md §6.2; hookRegistry.ts `validateHookConfig()`
<!-- R1-28: Missing hook type validation requirement. Verified against validateHookConfig() in source. -->

### HOOK-192
**Type:** Unwanted behavior
**Requirement:** If a hook script's stdin write produces an `EPIPE` error (because the child process closed stdin early), then the hook system shall suppress the error and continue processing the hook's stdout/stderr output.
**Traces to:** hookRunner.ts stdin error handler
<!-- R1-29: Missing EPIPE error handling requirement. Verified in source: stdin 'error' handler checks err.code !== 'EPIPE'. -->

### HOOK-193
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and writes a JSON string value to stdout (double-encoded JSON), the hook system shall parse the string value again to extract the inner JSON object.
**Traces to:** hookRunner.ts stdout parsing logic
<!-- R1-30: Missing double-encoded JSON handling requirement. Verified in source: `if (typeof parsed === 'string') { parsed = JSON.parse(parsed); }`. -->

### HOOK-194
**Type:** Ubiquitous
**Requirement:** The `BeforeModelHookOutput.getSyntheticResponse()` shall return a `GenerateContentResponse` only when `hookSpecificOutput.llm_response` is present in the hook output. When a hook sets `continue: false` (shouldStopExecution) without providing `llm_response`, `getSyntheticResponse()` shall return `undefined` — it does not auto-generate a stop response. This differs from `AfterModelHookOutput.getModifiedResponse()`, which does auto-generate a synthetic stop response when `shouldStopExecution()` is true.
**Traces to:** technical-overview.md §5.2; types.ts `BeforeModelHookOutput.getSyntheticResponse()`, `AfterModelHookOutput.getModifiedResponse()`
<!-- R1-31: Missing getSyntheticResponse asymmetry requirement. Verified in source code. -->

### HOOK-195
**Type:** Unwanted behavior
**Requirement:** If a hook configuration with `type: 'plugin'` passes registry validation and reaches the hook runner, then the runner shall treat it as an error (fail-open) because no plugin execution path exists. The `HookType` enum defines only `Command`; no `PluginHookConfig` type exists; the `'plugin'` string is accepted by validation for forward compatibility but is not executable.
**Traces to:** hookRegistry.ts `validateHookConfig()`; types.ts `HookType` enum
<!-- R1-48: Plugin type accepted by validator but no execution path. Captures the gap explicitly. -->
<!-- R2-07/R2-13: Clarified that no PluginHookConfig type exists and no end-to-end plugin execution path is available. This is forward-compatibility validation only, not a target feature for the rewrite. -->

### HOOK-196
**Type:** Unwanted behavior
**Requirement:** If a hook script is terminated by an OS signal (exit code `null` from Node.js), then the hook system shall set `success: false` (because `null === 0` is `false`) but shall map the `exitCode` field to `0` in the result (because `null || EXIT_CODE_SUCCESS` evaluates to `0`). This produces a misleading `exitCode: 0` with `success: false`. The `success` field is independently computed via `exitCode === EXIT_CODE_SUCCESS`, which correctly returns `false` for signal-killed processes. The output path follows the `exitCode !== EXIT_CODE_SUCCESS` branch, so if stderr is non-empty, it will be converted to a `systemMessage` via `convertPlainTextToHookOutput()`.
**Traces to:** hookRunner.ts `close` handler; Canonical Exit-Code Precedence Table (§35)
<!-- R1-13: Signal-killed processes documented as current behavior. -->
<!-- R2-02: Fixed factual error — signal-killed processes have `success: false`, not "treated as success". The `exitCode` field misleadingly maps to 0, but `success` is independently computed as `false`. -->
<!-- R2-17: Now consistent with HOOK-031 (fail-open on failure) — signal-kill results in success:false, which is a failure, and fail-open applies. -->
<!-- R2-18: Now consistent with HOOK-070 — success:true only for exitCode 0, and signal-killed has exitCode null (not 0 for success computation). -->

### HOOK-197 *(merged into HOOK-067b)*
This requirement has been merged into HOOK-067b. The "both stdout and stderr empty" subcase of exit code 2 is subsumed by HOOK-067b's "stderr is empty" condition. ID retained for traceability.
<!-- R1-06 (edge case): Exit code 2 + empty stderr = undefined output in current code (not a block). Marked [Target] for fix. -->
<!-- R4-02: Merged into HOOK-067b — near-duplicate. -->

### HOOK-198
**Type:** Event-driven
**Requirement:** When a hook script exits with a non-zero, non-2 exit code and provides stdout JSON containing `decision: 'block'`, the hook system shall ignore the stdout content and treat the hook as failed (fail-open), because stdout JSON is only parsed on exit code 0.
**Traces to:** overview.md §4.3; hookRunner.ts stdout parsing logic; Canonical Exit-Code Precedence Table (§35)
<!-- R1-43: Resolves HOOK-016 vs HOOK-023 interaction — exit code semantics always take precedence over output content. -->

---

## 35. Canonical Exit-Code Precedence Table

This section provides a single authoritative reference for exit-code-to-behavior
mapping, referenced by all per-event and protocol requirements.

| Exit Code | `success` Field | Stdout Parsed? | Stderr Used? | Behavior | Blocking? |
|---|---|---|---|---|---|
| **0** | `true` | Yes (JSON or plain text) | Captured for logging only | Allow; apply JSON decisions/modifications if present | Only if JSON contains `decision: 'block'\|'deny'` |
| **2** | `false` | No | Yes (as blocking reason via `convertPlainTextToHookOutput()`) | Block/deny the operation | Always (explicit block) |
| **2 (empty stderr)** | `false` | No | No (stderr is empty) | **Current:** `output: undefined` (no block produced). **[Target]:** Produce `{ decision: 'deny', reason: <default> }` | **Current:** No. **[Target]:** Yes |
| **1 (or any other non-0/non-2)** | `false` | No | Yes (if non-empty, converted to `systemMessage` warning) | Fail-open — operation proceeds as if hook didn't run | Never |
| **`null` (signal-killed)** | `false` | No (first branch requires `exitCode === 0`) | Yes (if non-empty; `exitCode !== EXIT_CODE_SUCCESS` is `true` for `null`) | Fail-open — `success: false`; `exitCode` field mapped to `0` (misleading). Output depends on stderr content. | Never |
| **Timeout** | `false` | N/A (handled before close event) | Partial capture | Fail-open — treated as error | Never |
| **Process error** | `false` | N/A (child.on('error') handler) | Partial capture | Fail-open — treated as error | Never |

**Key invariants:**
1. Exit code determines behavior, not stdout content. A script emitting `{"decision":"block"}` on stdout but exiting with code 1 is treated as failed (fail-open), not as a block.
2. `success: true` maps exclusively to exit code 0 (via `exitCode === EXIT_CODE_SUCCESS`).
3. Blocking is only possible through exit code 2 or `decision: 'block'|'deny'` in JSON on exit code 0.
4. All failures (non-0/non-2 exit, timeout, signal, process error) result in fail-open behavior.

<!-- R2-21: Created canonical exit-code precedence table to resolve inconsistencies between HOOK-016a, HOOK-023, HOOK-042, HOOK-070, HOOK-196, and HOOK-198. All per-event requirements now cross-reference this table. -->

---

## 36. Additional Completeness Requirements (R2)

The following requirements address completeness gaps identified in review round 2.

### HOOK-199
**Type:** Ubiquitous
**Requirement:** The `BeforeToolHookOutput` class shall support `permissionDecision` and `permissionDecisionReason` as compatibility fields in `hookSpecificOutput`. When `permissionDecision` is `'block'` or `'deny'`, `isBlockingDecision()` shall return `true`. When `permissionDecisionReason` is a string, `getEffectiveReason()` shall return that string in preference to the top-level `reason` field.
**Traces to:** types.ts `BeforeToolHookOutput.isBlockingDecision()`, `BeforeToolHookOutput.getEffectiveReason()`; overview.md §7.3
<!-- R2-23: Missing requirement for BeforeToolHookOutput compatibility fields. Verified in source: types.ts lines 195-215. -->

### HOOK-200
**Type:** Event-driven
**Requirement:** When `createHookOutput('BeforeTool', data)` is called, the factory shall return a `DefaultHookOutput` instance (not `BeforeToolHookOutput`). This means `isBlockingDecision()` on the returned object will not check `hookSpecificOutput.permissionDecision` — only the top-level `decision` field is checked. When the aggregator's `createSpecificHookOutput(output, 'BeforeTool')` is called, it shall return a `BeforeToolHookOutput` instance, which does check `permissionDecision`. This is observable: calling `createHookOutput('BeforeTool', { hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `false`, while `new BeforeToolHookOutput({ hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `true`. Callers that need compatibility field support (HOOK-199) must use the aggregator path, not the factory.
**Traces to:** types.ts `createHookOutput()`; hookAggregator.ts `createSpecificHookOutput()`
<!-- R2-24: Missing requirement for factory function behavior differences. Verified: createHookOutput() has no BeforeTool case (falls to default), while createSpecificHookOutput() maps BeforeTool to BeforeToolHookOutput. -->
<!-- R3-21: Rewritten from documentation-style to testable observable — now specifies concrete input/output assertions. -->

### HOOK-201
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and writes a double-encoded JSON string to stdout (a JSON string containing a JSON object), the hook system shall detect that the parsed result is a string, parse it a second time, and use the inner JSON object as the hook output.
**Traces to:** hookRunner.ts stdout parsing logic
<!-- R2-25: Missing double-encoded JSON handling requirement. This complements HOOK-193 with more detail. Verified in source: `if (typeof parsed === 'string') { parsed = JSON.parse(parsed); }`. -->

### HOOK-202
**Type:** Event-driven
**Requirement:** [Target] When a BeforeModel hook returns `blocked: true` with `syntheticResponse: undefined` (i.e., block without providing a synthetic response), the caller shall skip the model call and provide an empty/error response to the agent. The specific empty response format shall be: a `GenerateContentResponse` with an empty candidates array or a single candidate with empty content, allowing the agent to detect that no model output was produced.
**Traces to:** overview.md §3.3 "Block without response"; technical-overview.md §5.2
<!-- R2-26: Missing concrete requirement for block-without-response caller behavior. Made testable with specific response format. -->

### HOOK-203
**Type:** Ubiquitous
**Requirement:** The hook system shall accept, register, and execute hooks configured for out-of-scope events (`SessionStart`, `SessionEnd`, `Notification`, `PreCompress`, `BeforeAgent`, `AfterAgent`). Hook scripts for these events shall receive stdin JSON, execute normally, and produce stdout/stderr. However, no caller in the rewrite scope shall `await` or apply results from these events — their outputs are discarded. This constitutes non-regression: these events must continue to fire as they do today (fire-and-forget).
**Traces to:** overview.md §6.2; technical-overview.md §3.2
<!-- R2-28: Missing non-regression requirements for out-of-scope events. Ensures the rewrite doesn't break existing out-of-scope hook execution. -->

### HOOK-204
**Type:** Event-driven
**Requirement:** [Target] When `coreToolScheduler` receives a blocked BeforeTool result (via HOOK-129), the scheduler shall transition the tool's status from `executing` to `idle`, store the blocked result in its buffer, and publish the result. The scheduler shall not re-queue or retry the blocked tool — the block is a terminal outcome for that tool invocation.
**Traces to:** technical-overview.md §5.1 "Scheduler status mapping"
<!-- R2-29: Missing scheduler state handling for blocked tools. Complements HOOK-129/130 with state transition details. -->

### HOOK-205
**Type:** Event-driven
**Requirement:** [Target] When a `BeforeToolSelection` event fires, the `HookEventHandler` shall translate the `GenerateContentParameters` to `LLMRequest` via `defaultHookTranslator.toHookLLMRequest()` and include it in the `BeforeToolSelectionInput`. The caller shall pass the actual `GenerateContentParameters` (not a placeholder) to the trigger function.
**Traces to:** technical-overview.md §3.2; overview.md §3.5
<!-- R2-30: Missing BeforeToolSelection translator wiring requirement. Ensures the event handler properly translates the request. -->

### HOOK-206
**Type:** Event-driven
**Requirement:** When the first hook event fires, the trigger function shall call `hookSystem.initialize()` before delegating to the event handler (see HOOK-008). Construction of the `HookSystem` itself (in `Config.getHookSystem()`) shall not call `initialize()` — initialization is deferred to the first event fire. This ensures zero startup overhead: constructing `Config` with `enableHooks: true` does not read hook configuration files or allocate registry entries until a hook event actually fires.
**Traces to:** technical-overview.md §4.2; overview.md §7.1
<!-- R2-31: Missing trigger-function-performs-init requirement. Clarifies that init is lazy (in trigger functions), not eager (in constructors). -->

### HOOK-207
**Type:** Unwanted behavior
**Requirement:** If a stream aborts before the complete `GenerateContentResponse` is assembled (e.g., network error, timeout, or user cancellation), then the AfterModel hook shall not fire for that model call. The hook system fires AfterModel only after a complete response is available (per HOOK-050). Callers shall handle the stream error through normal error handling paths, not through the hook system.
**Traces to:** technical-overview.md §11, §11.1
<!-- R2-34: Missing stream-abort behavior requirement for AfterModel. -->

### HOOK-208
**Type:** Event-driven
**Requirement:** When multiple AfterTool hooks return `additionalContext`, `systemMessage`, and `suppressOutput` simultaneously, the aggregated result shall include all three effects: (1) `additionalContext` strings concatenated (newline-separated), (2) `systemMessage` strings concatenated (newline-separated), (3) `suppressOutput` set to `true` if any hook returned `true`. These effects are independent and apply in parallel — there is no precedence or ordering between them.
**Traces to:** overview.md §7.3; hookAggregator.ts `mergeWithOrDecision()`
<!-- R2-20: Missing combined-effects precedence/ordering requirement for HOOK-027/030/029. Verified in hookAggregator: all three fields are collected independently and concatenated/OR'd. -->

---

## 37. Rewrite Scope Boundary

The `HookEventName` enum defines 11 events. This rewrite covers end-to-end
caller integration (await + apply) for **5 events**: `BeforeTool`, `AfterTool`,
`BeforeModel`, `AfterModel`, and `BeforeToolSelection`. The remaining 6 events
(`BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`,
`Notification`) are **out of scope** for caller integration — they continue to
fire-and-forget as they do today (see HOOK-203). Requirements in this document
that use universal "hook system shall..." wording apply to all 11 events only
when they describe internal hook-system behavior (parsing, aggregation,
dedup, timeouts, env vars). Requirements that describe end-to-end effects
(blocking, input/output modification, suppression, agent termination) apply
only to the 5 in-scope events unless explicitly marked otherwise.

<!-- R3-22: Added explicit scope boundary section to clarify which events are rewrite vs unchanged. -->

---

## 38. Additional Completeness Requirements (R3)

The following requirements address completeness gaps identified in review round 3.
Each is annotated with the review finding that prompted it.

### HOOK-209
**Type:** Event-driven
**Requirement:** When a hook script exits with a non-zero, non-2 exit code (e.g., exit code 1) and stderr is non-empty, the hook system shall convert the stderr text to a `systemMessage` via `convertPlainTextToHookOutput()`, producing `{ decision: 'allow', systemMessage: 'Warning: <stderr_text>' }`. The hook is treated as failed (fail-open) — `success: false` — but the stderr content is preserved as a warning message in the output.
**Traces to:** hookRunner.ts `convertPlainTextToHookOutput()` non-blocking error branch; Canonical Exit-Code Precedence Table (§35)
<!-- R3-13: Missing requirement for non-0/non-2 exit code stderr-to-systemMessage conversion. Verified in source: hookRunner.ts returns `{ decision: 'allow', systemMessage: 'Warning: <text>' }` for non-0/non-2 exit codes with non-empty stderr. -->

### HOOK-210
**Type:** Event-driven
**Requirement:** When multiple hooks fire for BeforeToolSelection, the aggregator shall merge outputs using the following specific semantics: (1) mode precedence is NONE > ANY > AUTO (most-restrictive-wins); (2) `allowedFunctionNames` from all hooks are combined using set union; (3) the final `allowedFunctionNames` list shall be sorted alphabetically for deterministic caching behavior; (4) if any hook specifies mode `NONE`, `allowedFunctionNames` shall be empty regardless of other hooks' outputs. These semantics are implemented in `hookAggregator.ts` `mergeToolSelectionOutputs()` using `FunctionCallingConfigMode` enum values.
**Traces to:** overview.md §7.3; hookAggregator.ts `mergeToolSelectionOutputs()`
<!-- R3-14: Missing detailed BeforeToolSelection merge semantics (mode precedence, union, sorting). Complements HOOK-099/100/101/102 with implementation-verified details. -->

### HOOK-211
**Type:** Ubiquitous
**Requirement:** The `applyHookOutputToInput()` function in `hookRunner.ts` shall implement per-event sequential chaining for `BeforeAgent` (merge `additionalContext` into `prompt`) and `BeforeModel` (merge `llm_request` via shallow merge). For all other events — `AfterTool`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, and out-of-scope events — `applyHookOutputToInput()` shall perform no input modification (fall through to the `default` case which returns the input unchanged). [Target] The rewrite shall add a `BeforeTool` chaining branch (see HOOK-024/HOOK-106). `AfterTool`, `AfterModel`, and `BeforeToolSelection` have no chaining semantics because their inputs do not carry modifiable fields from previous hooks.
**Traces to:** hookRunner.ts `applyHookOutputToInput()`; overview.md §7.4
<!-- R3-15: Missing per-event sequential chaining coverage. Verified in source: switch statement handles BeforeAgent and BeforeModel only; all other events hit the default no-op branch. -->

### HOOK-212
**Type:** Event-driven
**Requirement:** When a hook script exits with code 0 and writes stdout content, the hook system shall attempt to parse it as JSON. If JSON parsing succeeds, the parsed object shall be used as the hook output. If JSON parsing fails (malformed JSON, plain text, etc.), the hook system shall fall back to `convertPlainTextToHookOutput(stdout, 0)`, producing `{ decision: 'allow', systemMessage: <stdout_text> }`. This JSON-first-then-plain-text precedence is the canonical parsing protocol for exit code 0. If the parsed JSON result is a string (double-encoded JSON), the system shall parse it a second time (see HOOK-193/HOOK-201).
**Traces to:** hookRunner.ts stdout parsing logic; overview.md §4.2
<!-- R3-16: Missing requirement for malformed JSON stdout handling and parse-fallback precedence. Verified in source: try { JSON.parse(stdout) } catch { convertPlainTextToHookOutput(stdout, 0) }. -->

### HOOK-213
**Type:** Ubiquitous
**Requirement:** The `success` field on `AggregatedHookResult` shall represent hook execution health (did all hooks run without errors?), not policy outcome (did hooks allow or block the operation?). `success: false` means at least one hook encountered an execution failure (crash, timeout, non-zero exit code, signal kill). Policy decisions (block, allow, stop) are derived from `finalOutput` — specifically `finalOutput.isBlockingDecision()` for block/deny, `finalOutput.shouldStopExecution()` for agent termination, and `finalOutput.decision` for the raw decision value. Callers shall never use `success: false` alone to determine whether an operation should proceed — they must check `finalOutput` for policy. In particular, exit code 2 produces `success: false` (execution failure) AND `finalOutput.isBlockingDecision() === true` (policy block) — both fields must be consulted.
**Traces to:** overview.md §7.2; hookAggregator.ts `aggregateResults()`; technical-overview.md §3.2
<!-- R3-17: Missing requirement distinguishing policy decisions (from finalOutput) vs execution health (from success). -->
<!-- R3-19: Also addresses success vs policy language confusion across multiple requirements. -->

### HOOK-214
**Type:** Ubiquitous
**Requirement:** Throughout this requirements document, the terms "success" and "failure" when applied to `AggregatedHookResult.success` or `HookExecutionResult.success` refer exclusively to execution health — whether the hook process ran to completion without errors. The terms "block", "deny", "allow", and "stop" refer exclusively to policy outcomes derived from hook output fields (`decision`, `continue`, `stopReason`). A hook can have `success: false` (execution failure) while still producing a valid policy output (e.g., exit code 2 = execution failure + block policy). Requirements that describe "fail-open" behavior (HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060, HOOK-110) mean: when execution fails (`success: false`) and no explicit block decision was produced, the operation proceeds as if the hook did not run.
**Traces to:** overview.md §7.2; Canonical Exit-Code Precedence Table (§35)
<!-- R3-19: Added clarifying requirement about success vs policy semantics to resolve language confusion. -->

---

## 39. Additional Completeness Requirements (R4)

The following requirements address completeness gaps identified in review round 4.
Each is annotated with the review finding that prompted it.

### HOOK-215
**Type:** Ubiquitous
**Requirement:** The `HookEventHandler` shall source base fields for every `HookInput` as follows: `session_id` from `config.getSessionId()`, `cwd` from `config.getWorkingDir()`, `timestamp` from `new Date().toISOString()`, `hook_event_name` from the event being fired, and `transcript_path` from `''` (empty string, per HOOK-161). These base fields shall be populated before any event-specific fields are added.
**Traces to:** technical-overview.md §3.2 step 1; HOOK-062, HOOK-144, HOOK-161
<!-- R4-05: No requirement specified where base fields are sourced from at runtime. Config provides session_id and cwd; timestamp is generated per-event; transcript_path is empty string until Config exposes getTranscriptPath(). -->

### HOOK-216
**Type:** Event-driven
**Requirement:** [Target] When multiple BeforeTool hooks execute sequentially and more than one returns a modified `tool_input` in `hookSpecificOutput`, the `applyHookOutputToInput()` function shall apply shallow-replace semantics: the later hook's `tool_input` object shall replace (not deep-merge into) the earlier hook's `tool_input` as a whole. Individual top-level keys in `tool_input` from the later hook overwrite same-named keys from the earlier hook, but nested objects are not recursively merged. This is consistent with the BeforeModel `llm_request` chaining strategy (HOOK-105), which also uses shallow merge via object spread. The merge is cumulative across the chain — each hook sees the merged result of all prior hooks, not only the original input.
**Traces to:** overview.md §3.1 "Modify tool input"; overview.md §7.4; HOOK-024, HOOK-106
<!-- R4-06: Sequential BeforeTool merge semantics were unspecified. Requirements marked [Target] for tool_input merge (HOOK-024) but didn't specify shallow-replace vs deep-merge, or cumulative vs last-wins. This requirement pins the strategy to match the existing BeforeModel pattern. -->

### HOOK-217
**Type:** Ubiquitous
**Requirement:** The interface contract between the hook system and callers for AfterTool and AfterModel effects shall be: (1) The hook system returns effect fields on `DefaultHookOutput` — `systemMessage`, `suppressOutput`, `additionalContext` (via `hookSpecificOutput`), and `continue`/`stopReason`. (2) Callers are responsible for applying these effects to the appropriate boundaries: `systemMessage` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-131) or to the conversation context (AfterModel); `suppressOutput` sets `ToolResult.suppressDisplay` (AfterTool, per HOOK-132) or suppresses display rendering (AfterModel, per HOOK-049); `additionalContext` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-027); `continue: false` triggers agent loop termination in the caller (per HOOK-028/HOOK-048). (3) The hook system shall not directly mutate `ToolResult`, conversation state, or UI state — it only returns the output object. All mutations are the caller's responsibility.
**Traces to:** technical-overview.md §5.1, §5.2, §6.1; overview.md §3.2, §3.4
<!-- R4-08: Requirements described AfterTool/AfterModel effects but didn't pin which interface boundary carries them. This requirement explicitly separates hook-system output (the return value) from caller-side application (mutation of ToolResult, conversation, UI). -->

---

## Appendix: Requirement Coverage Summary

| Category | Requirements | Count |
|---|---|---|
| Initialization & Lifecycle | HOOK-001 – HOOK-009 | 9 |
| Zero Overhead | HOOK-010 – HOOK-013 | 4 |
| BeforeTool | HOOK-014 – HOOK-024 (HOOK-016 split into 016a/016b) | 12 |
| AfterTool | HOOK-025 – HOOK-032 | 8 |
| BeforeModel | HOOK-033 – HOOK-042 | 10 |
| AfterModel | HOOK-043 – HOOK-052 | 10 |
| BeforeToolSelection | HOOK-053 – HOOK-060 | 8 |
| Communication Protocol | HOOK-061 – HOOK-070 (HOOK-067 split into 067a/067b) | 11 |
| Data Formats | HOOK-071 – HOOK-074 | 4 |
| Data Translation | HOOK-075 – HOOK-079 | 5 |
| Configuration | HOOK-080 – HOOK-086 | 7 |
| Matcher & Deduplication | HOOK-087 – HOOK-091 | 5 |
| OR-Decision Merge | HOOK-092 – HOOK-097 | 6 |
| Field-Replacement Merge | HOOK-098 | 1 |
| Union Merge | HOOK-099 – HOOK-102 | 4 |
| Sequential Chaining | HOOK-103 – HOOK-109 | 7 |
| Error Handling | HOOK-110 – HOOK-116 | 7 |
| Timeout Enforcement | HOOK-117 – HOOK-120 | 4 |
| Environment Variables | HOOK-121 – HOOK-124 (all merged into HOOK-188) | 0+4 merged |
| Mode Independence | HOOK-125 (HOOK-126 merged) | 1+1 merged |
| Caller Integration — Tools | HOOK-127 – HOOK-134 | 8 |
| Caller Integration — Model | HOOK-135 – HOOK-141 | 7 |
| New Components | HOOK-142 – HOOK-149 | 8 |
| Trigger Function Contracts | HOOK-150 – HOOK-154 | 5 |
| Backward Compatibility | HOOK-155 – HOOK-156 | 2 |
| Output Field Contracts | HOOK-157 – HOOK-160 | 4 |
| Transcript Path | HOOK-161 | 1 |
| Event Handler Flow | HOOK-162 – HOOK-166 | 5 |
| Tool Selection Apply | HOOK-167 – HOOK-168 | 2 |
| BeforeTool Compatibility | HOOK-169 – HOOK-171 | 3 |
| Streaming Constraints | HOOK-172 – HOOK-174 | 3 |
| Module Exports | HOOK-175 – HOOK-176 | 2 |
| Decision Matrix | HOOK-177 – HOOK-181 | 5 |
| Completeness Gaps R1 (new) | HOOK-182 – HOOK-198 (HOOK-185 merged→091, HOOK-186 merged→109, HOOK-197 merged→067b) | 14+3 merged |
| Canonical Exit-Code Table | §35 (reference section) | — |
| Completeness Gaps R2 (new) | HOOK-199 – HOOK-208 | 10 |
| Rewrite Scope Boundary | §37 (reference section) | — |
| Completeness Gaps R3 (new) | HOOK-209 – HOOK-214 | 6 |
| Completeness Gaps R4 (new) | HOOK-215 – HOOK-217 | 3 |
| **Total** | | **218** (including 8 merged: HOOK-121–124, HOOK-126, HOOK-185, HOOK-186, HOOK-197) |

---

## Appendix: Review Remediation Cross-Reference (R1)

| Review ID | Issue | Action | Requirements Affected |
|---|---|---|---|
| R1-01 | HOOK-016 mixes two triggers | Split into HOOK-016a (exit code 2) and HOOK-016b (JSON block on exit 0) | HOOK-016a, HOOK-016b |
| R1-02 | HOOK-021 embeds state in event template | Reworded to proper event-driven EARS | HOOK-021 |
| R1-03 | HOOK-060 conflates two actions | Specified logging level/content in HOOK-023, HOOK-031, HOOK-060 | HOOK-023, HOOK-031, HOOK-060 |
| R1-04 | HOOK-006 architectural, not behavioral | Reworded to observable accessor-based requirement | HOOK-006 |
| R1-05 | HOOK-142/143 specify file paths | Reworded as importability | HOOK-142, HOOK-143 |
| R1-06 | Exit code 2 stdout parsing error | Corrected HOOK-016a, HOOK-066, HOOK-067; added HOOK-197 [Target]. Empty-stderr edge case accurately documented as producing undefined output in current code. | HOOK-016a, HOOK-066, HOOK-067, HOOK-197 |
| R1-07 | Sequential block-exit not implemented | Marked HOOK-107 as [Target] | HOOK-107 |
| R1-08 | BeforeTool chaining not implemented | Marked HOOK-019, HOOK-024, HOOK-106 as [Target] | HOOK-019, HOOK-024, HOOK-106 |
| R1-09 | systemMessage injection is target-only | Marked HOOK-030, HOOK-131 as [Target] | HOOK-030, HOOK-131 |
| R1-10 | AfterModel suppressOutput target-only | Marked HOOK-029, HOOK-049, HOOK-132 as [Target] | HOOK-029, HOOK-049, HOOK-132 |
| R1-11 | HOOK-055 overstates tool filtering | Corrected to specify toolConfig modification only | HOOK-055 |
| R1-12 | HOOK-063/064 read as fully realized | Marked HOOK-063 apply portion as [Target]; HOOK-027, HOOK-028 as [Target] | HOOK-027, HOOK-028, HOOK-063 |
| R1-13 | Signal-killed processes treated as success | Added HOOK-196 documenting the quirk | HOOK-196 |
| R1-14 | HOOK-065 broken trace | Fixed trace to overview.md §4.2 | HOOK-065 |
| R1-15 | HOOK-048 traces to source code | Fixed trace to spec sections | HOOK-048 |
| R1-16 | HOOK-131 format not in overview.md | Retained trace to technical-overview.md (correct source) | HOOK-131 |
| R1-17 | No requirement for "ask" decision | Added HOOK-182 | HOOK-182 |
| R1-18 | No executeToolWithHooks stop-result structure | Added HOOK-183 | HOOK-183 |
| R1-19 | BeforeModel conflation of shouldStopExecution/blocked | Added HOOK-184 | HOOK-184 |
| R1-20 | No tool_response shape specification | Updated HOOK-026 with structure detail | HOOK-026 |
| R1-21 | Missing deduplication requirement | Added HOOK-185 | HOOK-185 |
| R1-22 | Missing sequential-escalation rule | Added HOOK-186; updated HOOK-109 | HOOK-109, HOOK-186 |
| R1-23 | Missing source-priority ordering | Added HOOK-187; updated HOOK-086 | HOOK-086, HOOK-187 |
| R1-24 | Missing timeout termination specifics | Already covered by HOOK-117/118; confirmed | HOOK-117, HOOK-118 |
| R1-25 | Missing environment variables requirement | Added HOOK-188 | HOOK-188 |
| R1-26 | Missing exit-code-2 stderr-as-reason | Added HOOK-189; updated HOOK-016a, HOOK-067 | HOOK-016a, HOOK-067, HOOK-189 |
| R1-27 | Missing aggregation semantics | Added HOOK-190 | HOOK-190 |
| R1-28 | Missing hook type validation | Added HOOK-191 | HOOK-191 |
| R1-29 | No EPIPE error handling | Added HOOK-192 | HOOK-192 |
| R1-30 | No double-encoded JSON handling | Added HOOK-193 | HOOK-193 |
| R1-31 | Missing getSyntheticResponse asymmetry | Added HOOK-194 | HOOK-194 |
| R1-32 | HOOK-003/004 redundant | Retained both with clarifying annotations | HOOK-003, HOOK-004 |
| R1-33 | HOOK-127/128 duplicated by 150/151 | Retained both with clarifying annotations | HOOK-127, HOOK-128, HOOK-150, HOOK-151 |
| R1-34 | HOOK-110 generalizes per-event fail-open | Retained as summary invariant with annotation | HOOK-110 |
| R1-35 | HOOK-010 "measurable latency" untestable | Removed untestable clause | HOOK-010 |
| R1-36 | HOOK-011 "per-event infrastructure" not observable | Reworded to observable behavior | HOOK-011 |
| R1-37 | HOOK-013 "fast-path boolean check" prescriptive | Reworded to observable constraints | HOOK-013 |
| R1-38 | HOOK-029 suppressDisplay ambiguous | Clarified observation points | HOOK-029 |
| R1-39 | HOOK-039 context message ordering unspecified | Specified append ordering, no dedup | HOOK-039 |
| R1-40 | HOOK-050 "streaming chunks collected" undefined | Added formal boundary definition | HOOK-050 |
| R1-41 | HOOK-125 "behave identically" untestable | Reworded to TTY-independence | HOOK-125 |
| R1-42 | HOOK-156 narrative, not testable | Reworded to testable requirement | HOOK-156 |
| R1-43 | HOOK-016 vs HOOK-023 interaction undefined | Resolved via split and HOOK-198 | HOOK-016a, HOOK-016b, HOOK-110, HOOK-198 |
| R1-44 | HOOK-036/037 vs HOOK-042 exit-code precedence | Clarified in HOOK-036, HOOK-037, HOOK-042 | HOOK-036, HOOK-037, HOOK-042 |
| R1-45 | HOOK-055 vs HOOK-056/057 aggregation conflict | Clarified single-hook vs multi-hook in HOOK-055, HOOK-099 | HOOK-055, HOOK-099 |
| R1-46 | HOOK-098 "in parallel" qualifier incorrect | Removed qualifier | HOOK-098 |
| R1-47 | HOOK-081 lists 5 events but enum has 11 | Clarified scope vs accepted events | HOOK-081 |
| R1-48 | Plugin type accepted but no execution path | Added HOOK-195; updated HOOK-083 | HOOK-083, HOOK-195 |

---

## Appendix: Review Remediation Cross-Reference (R2)

| Review ID | Issue | Action | Requirements Affected |
|---|---|---|---|
| R2-01 | HOOK-006 invents nonexistent API surface (`getPlanner()`, `getRunner()`, `getAggregator()`) | Fixed HOOK-006 to list only actual public accessors: `getRegistry()`, `getEventHandler()`, `getStatus()`. Planner/runner/aggregator documented as internal to HookEventHandler. | HOOK-006 |
| R2-02 | HOOK-196 wrong about signal-killed = success | Fixed HOOK-196: signal-killed processes have `success: false` (not success). `exitCode` field maps to 0 misleadingly but `success` is independently computed as `false` via `exitCode === EXIT_CODE_SUCCESS` where exitCode is `null`. | HOOK-196 |
| R2-03 | HOOK-001/010 reference wrong config path `tools.enableHooks` | Fixed to `enableHooks` (top-level, no `tools.` prefix). Verified: config.ts has `enableHooks?: boolean` and `getEnableHooks(): boolean`. | HOOK-001, HOOK-010 |
| R2-04 | HOOK-154 says internal errors return `success: false` | Fixed HOOK-113 (was implicitly HOOK-154's concern): `fire*Event()` try/catch returns empty result with `success: true` on infrastructure error (fail-open safe default). Note: original HOOK-154 was about trigger function contract, not error handling — error handling is in HOOK-113. | HOOK-113 |
| R2-05 | HOOK-164 requires preserving non-text parts in translator | Fixed HOOK-164: removed incorrect non-text preservation claim. Specs describe lossy text-only translation for v1. Added explicit note to HOOK-075 confirming intentional lossy behavior. HOOK-164 ID reused for execution strategy delegation requirement. | HOOK-075, HOOK-164 |
| R2-06 | HOOK-168 asserts dedup key includes matcher/sequential/source | Fixed HOOK-168: dedup key is `command:<command_string>` only. Verified in hookPlanner.ts `getHookKey()`. | HOOK-168 |
| R2-07 | HOOK-160 overstates plugin support | Moved plugin discussion out of HOOK-160 (which is about success semantics) into HOOK-083 and HOOK-195. Clarified that `HookType` enum has only `Command`, no `PluginHookConfig` type exists. | HOOK-083, HOOK-160, HOOK-195 |
| R2-08 | HOOK-017 — block reason as tool output (target) | Marked HOOK-017 as [Target]. Currently fire-and-forget — callers don't construct ToolResult from hook output. | HOOK-017 |
| R2-09 | HOOK-020 — `continue=false` terminates agent loop (target) | Marked HOOK-020 as [Target]. Hook system alone can't terminate agent loop; caller must act on result. | HOOK-020 |
| R2-10 | HOOK-129/130 — scheduler blocked-tool handling (target) | Marked HOOK-129 and HOOK-130 as [Target]. Scheduler never receives hook results today. | HOOK-129, HOOK-130 |
| R2-11 | HOOK-134 — no `void` prefix, all callers `await` (target) | Marked HOOK-134 as [Target]. Currently ALL callers use `void` prefix. Verified in geminiChat.ts and coreToolScheduler.ts. | HOOK-134 |
| R2-12 | HOOK-154 — `success: false` on internal error (target, if intended) | Addressed via R2-04. The error handling (success:true on catch) is in HOOK-113, not HOOK-154. HOOK-154 is the trigger function contract (correct as-is). | HOOK-113 |
| R2-13 | HOOK-160 — plugin support (target or remove) | Plugin support is forward-compatibility validation only, not a rewrite target. Clarified in HOOK-195. | HOOK-195 |
| R2-14 | HOOK-168 — enhanced dedup key (target or fix) | Fixed to match current behavior (command-only). See R2-06. | HOOK-168 |
| R2-15 | HOOK-016a mixes two triggers/actions | Split: HOOK-016a covers exit-code-2 + non-empty stderr only. Empty-stderr case is in HOOK-067 and HOOK-197. | HOOK-016a |
| R2-16 | HOOK-152 explicitly marked as non-EARS legacy format | Rewrote HOOK-152 to proper EARS Ubiquitous template. | HOOK-152 |
| R2-17 | HOOK-031 vs HOOK-196 contradict on crash/signal behavior | Resolved: HOOK-196 now correctly states signal-kill = success:false. Consistent with HOOK-031 fail-open. | HOOK-031, HOOK-196 |
| R2-18 | HOOK-070 vs HOOK-196 on exit code 0 semantics | Resolved: HOOK-070 clarified that success:true maps only to exitCode 0. HOOK-196 clarified that signal-killed exitCode is null (not 0 for success computation). | HOOK-070, HOOK-196 |
| R2-19 | HOOK-013 vs HOOK-001/008 on object allocation | Resolved: HOOK-013 now scoped to disabled/no-match fast path. HOOK-001/008 describe lazy init on first event fire (after the fast path check). No conflict. | HOOK-013 |
| R2-20 | HOOK-027/030/029 combined effects undefined | Added HOOK-208: combined effects are independent and apply in parallel (no precedence). Verified in hookAggregator.ts `mergeWithOrDecision()`. | HOOK-208 |
| R2-21 | Need canonical exit-code precedence table | Created §35 "Canonical Exit-Code Precedence Table". All per-event requirements cross-reference it. | §35, HOOK-016a, HOOK-016b, HOOK-023, HOOK-031, HOOK-042, HOOK-066, HOOK-068, HOOK-070, HOOK-110, HOOK-196, HOOK-198 |
| R2-22 | HOOK-086 four-tier priority is actually two-tier in practice | Updated HOOK-086: clarified that only Project and Extensions are assigned in production. User and System exist for forward compatibility. | HOOK-086, HOOK-187 |
| R2-23 | No `BeforeToolHookOutput` compatibility fields requirement | Added HOOK-199: documents `permissionDecision` and `permissionDecisionReason` compatibility fields. | HOOK-199 |
| R2-24 | No `createHookOutput()` vs `createSpecificHookOutput()` behavior | Added HOOK-200: documents factory function differences (createHookOutput returns DefaultHookOutput for BeforeTool; aggregator's createSpecificHookOutput returns BeforeToolHookOutput). | HOOK-200 |
| R2-25 | No double-encoded JSON handling requirement | Added HOOK-201: detailed double-encoded JSON parsing requirement. Complements HOOK-193. | HOOK-201 |
| R2-26 | No BeforeModel block-without-response caller behavior | Added HOOK-202: caller shall provide empty/error response when blocked without synthetic response. | HOOK-202 |
| R2-27 | No `"ask"` decision type purpose | Updated HOOK-182: added explanation that "ask" is reserved for future use (potential user-prompting). | HOOK-182 |
| R2-28 | Missing non-regression requirements for out-of-scope events | Added HOOK-203: out-of-scope events continue to fire-and-forget. | HOOK-203 |
| R2-29 | Missing scheduler state handling for blocked tools | Added HOOK-204: scheduler state transitions for blocked tools. | HOOK-204 |
| R2-30 | Missing BeforeToolSelection translator wiring requirement | Added HOOK-205: BeforeToolSelection must use actual GenerateContentParameters and translator. | HOOK-205 |
| R2-31 | Missing trigger-function-performs-init requirement | Added HOOK-206: trigger functions perform init, not constructors. | HOOK-206 |
| R2-32 | HOOK-017 under-specified for test assertions | Updated HOOK-017: specified field (`llmContent`), source (`getEffectiveReason()`), and observable outcome. | HOOK-017 |
| R2-33 | HOOK-031/052 "log a warning" — no log schema | Updated HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060, HOOK-113, HOOK-191: specified `DebugLogger` as the logger. | HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060, HOOK-113, HOOK-191 |
| R2-34 | HOOK-050 stream-abort behavior undefined | Added HOOK-207: AfterModel does not fire if stream aborts before complete response. | HOOK-207 |
| R2-35 | HOOK-010/011/012 "not allocate infrastructure" not observable | Updated HOOK-010: added observable proxy (`getHookSystem()` returns `undefined`). | HOOK-010 |
| R2-36 | HOOK-013 mixes observable constraints with implementation details | Refined HOOK-013: removed "no object allocations" (not observable), scoped to "no async operations on fast path". Testable assertion is `getHookSystem()` returns `undefined`. | HOOK-013 |
| R2-37 | HOOK-088 traces to source code only | Added spec trace (overview.md §6.2) to HOOK-088 alongside source code reference. | HOOK-088 |
| R2-38 | HOOK-091 dedup scope unclear | Updated HOOK-091: clarified dedup is within single event after matcher filtering, not cross-event. | HOOK-091 |
| R2-39 | Multiple late-section requirements (150+) have weak traces | Fixed: HOOK-152 rewritten to EARS; HOOK-154/160 traces verified as correct (tech spec §5.2 and overview §7.2); HOOK-164 content replaced (was factually wrong); HOOK-168 trace updated. | HOOK-152, HOOK-160, HOOK-164, HOOK-168 |
| R2-40 | HOOK-125/126 say the same thing | Merged HOOK-126 into HOOK-125. HOOK-126 ID retained with merge note. | HOOK-125, HOOK-126 |
| R2-41 | HOOK-077 `blocked` field type vs runtime mismatch | Added implementer note to HOOK-077 documenting the type/runtime mismatch. | HOOK-077 |

---

## Appendix: Review Remediation Cross-Reference (R3)

| Review ID | Issue | Action | Requirements Affected |
|---|---|---|---|
| R3-01 | overview.md still says `tools.enableHooks` | Added erratum note in preamble documenting that overview.md §6.1, §7.1, §9 use incorrect config path. Requirements use the correct `enableHooks` path. | Preamble (Errata section) |
| R3-02 | HOOK-183 invents `blocked: true` on ToolResult | Fixed HOOK-183 — removed invented `blocked` property. Per tech spec §5.1, callers detect block via `beforeOutput?.isBlockingDecision()` before calling `executeFn()`, and blocked ToolResult has reason in `llmContent`. | HOOK-183 |
| R3-03 | HOOK-070 selectively documents null case, omits exit code 2 | Fixed HOOK-070 to explicitly mention exit code 2, exit code 1, and all other non-zero codes producing `success: false`. Cross-referenced HOOK-160/213 for success vs policy distinction. | HOOK-070 |
| R3-04 | HOOK-109 and HOOK-186 are near-duplicates | Merged HOOK-186 into HOOK-109. HOOK-186 retired with merge note. | HOOK-109, HOOK-186 |
| R3-05 | HOOK-091 and HOOK-185 are near-duplicates | Merged HOOK-185 into HOOK-091. HOOK-185 retired with merge note. | HOOK-091, HOOK-185 |
| R3-06 | HOOK-121–124 fully duplicated by HOOK-188 | Retired HOOK-121/122/123/124 with merge notes. HOOK-188 now consolidates all env var requirements including command-string expansion (from HOOK-124). | HOOK-121, HOOK-122, HOOK-123, HOOK-124, HOOK-188 |
| R3-07 | HOOK-168 conflates tool restriction with dedup key | Removed dedup sentence from HOOK-168 — that topic is unrelated and fully covered by HOOK-091. | HOOK-168 |
| R3-08 | HOOK-049 missing [Target] | Confirmed [Target] already present. Strengthened wording to clarify no caller acts on AfterModel outputs today. | HOOK-049 |
| R3-09 | HOOK-048 missing [Target] | Marked HOOK-048 as [Target]. AfterModel response modification requires caller integration; currently fire-and-forget. | HOOK-048 |
| R3-10 | HOOK-050 fires today but with fake data | Added note to HOOK-050 documenting that AfterModel fires today but passes `llm_request: {} as never` (placeholder). Marked the "with real data" portion as [Target]. | HOOK-050 |
| R3-11 | HookSystemNotInitializedError requirements need [Target] | Marked HOOK-005 and HOOK-148 as [Target]. `HookSystemNotInitializedError` does not exist in current code (only `HookRegistryNotInitializedError`). | HOOK-005, HOOK-148 |
| R3-12 | Audit all effectful requirements for [Target] completeness | Systematic audit completed. Marked [Target] on: HOOK-036 (BeforeModel block+synthetic), HOOK-037 (BeforeModel block without response), HOOK-038 (BeforeModel request modification), HOOK-039 (BeforeModel message injection), HOOK-040 (BeforeModel agent termination), HOOK-046 (AfterModel response modification), HOOK-047 (AfterModel response replacement), HOOK-055 (BeforeToolSelection restriction), HOOK-056 (BeforeToolSelection mode change), HOOK-057 (BeforeToolSelection NONE mode), HOOK-058 (BeforeToolSelection agent termination). All callers verified as fire-and-forget (`void trigger*Hook(...)` in geminiChat.ts and coreToolScheduler.ts). | HOOK-036, HOOK-037, HOOK-038, HOOK-039, HOOK-040, HOOK-046, HOOK-047, HOOK-055, HOOK-056, HOOK-057, HOOK-058 |
| R3-13 | No requirement for non-0/non-2 exit code stderr conversion | Added HOOK-209: stderr converted to `{ decision: 'allow', systemMessage: 'Warning: <text>' }` for non-0/non-2 exit codes. | HOOK-209 |
| R3-14 | BeforeToolSelection merge semantics (mode precedence, union, sorting) | Added HOOK-210: detailed merge semantics including NONE > ANY > AUTO precedence, set union, alphabetical sorting. | HOOK-210 |
| R3-15 | Per-event sequential chaining coverage | Added HOOK-211: `applyHookOutputToInput()` handles BeforeAgent and BeforeModel only; all other events are no-op. BeforeTool chaining is [Target]. | HOOK-211 |
| R3-16 | Malformed JSON stdout handling and parse-fallback precedence | Added HOOK-212: JSON-first-then-plain-text parsing protocol for exit code 0. | HOOK-212 |
| R3-17 | Policy decisions derive from finalOutput, not aggregate success | Added HOOK-213: distinguishes `success` (execution health) from `finalOutput` (policy decisions). | HOOK-213 |
| R3-18 | HOOK-067 mixes current and target behavior | Split HOOK-067 into HOOK-067a (current: non-empty stderr) and HOOK-067b ([Target]: empty stderr fix). | HOOK-067a, HOOK-067b |
| R3-19 | "Success" vs "policy" language confusion | Added HOOK-214: defines terminology — "success/failure" = execution health, "block/deny/allow/stop" = policy outcomes. Cross-references fail-open requirements. Also addressed in HOOK-213. | HOOK-213, HOOK-214 |
| R3-20 | Config-source precedence conflicts with actual registry ingestion | Fixed HOOK-086 and HOOK-187: now explicitly state only two tiers (Project, Extensions) are used in production. Four-tier enum exists for forward compatibility only. | HOOK-086, HOOK-187 |
| R3-21 | HOOK-200 is documentation, not testable requirement | Rewrote HOOK-200 with concrete observable assertions: `createHookOutput('BeforeTool', { hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `false` vs `new BeforeToolHookOutput(...)` returns `true`. | HOOK-200 |
| R3-22 | Missing explicit scope boundary for rewrite events | Added §37 "Rewrite Scope Boundary" documenting that 5 of 11 events are in scope for end-to-end caller integration. Universal "hook system shall..." wording applies to all events only for internal behavior. | §37 |

---

## Appendix: Review Remediation Cross-Reference (R4)

| Review ID | Issue | Action | Requirements Affected |
|---|---|---|---|
| R4-01 | HOOK-149 missing [Target] — `suppressDisplay` doesn't exist on ToolResult | Added [Target] marker. Verified `ToolResult` in tools.ts has no `suppressDisplay` field. Same pattern as HOOK-029/HOOK-132. | HOOK-149 |
| R4-02 | HOOK-067b and HOOK-197 are near-duplicates (exit-code-2 empty-stderr) | Merged HOOK-197 into HOOK-067b. HOOK-067b now explicitly covers "both stdout and stderr empty" subcase. HOOK-197 retired with merge note. | HOOK-067b, HOOK-197 |
| R4-03 | HOOK-104 omits `success` precondition for sequential chaining | Added `success: true` and non-empty output preconditions. Source code gates chaining on `result.success && result.output`. | HOOK-104 |
| R4-04 | HOOK-006 self-contradicts on ownership vs "internal to" | Reworded from "internal to HookEventHandler" to "created by HookSystem and injected into HookEventHandler by HookSystem". | HOOK-006 |
| R4-05 | No requirement for HookEventHandler base field sourcing from Config | Added HOOK-215: session_id from config.getSessionId(), cwd from config.getWorkingDir(), timestamp from Date.toISOString(), transcript_path as ''. | HOOK-215 |
| R4-06 | Sequential BeforeTool merge semantics unspecified | Added HOOK-216: shallow-replace semantics, cumulative across chain, consistent with BeforeModel pattern. | HOOK-216 |
| R4-07 | Some [Target] markers on already-implemented behavior | Audit complete: all 41 [Target]-marked requirements verified against hookRunner.ts and types.ts. No [Target] markers describe already-implemented behavior — all are correctly applied. No changes needed. | (none — audit confirmed correctness) |
| R4-08 | AfterTool/AfterModel interface contract boundaries | Added HOOK-217: hook system returns output object, callers apply effects to ToolResult/conversation/UI. Explicit separation of hook-system output from caller-side mutation. | HOOK-217 |
