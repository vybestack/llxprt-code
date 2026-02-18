# Phase 12: Model Hook Pipeline Stub

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P12

## Prerequisites
- Completion marker exists and is complete: project-plans/hooksystemrewrite/.completed/P11a.md
- Verification command: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P11a.md
- Preflight gate complete: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P00a.md

## Requirements Implemented (Expanded)

### Section 5. BeforeModel Hook Event
Coverage: 10 active requirements (HOOK-033..HOOK-042).

#### HOOK-033
Requirement Text: When an LLM API call is about to be made, the hook system shall fire a `BeforeModel` event after the request is fully assembled.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an LLM API call is about to be made
- THEN: the hook system shall fire a `BeforeModel` event after the request is fully assembled

#### HOOK-034
Requirement Text: The `BeforeModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeModel"`), `transcript_path`, and `llm_request` (in stable hook API format via the hook translator).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeModel"`), `transcript_path`, and `llm_request` (in stable hook API format via the hook translator)

#### HOOK-035
Requirement Text: The `BeforeModel` event handler shall use `defaultHookTranslator.toHookLLMRequest()` to convert `GenerateContentParameters` to the stable hook API format before sending to scripts.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeModel` event handler shall use `defaultHookTranslator.toHookLLMRequest()` to convert `GenerateContentParameters` to the stable hook API format before sending to scripts

#### HOOK-036
Requirement Text: [Target] When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and provides an `llm_response` in `hookSpecificOutput`, the caller shall skip the model call and use the synthetic response as if the model had responded. Currently callers fire-and-forget BeforeModel results (`void triggerBeforeModelHook(...)` in geminiChat.ts).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook script exits with code 0
- THEN: returns valid JSON with `decision` = `"block"` or `"deny"`, and provides an `llm_response` in `hookSpecificOutput`, the caller shall skip the model call and use the synthetic response as if the model had responded. Currently callers fire-and-forget BeforeModel results (`void triggerBeforeModelHook(...)` in geminiChat.ts)

#### HOOK-037
Requirement Text: [Target] When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and does not provide an `llm_response`, the caller shall skip the model call and return an empty/no-op response. Currently callers fire-and-forget BeforeModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook script exits with code 0
- THEN: returns valid JSON with `decision` = `"block"` or `"deny"`, and does not provide an `llm_response`, the caller shall skip the model call and return an empty/no-op response. Currently callers fire-and-forget BeforeModel results

#### HOOK-038
Requirement Text: [Target] When a BeforeModel hook returns a modified `llm_request` in `hookSpecificOutput`, the caller shall send the modified request to the model instead of the original. Currently callers fire-and-forget BeforeModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook returns a modified `llm_request` in `hookSpecificOutput`
- THEN: the caller shall send the modified request to the model instead of the original. Currently callers fire-and-forget BeforeModel results

#### HOOK-039
Requirement Text: [Target] When a BeforeModel hook adds messages to the `llm_request.messages` array, the caller shall append those additional context messages after the existing messages in the model call. Currently callers fire-and-forget BeforeModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook adds messages to the `llm_request.messages` array
- THEN: the caller shall append those additional context messages after the existing messages in the model call. Currently callers fire-and-forget BeforeModel results

#### HOOK-040
Requirement Text: [Target] When a BeforeModel hook returns `continue` = `false`, the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook returns `continue` = `false`
- THEN: the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeModel results

#### HOOK-041
Requirement Text: The BeforeModel hook shall fire on every model call without matcher filtering (no `tool_name` to match against).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The BeforeModel hook shall fire on every model call without matcher filtering (no `tool_name` to match against)

#### HOOK-042
Requirement Text: If a BeforeModel hook script fails (crash, timeout, or any exit code other than 0 or 2), then the hook system shall not prevent the model call and shall log a warning via `DebugLogger` at warn level (fail-open). Exit code determines failure vs. block as specified in the Canonical Exit-Code Precedence Table (§35).
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a BeforeModel hook script fails (crash, timeout, or any exit code other than 0 or 2)
- THEN: the hook system shall not prevent the model call and shall log a warning via `DebugLogger` at warn level (fail-open). Exit code determines failure vs. block as specified in the Canonical Exit-Code Precedence Table (§35)

### Section 6. AfterModel Hook Event
Coverage: 10 active requirements (HOOK-043..HOOK-052).

#### HOOK-043
Requirement Text: When the model responds, the hook system shall fire an `AfterModel` event after the complete response is available and before the response is processed by the agent.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the model responds
- THEN: the hook system shall fire an `AfterModel` event after the complete response is available and before the response is processed by the agent

#### HOOK-044
Requirement Text: The `AfterModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterModel"`), `transcript_path`, `llm_request` (the original request in stable hook API format), and `llm_response` (the model's response in stable hook API format).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `AfterModel` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterModel"`), `transcript_path`, `llm_request` (the original request in stable hook API format), and `llm_response` (the model's response in stable hook API format)

#### HOOK-045
Requirement Text: The `AfterModel` event handler shall use `defaultHookTranslator.toHookLLMResponse()` to convert `GenerateContentResponse` to the stable hook API format before sending to scripts.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `AfterModel` event handler shall use `defaultHookTranslator.toHookLLMResponse()` to convert `GenerateContentResponse` to the stable hook API format before sending to scripts

#### HOOK-046
Requirement Text: [Target] When an AfterModel hook returns a modified `llm_response` in `hookSpecificOutput`, the caller shall use the modified response downstream instead of the original. Currently callers fire-and-forget AfterModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterModel hook returns a modified `llm_response` in `hookSpecificOutput`
- THEN: the caller shall use the modified response downstream instead of the original. Currently callers fire-and-forget AfterModel results

#### HOOK-047
Requirement Text: [Target] When an AfterModel hook returns a completely new `llm_response`, the caller shall use the replacement as if the model had produced it. Currently callers fire-and-forget AfterModel results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterModel hook returns a completely new `llm_response`
- THEN: the caller shall use the replacement as if the model had produced it. Currently callers fire-and-forget AfterModel results

#### HOOK-048
Requirement Text: [Target] When an AfterModel hook returns `continue` = `false`, the hook system shall generate a synthetic stop response containing the `stopReason` via `AfterModelHookOutput.getModifiedResponse()`, and the caller shall terminate the agent loop. Currently callers fire-and-forget AfterModel results (`void triggerAfterModelHook(...)` in geminiChat.ts).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterModel hook returns `continue` = `false`
- THEN: the hook system shall generate a synthetic stop response containing the `stopReason` via `AfterModelHookOutput.getModifiedResponse()`, and the caller shall terminate the agent loop. Currently callers fire-and-forget AfterModel results (`void triggerAfterModelHook(...)` in geminiChat.ts)

#### HOOK-049
Requirement Text: [Target] When an AfterModel hook returns `suppressOutput` = `true`, the caller shall suppress the response from being displayed to the user while still processing it for tool calls and agent state. No caller acts on AfterModel outputs today (all callers use `void` prefix).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterModel hook returns `suppressOutput` = `true`
- THEN: the caller shall suppress the response from being displayed to the user while still processing it for tool calls and agent state. No caller acts on AfterModel outputs today (all callers use `void` prefix)

#### HOOK-050
Requirement Text: The AfterModel hook shall fire after the streaming response has been fully collected into a complete `GenerateContentResponse` — not per-chunk. The "complete response" boundary is defined as the point where all streaming chunks have been received and concatenated into the final `GenerateContentResponse` object. **Note:** The AfterModel event fires today, but the current implementation passes `llm_request: {} as never` (a placeholder, not the real request) because the request is not available in the current trigger context (verified: `geminiChatHookTriggers.ts` line 153). [Target] The rewrite shall pass the actual `llm_request` (translated via `toHookLLMRequest()`) so that hook scripts receive real data.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The AfterModel hook shall fire after the streaming response has been fully collected into a complete `GenerateContentResponse` — not per-chunk. The "complete response" boundary is defined as the point where all streaming chunks have been received and concatenated into the final `GenerateContentResponse` object. **Note:** The AfterModel event fires today, but the current implementation passes `llm_request: {} as never` (a placeholder, not the real request) because the request is not available in the current trigger context (verified: `geminiChatHookTriggers.ts` line 153). [Target] The rewrite shall pass the actual `llm_request` (translated via `toHookLLMRequest()`) so that hook scripts receive real data

#### HOOK-051
Requirement Text: The AfterModel hook shall fire on every model call without matcher filtering.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The AfterModel hook shall fire on every model call without matcher filtering

#### HOOK-052
Requirement Text: If an AfterModel hook script fails, then the hook system shall not affect the model response and shall log a warning via `DebugLogger` at warn level (fail-open).
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: an AfterModel hook script fails
- THEN: the hook system shall not affect the model response and shall log a warning via `DebugLogger` at warn level (fail-open)

### Section 7. BeforeToolSelection Hook Event
Coverage: 8 active requirements (HOOK-053..HOOK-060).

#### HOOK-053
Requirement Text: When the model is about to decide which tools to call, the hook system shall fire a `BeforeToolSelection` event before the LLM request that includes tool definitions is sent.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the model is about to decide which tools to call
- THEN: the hook system shall fire a `BeforeToolSelection` event before the LLM request that includes tool definitions is sent

#### HOOK-054
Requirement Text: The `BeforeToolSelection` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeToolSelection"`), `transcript_path`, and `llm_request` (in stable hook API format).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeToolSelection` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"BeforeToolSelection"`), `transcript_path`, and `llm_request` (in stable hook API format)

#### HOOK-055
Requirement Text: [Target] When a BeforeToolSelection hook returns `toolConfig` with `allowedFunctionNames` in `hookSpecificOutput`, the caller shall apply the `allowedFunctionNames` to the request's `toolConfig`, restricting which tools the model may call. Tool restriction works through `toolConfig.allowedFunctionNames` — the `tools` definitions list is passed through unchanged. Currently callers fire-and-forget BeforeToolSelection results (`void triggerBeforeToolSelectionHook(...)` in geminiChat.ts).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeToolSelection hook returns `toolConfig` with `allowedFunctionNames` in `hookSpecificOutput`
- THEN: the caller shall apply the `allowedFunctionNames` to the request's `toolConfig`, restricting which tools the model may call. Tool restriction works through `toolConfig.allowedFunctionNames` — the `tools` definitions list is passed through unchanged. Currently callers fire-and-forget BeforeToolSelection results (`void triggerBeforeToolSelectionHook(...)` in geminiChat.ts)

#### HOOK-056
Requirement Text: [Target] When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"AUTO"`, `"ANY"`, or `"NONE"`, the caller shall apply the specified tool-calling mode. Currently callers fire-and-forget BeforeToolSelection results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeToolSelection hook returns `toolConfig` with `mode` = `"AUTO"`
- THEN: `"ANY"`, or `"NONE"`, the caller shall apply the specified tool-calling mode. Currently callers fire-and-forget BeforeToolSelection results

#### HOOK-057
Requirement Text: [Target] When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"NONE"`, the caller shall ensure the model cannot call any tools for that request. Currently callers fire-and-forget BeforeToolSelection results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeToolSelection hook returns `toolConfig` with `mode` = `"NONE"`
- THEN: the caller shall ensure the model cannot call any tools for that request. Currently callers fire-and-forget BeforeToolSelection results

#### HOOK-058
Requirement Text: [Target] When a BeforeToolSelection hook returns `continue` = `false`, the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeToolSelection results.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeToolSelection hook returns `continue` = `false`
- THEN: the caller shall terminate the agent loop. Currently callers fire-and-forget BeforeToolSelection results

#### HOOK-059
Requirement Text: The BeforeToolSelection hook shall fire on every tool-selection request without matcher filtering.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The BeforeToolSelection hook shall fire on every tool-selection request without matcher filtering

#### HOOK-060
Requirement Text: If a BeforeToolSelection hook script fails, then the hook system shall not modify the request's tool configuration and shall log a warning via `DebugLogger` at warn level (fail-open).
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a BeforeToolSelection hook script fails
- THEN: the hook system shall not modify the request's tool configuration and shall log a warning via `DebugLogger` at warn level (fail-open)

### Section 22. Caller Integration — Model Pipeline
Coverage: 7 active requirements (HOOK-135..HOOK-141).

#### HOOK-135
Requirement Text: The rewritten `fireBeforeModelHook` shall return `Promise<BeforeModelHookResult>` with fields `blocked`, `reason`, `syntheticResponse`, and `modifiedRequest`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten `fireBeforeModelHook` shall return `Promise<BeforeModelHookResult>` with fields `blocked`, `reason`, `syntheticResponse`, and `modifiedRequest`

#### HOOK-136
Requirement Text: The rewritten `fireAfterModelHook` shall return `Promise<AfterModelHookResult>` with field `response` (either the modified or original `GenerateContentResponse`).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten `fireAfterModelHook` shall return `Promise<AfterModelHookResult>` with field `response` (either the modified or original `GenerateContentResponse`)

#### HOOK-137
Requirement Text: The rewritten `fireBeforeToolSelectionHook` shall return `Promise<BeforeToolSelectionHookResult>` with optional fields `toolConfig` and `tools`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten `fireBeforeToolSelectionHook` shall return `Promise<BeforeToolSelectionHookResult>` with optional fields `toolConfig` and `tools`

#### HOOK-138
Requirement Text: When `fireBeforeModelHook` returns `blocked: true` with a `syntheticResponse`, the caller (`geminiChat.ts`) shall skip the streaming API call entirely and yield the synthetic response directly.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeModelHook` returns `blocked: true` with a `syntheticResponse`
- THEN: the caller (`geminiChat.ts`) shall skip the streaming API call entirely and yield the synthetic response directly

#### HOOK-139
Requirement Text: When `fireBeforeModelHook` returns a `modifiedRequest`, the caller shall use the modified `GenerateContentParameters` for the streaming API call.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeModelHook` returns a `modifiedRequest`
- THEN: the caller shall use the modified `GenerateContentParameters` for the streaming API call

#### HOOK-140
Requirement Text: When `fireBeforeToolSelectionHook` returns a `toolConfig`, the caller shall apply it to the request's tool configuration.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeToolSelectionHook` returns a `toolConfig`
- THEN: the caller shall apply it to the request's tool configuration

#### HOOK-141
Requirement Text: The callers shall deal in SDK types (`GenerateContentParameters`, `GenerateContentResponse`) and shall never touch `LLMRequest`/`LLMResponse` directly — the translator boundary shall be fully encapsulated within `HookEventHandler` and the output classes.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The callers shall deal in SDK types (`GenerateContentParameters`, `GenerateContentResponse`) and shall never touch `LLMRequest`/`LLMResponse` directly — the translator boundary shall be fully encapsulated within `HookEventHandler` and the output classes

### Section 29. Tool Selection — applyToolConfigModifications
Coverage: 2 active requirements (HOOK-167..HOOK-168).

#### HOOK-167
Requirement Text: The `BeforeToolSelectionHookOutput.applyToolConfigModifications()` shall modify the `toolConfig` (mode and allowedFunctionNames) but shall not filter or remove tool definitions from the `tools` list.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeToolSelectionHookOutput.applyToolConfigModifications()` shall modify the `toolConfig` (mode and allowedFunctionNames) but shall not filter or remove tool definitions from the `tools` list

#### HOOK-168
Requirement Text: Tool restriction shall work through the `toolConfig.allowedFunctionNames` mechanism, not by removing tool definitions.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: Tool restriction shall work through the `toolConfig.allowedFunctionNames` mechanism, not by removing tool definitions

### Section 31. Streaming Constraints
Coverage: 3 active requirements (HOOK-172..HOOK-174).

#### HOOK-172
Requirement Text: The AfterModel hook shall fire once per model call, against the complete aggregated response — not per streaming chunk.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The AfterModel hook shall fire once per model call, against the complete aggregated response — not per streaming chunk

#### HOOK-173
Requirement Text: AfterModel modifications shall apply to the stored/processed version of the response, not to content already displayed during streaming.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: AfterModel modifications shall apply to the stored/processed version of the response, not to content already displayed during streaming

#### HOOK-174
Requirement Text: When `fireBeforeModelHook` returns `blocked: true`, the caller shall skip opening any stream and shall not process any streaming chunks.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeModelHook` returns `blocked: true`
- THEN: the caller shall skip opening any stream and shall not process any streaming chunks

### Section 36. Additional Completeness Requirements (R2)
Coverage: 10 active requirements (HOOK-199..HOOK-208).

#### HOOK-199
Requirement Text: The `BeforeToolHookOutput` class shall support `permissionDecision` and `permissionDecisionReason` as compatibility fields in `hookSpecificOutput`. When `permissionDecision` is `'block'` or `'deny'`, `isBlockingDecision()` shall return `true`. When `permissionDecisionReason` is a string, `getEffectiveReason()` shall return that string in preference to the top-level `reason` field.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeToolHookOutput` class shall support `permissionDecision` and `permissionDecisionReason` as compatibility fields in `hookSpecificOutput`. When `permissionDecision` is `'block'` or `'deny'`, `isBlockingDecision()` shall return `true`. When `permissionDecisionReason` is a string, `getEffectiveReason()` shall return that string in preference to the top-level `reason` field

#### HOOK-200
Requirement Text: When `createHookOutput('BeforeTool', data)` is called, the factory shall return a `DefaultHookOutput` instance (not `BeforeToolHookOutput`). This means `isBlockingDecision()` on the returned object will not check `hookSpecificOutput.permissionDecision` — only the top-level `decision` field is checked. When the aggregator's `createSpecificHookOutput(output, 'BeforeTool')` is called, it shall return a `BeforeToolHookOutput` instance, which does check `permissionDecision`. This is observable: calling `createHookOutput('BeforeTool', { hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `false`, while `new BeforeToolHookOutput({ hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `true`. Callers that need compatibility field support (HOOK-199) must use the aggregator path, not the factory.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `createHookOutput('BeforeTool'
- THEN: data)` is called, the factory shall return a `DefaultHookOutput` instance (not `BeforeToolHookOutput`). This means `isBlockingDecision()` on the returned object will not check `hookSpecificOutput.permissionDecision` — only the top-level `decision` field is checked. When the aggregator's `createSpecificHookOutput(output, 'BeforeTool')` is called, it shall return a `BeforeToolHookOutput` instance, which does check `permissionDecision`. This is observable: calling `createHookOutput('BeforeTool', { hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `false`, while `new BeforeToolHookOutput({ hookSpecificOutput: { permissionDecision: 'block' } }).isBlockingDecision()` returns `true`. Callers that need compatibility field support (HOOK-199) must use the aggregator path, not the factory

#### HOOK-201
Requirement Text: When a hook script exits with code 0 and writes a double-encoded JSON string to stdout (a JSON string containing a JSON object), the hook system shall detect that the parsed result is a string, parse it a second time, and use the inner JSON object as the hook output.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes a double-encoded JSON string to stdout (a JSON string containing a JSON object)
- THEN: the hook system shall detect that the parsed result is a string, parse it a second time, and use the inner JSON object as the hook output

#### HOOK-202
Requirement Text: [Target] When a BeforeModel hook returns `blocked: true` with `syntheticResponse: undefined` (i.e., block without providing a synthetic response), the caller shall skip the model call and provide an empty/error response to the agent. The specific empty response format shall be: a `GenerateContentResponse` with an empty candidates array or a single candidate with empty content, allowing the agent to detect that no model output was produced.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeModel hook returns `blocked: true` with `syntheticResponse: undefined` (i.e.
- THEN: block without providing a synthetic response), the caller shall skip the model call and provide an empty/error response to the agent. The specific empty response format shall be: a `GenerateContentResponse` with an empty candidates array or a single candidate with empty content, allowing the agent to detect that no model output was produced

#### HOOK-203
Requirement Text: The hook system shall accept, register, and execute hooks configured for out-of-scope events (`SessionStart`, `SessionEnd`, `Notification`, `PreCompress`, `BeforeAgent`, `AfterAgent`). Hook scripts for these events shall receive stdin JSON, execute normally, and produce stdout/stderr. However, no caller in the rewrite scope shall `await` or apply results from these events — their outputs are discarded. This constitutes non-regression: these events must continue to fire as they do today (fire-and-forget).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall accept, register, and execute hooks configured for out-of-scope events (`SessionStart`, `SessionEnd`, `Notification`, `PreCompress`, `BeforeAgent`, `AfterAgent`). Hook scripts for these events shall receive stdin JSON, execute normally, and produce stdout/stderr. However, no caller in the rewrite scope shall `await` or apply results from these events — their outputs are discarded. This constitutes non-regression: these events must continue to fire as they do today (fire-and-forget)

#### HOOK-204
Requirement Text: [Target] When `coreToolScheduler` receives a blocked BeforeTool result (via HOOK-129), the scheduler shall transition the tool's status from `executing` to `idle`, store the blocked result in its buffer, and publish the result. The scheduler shall not re-queue or retry the blocked tool — the block is a terminal outcome for that tool invocation.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `coreToolScheduler` receives a blocked BeforeTool result (via HOOK-129)
- THEN: the scheduler shall transition the tool's status from `executing` to `idle`, store the blocked result in its buffer, and publish the result. The scheduler shall not re-queue or retry the blocked tool — the block is a terminal outcome for that tool invocation

#### HOOK-205
Requirement Text: [Target] When a `BeforeToolSelection` event fires, the `HookEventHandler` shall translate the `GenerateContentParameters` to `LLMRequest` via `defaultHookTranslator.toHookLLMRequest()` and include it in the `BeforeToolSelectionInput`. The caller shall pass the actual `GenerateContentParameters` (not a placeholder) to the trigger function.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a `BeforeToolSelection` event fires
- THEN: the `HookEventHandler` shall translate the `GenerateContentParameters` to `LLMRequest` via `defaultHookTranslator.toHookLLMRequest()` and include it in the `BeforeToolSelectionInput`. The caller shall pass the actual `GenerateContentParameters` (not a placeholder) to the trigger function

#### HOOK-206
Requirement Text: When the first hook event fires, the trigger function shall call `hookSystem.initialize()` before delegating to the event handler (see HOOK-008). Construction of the `HookSystem` itself (in `Config.getHookSystem()`) shall not call `initialize()` — initialization is deferred to the first event fire. This ensures zero startup overhead: constructing `Config` with `enableHooks: true` does not read hook configuration files or allocate registry entries until a hook event actually fires.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the first hook event fires
- THEN: the trigger function shall call `hookSystem.initialize()` before delegating to the event handler (see HOOK-008). Construction of the `HookSystem` itself (in `Config.getHookSystem()`) shall not call `initialize()` — initialization is deferred to the first event fire. This ensures zero startup overhead: constructing `Config` with `enableHooks: true` does not read hook configuration files or allocate registry entries until a hook event actually fires

#### HOOK-207
Requirement Text: If a stream aborts before the complete `GenerateContentResponse` is assembled (e.g., network error, timeout, or user cancellation), then the AfterModel hook shall not fire for that model call. The hook system fires AfterModel only after a complete response is available (per HOOK-050). Callers shall handle the stream error through normal error handling paths, not through the hook system.
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a stream aborts before the complete `GenerateContentResponse` is assembled (e.g., network error, timeout, or user cancellation)
- THEN: the AfterModel hook shall not fire for that model call. The hook system fires AfterModel only after a complete response is available (per HOOK-050). Callers shall handle the stream error through normal error handling paths, not through the hook system

#### HOOK-208
Requirement Text: When multiple AfterTool hooks return `additionalContext`, `systemMessage`, and `suppressOutput` simultaneously, the aggregated result shall include all three effects: (1) `additionalContext` strings concatenated (newline-separated), (2) `systemMessage` strings concatenated (newline-separated), (3) `suppressOutput` set to `true` if any hook returned `true`. These effects are independent and apply in parallel — there is no precedence or ordering between them.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple AfterTool hooks return `additionalContext`
- THEN: `systemMessage`, and `suppressOutput` simultaneously, the aggregated result shall include all three effects: (1) `additionalContext` strings concatenated (newline-separated), (2) `systemMessage` strings concatenated (newline-separated), (3) `suppressOutput` set to `true` if any hook returned `true`. These effects are independent and apply in parallel — there is no precedence or ordering between them

Canonical requirement source: project-plans/hooksystemrewrite/requirements.md.

## Resolved Requirement Set

Active requirements owned by this phase: HOOK-033, HOOK-034, HOOK-035, HOOK-036, HOOK-037, HOOK-038, HOOK-039, HOOK-040, HOOK-041, HOOK-042, HOOK-043, HOOK-044, HOOK-045, HOOK-046, HOOK-047, HOOK-048, HOOK-049, HOOK-050, HOOK-051, HOOK-052, HOOK-053, HOOK-054, HOOK-055, HOOK-056, HOOK-057, HOOK-058, HOOK-059, HOOK-060, HOOK-135, HOOK-136, HOOK-137, HOOK-138, HOOK-139, HOOK-140, HOOK-141, HOOK-167, HOOK-168, HOOK-172, HOOK-173, HOOK-174, HOOK-199, HOOK-200, HOOK-201, HOOK-202, HOOK-203, HOOK-204, HOOK-205, HOOK-206, HOOK-207, HOOK-208

## Current vs Target Delta

| Requirement | Current State | Target State |
|---|---|---|
| HOOK-036 | Currently callers fire-and-forget BeforeModel results (`void triggerBeforeModelHook(. | When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and provides an `llm_response` in `hookSpecificOutput`, the caller shall skip the model call and use the synthetic response as if the model had responded. |
| HOOK-037 | Currently callers fire-and-forget BeforeModel results. | When a BeforeModel hook script exits with code 0, returns valid JSON with `decision` = `"block"` or `"deny"`, and does not provide an `llm_response`, the caller shall skip the model call and return an empty/no-op response. |
| HOOK-038 | Currently callers fire-and-forget BeforeModel results. | When a BeforeModel hook returns a modified `llm_request` in `hookSpecificOutput`, the caller shall send the modified request to the model instead of the original. |
| HOOK-039 | Currently callers fire-and-forget BeforeModel results. | When a BeforeModel hook adds messages to the `llm_request.messages` array, the caller shall append those additional context messages after the existing messages in the model call. |
| HOOK-040 | Currently callers fire-and-forget BeforeModel results. | When a BeforeModel hook returns `continue` = `false`, the caller shall terminate the agent loop. |
| HOOK-046 | Currently callers fire-and-forget AfterModel results. | When an AfterModel hook returns a modified `llm_response` in `hookSpecificOutput`, the caller shall use the modified response downstream instead of the original. |
| HOOK-047 | Currently callers fire-and-forget AfterModel results. | When an AfterModel hook returns a completely new `llm_response`, the caller shall use the replacement as if the model had produced it. |
| HOOK-048 | Currently callers fire-and-forget AfterModel results (`void triggerAfterModelHook(. | When an AfterModel hook returns `continue` = `false`, the hook system shall generate a synthetic stop response containing the `stopReason` via `AfterModelHookOutput.getModifiedResponse()`, and the caller shall terminate the agent loop. |
| HOOK-049 | Current behavior must be confirmed from code before implementation in this phase. | When an AfterModel hook returns `suppressOutput` = `true`, the caller shall suppress the response from being displayed to the user while still processing it for tool calls and agent state. No caller acts on AfterModel outputs today (all callers use `void` prefix). |
| HOOK-055 | Currently callers fire-and-forget BeforeToolSelection results (`void triggerBeforeToolSelectionHook(. | When a BeforeToolSelection hook returns `toolConfig` with `allowedFunctionNames` in `hookSpecificOutput`, the caller shall apply the `allowedFunctionNames` to the request's `toolConfig`, restricting which tools the model may call. Tool restriction works through `toolConfig.allowedFunctionNames` — the `tools` definitions list is passed through unchanged. |
| HOOK-056 | Currently callers fire-and-forget BeforeToolSelection results. | When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"AUTO"`, `"ANY"`, or `"NONE"`, the caller shall apply the specified tool-calling mode. |
| HOOK-057 | Currently callers fire-and-forget BeforeToolSelection results. | When a BeforeToolSelection hook returns `toolConfig` with `mode` = `"NONE"`, the caller shall ensure the model cannot call any tools for that request. |
| HOOK-058 | Currently callers fire-and-forget BeforeToolSelection results. | When a BeforeToolSelection hook returns `continue` = `false`, the caller shall terminate the agent loop. |
| HOOK-202 | Current behavior must be confirmed from code before implementation in this phase. | When a BeforeModel hook returns `blocked: true` with `syntheticResponse: undefined` (i.e., block without providing a synthetic response), the caller shall skip the model call and provide an empty/error response to the agent. The specific empty response format shall be: a `GenerateContentResponse` with an empty candidates array or a single candidate with empty content, allowing the agent to detect that no model output was produced. |
| HOOK-204 | Current behavior must be confirmed from code before implementation in this phase. | When `coreToolScheduler` receives a blocked BeforeTool result (via HOOK-129), the scheduler shall transition the tool's status from `executing` to `idle`, store the blocked result in its buffer, and publish the result. The scheduler shall not re-queue or retry the blocked tool — the block is a terminal outcome for that tool invocation. |
| HOOK-205 | Current behavior must be confirmed from code before implementation in this phase. | When a `BeforeToolSelection` event fires, the `HookEventHandler` shall translate the `GenerateContentParameters` to `LLMRequest` via `defaultHookTranslator.toHookLLMRequest()` and include it in the `BeforeToolSelectionInput`. The caller shall pass the actual `GenerateContentParameters` (not a placeholder) to the trigger function. |

Each target delta above MUST be proven by phase verification tests before advancing.

## Implementation Tasks

### Files to Create
- packages/core/src/core/geminiChatHookTriggers.ts
- packages/core/src/core/geminiChatHookTriggers.test.ts

### Files to Modify
- packages/core/src/core/geminiChat.ts
- packages/core/src/core/geminiChat.test.ts
- packages/core/src/hooks/hookTranslator.ts
- packages/core/src/hooks/types.ts
- packages/core/src/providers/openai/OpenAIResponsesProvider.ts

### File and Symbol-Level Tasks
- packages/core/src/core/geminiChatHookTriggers.ts: fireBeforeModelHook(), fireAfterModelHook(), fireBeforeToolSelectionHook()
- packages/core/src/core/geminiChat.ts: apply blocked/synthetic/modified request-result contracts; avoid void fire-and-forget
- packages/core/src/hooks/hookTranslator.ts: full-fidelity request/response translation for model hooks
- packages/core/src/hooks/types.ts: result contracts for before/after model and tool selection
- packages/core/src/providers/openai/OpenAIResponsesProvider.ts: parity checks for response event handling where relevant

### Required Markers
- @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P12
- @requirement:HOOK-033, HOOK-034, HOOK-035, HOOK-036, HOOK-037, HOOK-038, HOOK-039, HOOK-040, HOOK-041, HOOK-042, HOOK-043, HOOK-044, HOOK-045, HOOK-046, HOOK-047, HOOK-048, HOOK-049, HOOK-050, HOOK-051, HOOK-052, HOOK-053, HOOK-054, HOOK-055, HOOK-056, HOOK-057, HOOK-058, HOOK-059, HOOK-060, HOOK-135, HOOK-136, HOOK-137, HOOK-138, HOOK-139, HOOK-140, HOOK-141, HOOK-167, HOOK-168, HOOK-172, HOOK-173, HOOK-174, HOOK-199, HOOK-200, HOOK-201, HOOK-202, HOOK-203, HOOK-204, HOOK-205, HOOK-206, HOOK-207, HOOK-208
- @pseudocode:analysis/pseudocode/04-model-hook-pipeline.md

## Verification Commands

### Structural Checks
- grep -R "@plan:PLAN-20260216-HOOKSYSTEMREWRITE.P12" packages/core packages/cli integration-tests
- grep -R "@requirement:" packages/core packages/cli integration-tests
- npm run test -- packages/core/src/core/geminiChatHookTriggers.test.ts packages/core/src/core/geminiChat.test.ts packages/core/src/hooks/hookTranslator.test.ts
- npm run typecheck

### Deferred Implementation Detection
- rg -n -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented)" packages/core packages/cli integration-tests --glob "*.ts" --glob "*.tsx"

### Outcome-Focused Verification (Model Pipeline)
- npm run test -- packages/core/src/core/geminiChat.test.ts -t "blocked BeforeModel skips provider call"
- npm run test -- packages/core/src/core/geminiChat.test.ts -t "synthetic response path is returned as final response"
- npm run test -- packages/core/src/core/geminiChat.test.ts -t "BeforeToolSelection applies toolConfig without removing tools"
- npm run test -- packages/core/src/core/geminiChat.test.ts -t "shouldStop/stopReason contract is propagated"

### Semantic Verification Checklist
- [ ] Contracts compile and are reachable from call paths.
- [ ] Stub behavior is minimal and temporary.
- [ ] No parallel implementation variants were introduced.
- [ ] Next phase has clear failing tests to implement.

### Feature Actually Works
- node scripts/start.js --profile-load synthetic --prompt "validate hooks phase 12 behavior"

## Success Criteria
- Structural commands pass.
- Outcome-focused tests pass.
- Semantic checklist is complete with evidence in completion marker.

## Failure Recovery
- git checkout -- packages/core/src/core/geminiChatHookTriggers.ts packages/core/src/core/geminiChatHookTriggers.test.ts packages/core/src/core/geminiChat.ts packages/core/src/core/geminiChat.test.ts packages/core/src/hooks/hookTranslator.ts packages/core/src/hooks/types.ts packages/core/src/providers/openai/OpenAIResponsesProvider.ts
- sed -n '1,120p' project-plans/hooksystemrewrite/plan/12-model-hook-pipeline-stub.md

## Phase Completion Marker
- Update project-plans/hooksystemrewrite/.completed/P12.md
- Required marker update: set `Status: COMPLETED` and fill all evidence fields.
