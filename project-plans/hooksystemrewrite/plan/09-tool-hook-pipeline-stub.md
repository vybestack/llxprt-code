# Phase 09: Tool Hook Pipeline Stub

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P09

## Prerequisites
- Completion marker exists and is complete: project-plans/hooksystemrewrite/.completed/P08a.md
- Verification command: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P08a.md
- Preflight gate complete: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P00a.md

## Requirements Implemented (Expanded)

### Section 3. BeforeTool Hook Event
Coverage: 12 active requirements (HOOK-014..HOOK-024).

#### HOOK-014
Requirement Text: When a tool is about to execute, the hook system shall fire a `BeforeTool` event immediately before execution.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a tool is about to execute
- THEN: the hook system shall fire a `BeforeTool` event immediately before execution

#### HOOK-015
Requirement Text: The `BeforeTool` hook input shall include `session_id`, `cwd`, `timestamp` (ISO 8601), `hook_event_name` (always `"BeforeTool"`), `transcript_path`, `tool_name`, and `tool_input`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeTool` hook input shall include `session_id`, `cwd`, `timestamp` (ISO 8601), `hook_event_name` (always `"BeforeTool"`), `transcript_path`, `tool_name`, and `tool_input`

#### HOOK-016a
Requirement Text: When a BeforeTool hook script exits with code 2 and stderr is non-empty, the hook system shall treat it as a block/deny decision, prevent the tool from executing, and use the stderr text as the blocking `reason` via `convertPlainTextToHookOutput()`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook script exits with code 2 and stderr is non-empty
- THEN: the hook system shall treat it as a block/deny decision, prevent the tool from executing, and use the stderr text as the blocking `reason` via `convertPlainTextToHookOutput()`

#### HOOK-016b
Requirement Text: When a BeforeTool hook script exits with code 0 and returns valid JSON on stdout containing `decision` = `"block"` or `"deny"`, the hook system shall prevent the tool from executing and use the `reason` field from the JSON output as the blocking reason.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook script exits with code 0 and returns valid JSON on stdout containing `decision` = `"block"` or `"deny"`
- THEN: the hook system shall prevent the tool from executing and use the `reason` field from the JSON output as the blocking reason

#### HOOK-017
Requirement Text: [Target] When a BeforeTool hook blocks a tool, the caller shall construct a `ToolResult` whose `llmContent` field contains the blocking `reason` string (from `DefaultHookOutput.getEffectiveReason()`), so that the model receives the block reason as the tool's output.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook blocks a tool
- THEN: the caller shall construct a `ToolResult` whose `llmContent` field contains the blocking `reason` string (from `DefaultHookOutput.getEffectiveReason()`), so that the model receives the block reason as the tool's output

#### HOOK-018
Requirement Text: When a BeforeTool hook script exits with code 0 and returns `decision` = `"allow"` or `"approve"` (or no decision field), the tool shall execute normally.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook script exits with code 0 and returns `decision` = `"allow"` or `"approve"` (or no decision field)
- THEN: the tool shall execute normally

#### HOOK-019
Requirement Text: [Target] When a BeforeTool hook script returns a modified `tool_input` in `hookSpecificOutput`, the tool shall execute with the modified arguments instead of the originals.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook script returns a modified `tool_input` in `hookSpecificOutput`
- THEN: the tool shall execute with the modified arguments instead of the originals

#### HOOK-020
Requirement Text: [Target] When a BeforeTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook returns `continue` = `false`
- THEN: the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user

#### HOOK-021
Requirement Text: When a BeforeTool event is fired, the hook planner shall invoke only hooks whose `matcher` regex matches the `tool_name`; hooks with non-matching matchers shall be skipped.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool event is fired
- THEN: the hook planner shall invoke only hooks whose `matcher` regex matches the `tool_name`; hooks with non-matching matchers shall be skipped

#### HOOK-022
Requirement Text: When a BeforeTool hook has no `matcher` configured, the hook shall fire for all tools.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook has no `matcher` configured
- THEN: the hook shall fire for all tools

#### HOOK-023
Requirement Text: If a BeforeTool hook script crashes, times out, or exits with any code other than 0 or 2, then the hook system shall allow the tool to execute normally (fail-open) and log a warning via `DebugLogger` at warn level including the exit code and stderr content.
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a BeforeTool hook script crashes, times out, or exits with any code other than 0 or 2
- THEN: the hook system shall allow the tool to execute normally (fail-open) and log a warning via `DebugLogger` at warn level including the exit code and stderr content

#### HOOK-024
Requirement Text: [Target] When `applyHookOutputToInput()` is called for a sequential BeforeTool chain, the HookRunner shall merge `hookSpecificOutput.tool_input` into the next hook's `tool_input` field.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `applyHookOutputToInput()` is called for a sequential BeforeTool chain
- THEN: the HookRunner shall merge `hookSpecificOutput.tool_input` into the next hook's `tool_input` field

### Section 4. AfterTool Hook Event
Coverage: 8 active requirements (HOOK-025..HOOK-032).

#### HOOK-025
Requirement Text: When a tool finishes executing, the hook system shall fire an `AfterTool` event immediately after execution and before the result is sent to the model.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a tool finishes executing
- THEN: the hook system shall fire an `AfterTool` event immediately after execution and before the result is sent to the model

#### HOOK-026
Requirement Text: The `AfterTool` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterTool"`), `transcript_path`, `tool_name`, `tool_input`, and `tool_response` (an object containing `llmContent`, `returnDisplay`, `metadata`, and optional `error` fields as defined by the `ToolResult` type).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `AfterTool` hook input shall include `session_id`, `cwd`, `timestamp`, `hook_event_name` (always `"AfterTool"`), `transcript_path`, `tool_name`, `tool_input`, and `tool_response` (an object containing `llmContent`, `returnDisplay`, `metadata`, and optional `error` fields as defined by the `ToolResult` type)

#### HOOK-027
Requirement Text: [Target] When an AfterTool hook returns `additionalContext` in `hookSpecificOutput`, the hook system shall append that text to the tool result's LLM-facing content.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterTool hook returns `additionalContext` in `hookSpecificOutput`
- THEN: the hook system shall append that text to the tool result's LLM-facing content

#### HOOK-028
Requirement Text: [Target] When an AfterTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterTool hook returns `continue` = `false`
- THEN: the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user

#### HOOK-029
Requirement Text: [Target] When an AfterTool hook returns `suppressOutput` = `true`, the tool result shall not be displayed to the user (the `suppressDisplay` flag shall be set on the ToolResult). The model shall still receive the tool result's LLM-facing content.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterTool hook returns `suppressOutput` = `true`
- THEN: the tool result shall not be displayed to the user (the `suppressDisplay` flag shall be set on the ToolResult). The model shall still receive the tool result's LLM-facing content

#### HOOK-030
Requirement Text: [Target] When an AfterTool hook returns a `systemMessage` field, the hook system shall inject that text into the tool result's LLM-facing content as a system-role annotation.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: an AfterTool hook returns a `systemMessage` field
- THEN: the hook system shall inject that text into the tool result's LLM-facing content as a system-role annotation

#### HOOK-031
Requirement Text: If an AfterTool hook script fails (crash, timeout, non-0/non-2 exit), then the hook system shall not modify the tool result and shall log a warning via `DebugLogger` at warn level including the exit code and stderr content (fail-open).
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: an AfterTool hook script fails (crash, timeout, non-0/non-2 exit)
- THEN: the hook system shall not modify the tool result and shall log a warning via `DebugLogger` at warn level including the exit code and stderr content (fail-open)

#### HOOK-032
Requirement Text: When AfterTool hooks are configured with a `matcher`, only scripts whose regex matches the `tool_name` shall be invoked.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: AfterTool hooks are configured with a `matcher`
- THEN: only scripts whose regex matches the `tool_name` shall be invoked

### Section 21. Caller Integration — Tool Pipeline
Coverage: 8 active requirements (HOOK-127..HOOK-134).

#### HOOK-127
Requirement Text: The rewritten `fireBeforeToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten `fireBeforeToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`

#### HOOK-128
Requirement Text: The rewritten `fireAfterToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten `fireAfterToolHook` shall return `Promise<DefaultHookOutput | undefined>` instead of `Promise<void>`

#### HOOK-129
Requirement Text: [Target] When `coreToolScheduler` receives a blocked BeforeTool result, it shall treat the block as a completed tool invocation that produced an error-like result, set status to `idle`, buffer the blocked result, and publish it so the model sees the block reason.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `coreToolScheduler` receives a blocked BeforeTool result
- THEN: it shall treat the block as a completed tool invocation that produced an error-like result, set status to `idle`, buffer the blocked result, and publish it so the model sees the block reason

#### HOOK-130
Requirement Text: [Target] The scheduler shall not retry blocked tool calls — the model shall decide how to proceed based on the block reason.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The scheduler shall not retry blocked tool calls — the model shall decide how to proceed based on the block reason

#### HOOK-131
Requirement Text: [Target] When `afterOutput.systemMessage` is present, the caller shall append it to `toolResult.llmContent` as a system-role annotation using the format `"\n\n[System] " + systemMessage`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `afterOutput.systemMessage` is present
- THEN: the caller shall append it to `toolResult.llmContent` as a system-role annotation using the format `"\n\n[System] " + systemMessage`

#### HOOK-132
Requirement Text: [Target] When `afterOutput.suppressOutput` is `true`, the caller shall set `toolResult.suppressDisplay = true` so the result is sent to the LLM but not displayed to the user.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `afterOutput.suppressOutput` is `true`
- THEN: the caller shall set `toolResult.suppressDisplay = true` so the result is sent to the LLM but not displayed to the user

#### HOOK-133
Requirement Text: The `executeToolWithHooks` wrapper shall accept `(config, toolName, toolInput, executeFn)` and return `Promise<ToolResult>`, encapsulating the full before→execute→after lifecycle.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `executeToolWithHooks` wrapper shall accept `(config, toolName, toolInput, executeFn)` and return `Promise<ToolResult>`, encapsulating the full before→execute→after lifecycle

#### HOOK-134
Requirement Text: [Target] No caller shall use `void` prefix on any hook trigger call — every caller shall `await` the result and apply it.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: No caller shall use `void` prefix on any hook trigger call — every caller shall `await` the result and apply it

### Section 26. Output Field Contracts
Coverage: 4 active requirements (HOOK-157..HOOK-160).

#### HOOK-157
Requirement Text: The common hook output fields shall include `decision` (string or null), `reason` (string), `continue` (boolean), `stopReason` (string), `suppressOutput` (boolean), `systemMessage` (string), and `hookSpecificOutput` (object).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The common hook output fields shall include `decision` (string or null), `reason` (string), `continue` (boolean), `stopReason` (string), `suppressOutput` (boolean), `systemMessage` (string), and `hookSpecificOutput` (object)

#### HOOK-158
Requirement Text: When `decision` is absent or null in a hook's output, the hook system shall treat it as "no decision" (equivalent to allow).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `decision` is absent or null in a hook's output
- THEN: the hook system shall treat it as "no decision" (equivalent to allow)

#### HOOK-159
Requirement Text: The `systemMessage` field shall always be surfaced to the model through the LLM context channel, and shall never be displayed to the user as standalone UI output.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `systemMessage` field shall always be surfaced to the model through the LLM context channel, and shall never be displayed to the user as standalone UI output

#### HOOK-160
Requirement Text: The `success` field on `AggregatedHookResult` shall represent hook execution health, not policy outcome — callers shall check `finalOutput.isBlockingDecision()` for policy decisions. See HOOK-213 and HOOK-214 for detailed semantics and terminology definitions.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `success` field on `AggregatedHookResult` shall represent hook execution health, not policy outcome — callers shall check `finalOutput.isBlockingDecision()` for policy decisions. See HOOK-213 and HOOK-214 for detailed semantics and terminology definitions

### Section 30. BeforeToolHookOutput Compatibility
Coverage: 3 active requirements (HOOK-169..HOOK-171).

#### HOOK-169
Requirement Text: The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecision` as a compatibility field for blocking detection via `isBlockingDecision()`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecision` as a compatibility field for blocking detection via `isBlockingDecision()`

#### HOOK-170
Requirement Text: The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecisionReason` as a compatibility field for reason extraction via `getEffectiveReason()`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeToolHookOutput` class shall check `hookSpecificOutput.permissionDecisionReason` as a compatibility field for reason extraction via `getEffectiveReason()`

#### HOOK-171
Requirement Text: Hook scripts shall use the top-level `decision` field for reliable blocking — the compatibility `permissionDecision` field is only checked after aggregation and may be missed during multi-hook OR merging.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: Hook scripts shall use the top-level `decision` field for reliable blocking — the compatibility `permissionDecision` field is only checked after aggregation and may be missed during multi-hook OR merging

### Section 34. New Requirements — Completeness Gaps (R1)
Coverage: 14 active requirements (HOOK-182..HOOK-198).

#### HOOK-182
Requirement Text: The `HookDecision` type shall include the value `"ask"`. When a hook returns `decision: "ask"`, the hook system shall treat it as a non-blocking decision (equivalent to `"allow"`). The `"ask"` value is reserved for future use (potential user-prompting behavior) and is not currently distinguished from `"allow"` in any code path.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookDecision` type shall include the value `"ask"`. When a hook returns `decision: "ask"`, the hook system shall treat it as a non-blocking decision (equivalent to `"allow"`). The `"ask"` value is reserved for future use (potential user-prompting behavior) and is not currently distinguished from `"allow"` in any code path

#### HOOK-183
Requirement Text: [Target] When a BeforeTool hook blocks execution and the `executeToolWithHooks` wrapper is used, the wrapper shall return a `ToolResult` whose `llmContent` field contains the blocking reason string (from `DefaultHookOutput.getEffectiveReason()`). The caller detects the block by checking `beforeOutput?.isBlockingDecision()` before calling `executeFn()` — there is no `blocked` property on `ToolResult`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a BeforeTool hook blocks execution and the `executeToolWithHooks` wrapper is used
- THEN: the wrapper shall return a `ToolResult` whose `llmContent` field contains the blocking reason string (from `DefaultHookOutput.getEffectiveReason()`). The caller detects the block by checking `beforeOutput?.isBlockingDecision()` before calling `executeFn()` — there is no `blocked` property on `ToolResult`

#### HOOK-184
Requirement Text: When `fireBeforeModelHook` processes aggregated hook results, both `isBlockingDecision()` and `shouldStopExecution()` (i.e., `continue: false`) shall map to `blocked: true` in the returned `BeforeModelHookResult`. A hook that sets `continue: false` without a blocking decision still produces `blocked: true`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeModelHook` processes aggregated hook results
- THEN: both `isBlockingDecision()` and `shouldStopExecution()` (i.e., `continue: false`) shall map to `blocked: true` in the returned `BeforeModelHookResult`. A hook that sets `continue: false` without a blocking decision still produces `blocked: true`

#### HOOK-187
Requirement Text: The hook registry shall sort hooks by source priority when returning hooks for an event. The `getSourcePriority()` function defines a four-tier ordering: Project (1) > User (2) > System (3) > Extensions (4), where a lower number indicates higher priority. However, only two tiers are exercised in production: Project and Extensions. The User and System tiers exist in the `ConfigSource` enum for forward compatibility but have no assignment path in `processHooksFromConfig()`. See HOOK-086 for the production two-tier constraint.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook registry shall sort hooks by source priority when returning hooks for an event. The `getSourcePriority()` function defines a four-tier ordering: Project (1) > User (2) > System (3) > Extensions (4), where a lower number indicates higher priority. However, only two tiers are exercised in production: Project and Extensions. The User and System tiers exist in the `ConfigSource` enum for forward compatibility but have no assignment path in `processHooksFromConfig()`. See HOOK-086 for the production two-tier constraint

#### HOOK-188
Requirement Text: The hook system shall inject the environment variables `LLXPRT_PROJECT_DIR`, `GEMINI_PROJECT_DIR`, and `CLAUDE_PROJECT_DIR` (all set to `input.cwd`) into every hook script's child process environment, inheriting all other environment variables from the parent process via `process.env`. Additionally, the hook system shall support `$LLXPRT_PROJECT_DIR`, `$GEMINI_PROJECT_DIR`, and `$CLAUDE_PROJECT_DIR` variable expansion in the `command` string itself (via `expandCommand()`).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall inject the environment variables `LLXPRT_PROJECT_DIR`, `GEMINI_PROJECT_DIR`, and `CLAUDE_PROJECT_DIR` (all set to `input.cwd`) into every hook script's child process environment, inheriting all other environment variables from the parent process via `process.env`. Additionally, the hook system shall support `$LLXPRT_PROJECT_DIR`, `$GEMINI_PROJECT_DIR`, and `$CLAUDE_PROJECT_DIR` variable expansion in the `command` string itself (via `expandCommand()`)

#### HOOK-189
Requirement Text: When a hook script exits with code 2 and stderr is non-empty, the hook system shall use the stderr text as the blocking reason by passing it through `convertPlainTextToHookOutput()` with exit code 2, producing `{ decision: 'deny', reason: <stderr_text> }`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 2 and stderr is non-empty
- THEN: the hook system shall use the stderr text as the blocking reason by passing it through `convertPlainTextToHookOutput()` with exit code 2, producing `{ decision: 'deny', reason: <stderr_text> }`

#### HOOK-190
Requirement Text: The hook aggregator shall use three distinct merge strategies based on event type: (1) OR-merge for tool and agent events (BeforeTool, AfterTool, BeforeAgent, AfterAgent, SessionStart) — any block wins, messages concatenated; (2) field-replacement merge for model events (BeforeModel, AfterModel) — later outputs override earlier for same fields; (3) union-merge for tool selection (BeforeToolSelection) — function names unioned, mode resolved by most-restrictive-wins (NONE > ANY > AUTO).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook aggregator shall use three distinct merge strategies based on event type: (1) OR-merge for tool and agent events (BeforeTool, AfterTool, BeforeAgent, AfterAgent, SessionStart) — any block wins, messages concatenated; (2) field-replacement merge for model events (BeforeModel, AfterModel) — later outputs override earlier for same fields; (3) union-merge for tool selection (BeforeToolSelection) — function names unioned, mode resolved by most-restrictive-wins (NONE > ANY > AUTO)

#### HOOK-191
Requirement Text: When the hook registry encounters a hook configuration with a `type` field that is not `'command'` or `'plugin'`, or a `type: 'command'` configuration without a `command` field, the registry shall discard the configuration and log a warning via `DebugLogger` at warn level.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the hook registry encounters a hook configuration with a `type` field that is not `'command'` or `'plugin'`
- THEN: or a `type: 'command'` configuration without a `command` field, the registry shall discard the configuration and log a warning via `DebugLogger` at warn level

#### HOOK-192
Requirement Text: If a hook script's stdin write produces an `EPIPE` error (because the child process closed stdin early), then the hook system shall suppress the error and continue processing the hook's stdout/stderr output.
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a hook script's stdin write produces an `EPIPE` error (because the child process closed stdin early)
- THEN: the hook system shall suppress the error and continue processing the hook's stdout/stderr output

#### HOOK-193
Requirement Text: When a hook script exits with code 0 and writes a JSON string value to stdout (double-encoded JSON), the hook system shall parse the string value again to extract the inner JSON object.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes a JSON string value to stdout (double-encoded JSON)
- THEN: the hook system shall parse the string value again to extract the inner JSON object

#### HOOK-194
Requirement Text: The `BeforeModelHookOutput.getSyntheticResponse()` shall return a `GenerateContentResponse` only when `hookSpecificOutput.llm_response` is present in the hook output. When a hook sets `continue: false` (shouldStopExecution) without providing `llm_response`, `getSyntheticResponse()` shall return `undefined` — it does not auto-generate a stop response. This differs from `AfterModelHookOutput.getModifiedResponse()`, which does auto-generate a synthetic stop response when `shouldStopExecution()` is true.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeModelHookOutput.getSyntheticResponse()` shall return a `GenerateContentResponse` only when `hookSpecificOutput.llm_response` is present in the hook output. When a hook sets `continue: false` (shouldStopExecution) without providing `llm_response`, `getSyntheticResponse()` shall return `undefined` — it does not auto-generate a stop response. This differs from `AfterModelHookOutput.getModifiedResponse()`, which does auto-generate a synthetic stop response when `shouldStopExecution()` is true

#### HOOK-195
Requirement Text: If a hook configuration with `type: 'plugin'` passes registry validation and reaches the hook runner, then the runner shall treat it as an error (fail-open) because no plugin execution path exists. The `HookType` enum defines only `Command`; no `PluginHookConfig` type exists; the `'plugin'` string is accepted by validation for forward compatibility but is not executable.
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a hook configuration with `type: 'plugin'` passes registry validation and reaches the hook runner
- THEN: the runner shall treat it as an error (fail-open) because no plugin execution path exists. The `HookType` enum defines only `Command`; no `PluginHookConfig` type exists; the `'plugin'` string is accepted by validation for forward compatibility but is not executable

#### HOOK-196
Requirement Text: If a hook script is terminated by an OS signal (exit code `null` from Node.js), then the hook system shall set `success: false` (because `null === 0` is `false`) but shall map the `exitCode` field to `0` in the result (because `null || EXIT_CODE_SUCCESS` evaluates to `0`). This produces a misleading `exitCode: 0` with `success: false`. The `success` field is independently computed via `exitCode === EXIT_CODE_SUCCESS`, which correctly returns `false` for signal-killed processes. The output path follows the `exitCode !== EXIT_CODE_SUCCESS` branch, so if stderr is non-empty, it will be converted to a `systemMessage` via `convertPlainTextToHookOutput()`.
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a hook script is terminated by an OS signal (exit code `null` from Node.js)
- THEN: the hook system shall set `success: false` (because `null === 0` is `false`) but shall map the `exitCode` field to `0` in the result (because `null || EXIT_CODE_SUCCESS` evaluates to `0`). This produces a misleading `exitCode: 0` with `success: false`. The `success` field is independently computed via `exitCode === EXIT_CODE_SUCCESS`, which correctly returns `false` for signal-killed processes. The output path follows the `exitCode !== EXIT_CODE_SUCCESS` branch, so if stderr is non-empty, it will be converted to a `systemMessage` via `convertPlainTextToHookOutput()`

#### HOOK-198
Requirement Text: When a hook script exits with a non-zero, non-2 exit code and provides stdout JSON containing `decision: 'block'`, the hook system shall ignore the stdout content and treat the hook as failed (fail-open), because stdout JSON is only parsed on exit code 0.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with a non-zero
- THEN: non-2 exit code and provides stdout JSON containing `decision: 'block'`, the hook system shall ignore the stdout content and treat the hook as failed (fail-open), because stdout JSON is only parsed on exit code 0

Merged/Retired IDs (not implemented directly in this phase):
- HOOK-185 is merged into HOOK-091; implement via owner phase 17.
- HOOK-186 is merged into HOOK-109; implement via owner phase 17.
- HOOK-197 is merged into HOOK-067b; implement via owner phase 08.

### Section 39. Additional Completeness Requirements (R4)
Coverage: 3 active requirements (HOOK-215..HOOK-217).

#### HOOK-215
Requirement Text: The `HookEventHandler` shall source base fields for every `HookInput` as follows: `session_id` from `config.getSessionId()`, `cwd` from `config.getWorkingDir()`, `timestamp` from `new Date().toISOString()`, `hook_event_name` from the event being fired, and `transcript_path` from `''` (empty string, per HOOK-161). These base fields shall be populated before any event-specific fields are added.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookEventHandler` shall source base fields for every `HookInput` as follows: `session_id` from `config.getSessionId()`, `cwd` from `config.getWorkingDir()`, `timestamp` from `new Date().toISOString()`, `hook_event_name` from the event being fired, and `transcript_path` from `''` (empty string, per HOOK-161). These base fields shall be populated before any event-specific fields are added

#### HOOK-216
Requirement Text: [Target] When multiple BeforeTool hooks execute sequentially and more than one returns a modified `tool_input` in `hookSpecificOutput`, the `applyHookOutputToInput()` function shall apply shallow-replace semantics: the later hook's `tool_input` object shall replace (not deep-merge into) the earlier hook's `tool_input` as a whole. Individual top-level keys in `tool_input` from the later hook overwrite same-named keys from the earlier hook, but nested objects are not recursively merged. This is consistent with the BeforeModel `llm_request` chaining strategy (HOOK-105), which also uses shallow merge via object spread. The merge is cumulative across the chain — each hook sees the merged result of all prior hooks, not only the original input.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple BeforeTool hooks execute sequentially and more than one returns a modified `tool_input` in `hookSpecificOutput`
- THEN: the `applyHookOutputToInput()` function shall apply shallow-replace semantics: the later hook's `tool_input` object shall replace (not deep-merge into) the earlier hook's `tool_input` as a whole. Individual top-level keys in `tool_input` from the later hook overwrite same-named keys from the earlier hook, but nested objects are not recursively merged. This is consistent with the BeforeModel `llm_request` chaining strategy (HOOK-105), which also uses shallow merge via object spread. The merge is cumulative across the chain — each hook sees the merged result of all prior hooks, not only the original input

#### HOOK-217
Requirement Text: The interface contract between the hook system and callers for AfterTool and AfterModel effects shall be: (1) The hook system returns effect fields on `DefaultHookOutput` — `systemMessage`, `suppressOutput`, `additionalContext` (via `hookSpecificOutput`), and `continue`/`stopReason`. (2) Callers are responsible for applying these effects to the appropriate boundaries: `systemMessage` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-131) or to the conversation context (AfterModel); `suppressOutput` sets `ToolResult.suppressDisplay` (AfterTool, per HOOK-132) or suppresses display rendering (AfterModel, per HOOK-049); `additionalContext` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-027); `continue: false` triggers agent loop termination in the caller (per HOOK-028/HOOK-048). (3) The hook system shall not directly mutate `ToolResult`, conversation state, or UI state — it only returns the output object. All mutations are the caller's responsibility.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The interface contract between the hook system and callers for AfterTool and AfterModel effects shall be: (1) The hook system returns effect fields on `DefaultHookOutput` — `systemMessage`, `suppressOutput`, `additionalContext` (via `hookSpecificOutput`), and `continue`/`stopReason`. (2) Callers are responsible for applying these effects to the appropriate boundaries: `systemMessage` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-131) or to the conversation context (AfterModel); `suppressOutput` sets `ToolResult.suppressDisplay` (AfterTool, per HOOK-132) or suppresses display rendering (AfterModel, per HOOK-049); `additionalContext` is appended to `ToolResult.llmContent` (AfterTool, per HOOK-027); `continue: false` triggers agent loop termination in the caller (per HOOK-028/HOOK-048). (3) The hook system shall not directly mutate `ToolResult`, conversation state, or UI state — it only returns the output object. All mutations are the caller's responsibility

Canonical requirement source: project-plans/hooksystemrewrite/requirements.md.

## Resolved Requirement Set

Active requirements owned by this phase: HOOK-014, HOOK-015, HOOK-016a, HOOK-016b, HOOK-017, HOOK-018, HOOK-019, HOOK-020, HOOK-021, HOOK-022, HOOK-023, HOOK-024, HOOK-025, HOOK-026, HOOK-027, HOOK-028, HOOK-029, HOOK-030, HOOK-031, HOOK-032, HOOK-127, HOOK-128, HOOK-129, HOOK-130, HOOK-131, HOOK-132, HOOK-133, HOOK-134, HOOK-157, HOOK-158, HOOK-159, HOOK-160, HOOK-169, HOOK-170, HOOK-171, HOOK-182, HOOK-183, HOOK-184, HOOK-187, HOOK-188, HOOK-189, HOOK-190, HOOK-191, HOOK-192, HOOK-193, HOOK-194, HOOK-195, HOOK-196, HOOK-198, HOOK-215, HOOK-216, HOOK-217

Merged/retired IDs that must NOT be implemented separately:
- HOOK-185 -> HOOK-091 (owner phase 17)
- HOOK-186 -> HOOK-109 (owner phase 17)
- HOOK-197 -> HOOK-067b (owner phase 08)

## Current vs Target Delta

| Requirement | Current State | Target State |
|---|---|---|
| HOOK-017 | Current behavior must be confirmed from code before implementation in this phase. | When a BeforeTool hook blocks a tool, the caller shall construct a `ToolResult` whose `llmContent` field contains the blocking `reason` string (from `DefaultHookOutput.getEffectiveReason()`), so that the model receives the block reason as the tool's output. |
| HOOK-019 | Current behavior must be confirmed from code before implementation in this phase. | When a BeforeTool hook script returns a modified `tool_input` in `hookSpecificOutput`, the tool shall execute with the modified arguments instead of the originals. |
| HOOK-020 | Current behavior must be confirmed from code before implementation in this phase. | When a BeforeTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user. |
| HOOK-024 | Current behavior must be confirmed from code before implementation in this phase. | When `applyHookOutputToInput()` is called for a sequential BeforeTool chain, the HookRunner shall merge `hookSpecificOutput.tool_input` into the next hook's `tool_input` field. |
| HOOK-027 | Current behavior must be confirmed from code before implementation in this phase. | When an AfterTool hook returns `additionalContext` in `hookSpecificOutput`, the hook system shall append that text to the tool result's LLM-facing content. |
| HOOK-028 | Current behavior must be confirmed from code before implementation in this phase. | When an AfterTool hook returns `continue` = `false`, the hook system shall signal the caller to terminate the agent loop, and the caller shall surface the `stopReason` to the user. |
| HOOK-029 | Current behavior must be confirmed from code before implementation in this phase. | When an AfterTool hook returns `suppressOutput` = `true`, the tool result shall not be displayed to the user (the `suppressDisplay` flag shall be set on the ToolResult). The model shall still receive the tool result's LLM-facing content. |
| HOOK-030 | Current behavior must be confirmed from code before implementation in this phase. | When an AfterTool hook returns a `systemMessage` field, the hook system shall inject that text into the tool result's LLM-facing content as a system-role annotation. |
| HOOK-129 | Current behavior must be confirmed from code before implementation in this phase. | When `coreToolScheduler` receives a blocked BeforeTool result, it shall treat the block as a completed tool invocation that produced an error-like result, set status to `idle`, buffer the blocked result, and publish it so the model sees the block reason. |
| HOOK-130 | Current behavior must be confirmed from code before implementation in this phase. | The scheduler shall not retry blocked tool calls — the model shall decide how to proceed based on the block reason. |
| HOOK-131 | Current behavior must be confirmed from code before implementation in this phase. | When `afterOutput.systemMessage` is present, the caller shall append it to `toolResult.llmContent` as a system-role annotation using the format `"\n\n[System] " + systemMessage`. |
| HOOK-132 | Current behavior must be confirmed from code before implementation in this phase. | When `afterOutput.suppressOutput` is `true`, the caller shall set `toolResult.suppressDisplay = true` so the result is sent to the LLM but not displayed to the user. |
| HOOK-134 | Current behavior must be confirmed from code before implementation in this phase. | No caller shall use `void` prefix on any hook trigger call — every caller shall `await` the result and apply it. |
| HOOK-183 | Current behavior must be confirmed from code before implementation in this phase. | When a BeforeTool hook blocks execution and the `executeToolWithHooks` wrapper is used, the wrapper shall return a `ToolResult` whose `llmContent` field contains the blocking reason string (from `DefaultHookOutput.getEffectiveReason()`). The caller detects the block by checking `beforeOutput?.isBlockingDecision()` before calling `executeFn()` — there is no `blocked` property on `ToolResult`. |
| HOOK-216 | Current behavior must be confirmed from code before implementation in this phase. | When multiple BeforeTool hooks execute sequentially and more than one returns a modified `tool_input` in `hookSpecificOutput`, the `applyHookOutputToInput()` function shall apply shallow-replace semantics: the later hook's `tool_input` object shall replace (not deep-merge into) the earlier hook's `tool_input` as a whole. Individual top-level keys in `tool_input` from the later hook overwrite same-named keys from the earlier hook, but nested objects are not recursively merged. This is consistent with the BeforeModel `llm_request` chaining strategy (HOOK-105), which also uses shallow merge via object spread. The merge is cumulative across the chain — each hook sees the merged result of all prior hooks, not only the original input. |

Each target delta above MUST be proven by phase verification tests before advancing.

## Implementation Tasks

### Files to Create
- packages/core/src/core/coreToolHookTriggers.ts
- packages/core/src/core/coreToolHookTriggers.test.ts

### Files to Modify
- packages/core/src/core/coreToolScheduler.ts
- packages/core/src/core/coreToolScheduler.test.ts
- packages/core/src/hooks/types.ts
- packages/core/src/hooks/hookRunner.ts
- packages/core/src/tools/tools.ts

### File and Symbol-Level Tasks
- packages/core/src/core/coreToolHookTriggers.ts: fireBeforeToolHook(), fireAfterToolHook(), executeToolWithHooks()
- packages/core/src/core/coreToolScheduler.ts: awaited before/after hook application and terminal blocked result flow
- packages/core/src/hooks/hookRunner.ts: BeforeTool sequential tool_input chaining behavior
- packages/core/src/hooks/types.ts: BeforeToolHookOutput and AfterToolHookOutput compatibility methods
- packages/core/src/tools/tools.ts: tool execution boundary receives modified input

### Required Markers
- @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P09
- @requirement:HOOK-014, HOOK-015, HOOK-016a, HOOK-016b, HOOK-017, HOOK-018, HOOK-019, HOOK-020, HOOK-021, HOOK-022, HOOK-023, HOOK-024, HOOK-025, HOOK-026, HOOK-027, HOOK-028, HOOK-029, HOOK-030, HOOK-031, HOOK-032, HOOK-127, HOOK-128, HOOK-129, HOOK-130, HOOK-131, HOOK-132, HOOK-133, HOOK-134, HOOK-157, HOOK-158, HOOK-159, HOOK-160, HOOK-169, HOOK-170, HOOK-171, HOOK-182, HOOK-183, HOOK-184, HOOK-187, HOOK-188, HOOK-189, HOOK-190, HOOK-191, HOOK-192, HOOK-193, HOOK-194, HOOK-195, HOOK-196, HOOK-198, HOOK-215, HOOK-216, HOOK-217
- @pseudocode:analysis/pseudocode/03-tool-hook-pipeline.md

## Verification Commands

### Structural Checks
- grep -R "@plan:PLAN-20260216-HOOKSYSTEMREWRITE.P09" packages/core packages/cli integration-tests
- grep -R "@requirement:" packages/core packages/cli integration-tests
- npm run test -- packages/core/src/core/coreToolHookTriggers.test.ts packages/core/src/core/coreToolScheduler.test.ts packages/core/src/hooks/hookRunner.test.ts
- npm run typecheck

### Deferred Implementation Detection
- rg -n -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented)" packages/core packages/cli integration-tests --glob "*.ts" --glob "*.tsx"

### Outcome-Focused Verification (Tool Pipeline)
- npm run test -- packages/core/src/core/coreToolScheduler.test.ts -t "blocked BeforeTool stops execution and returns terminal result"
- npm run test -- packages/core/src/core/coreToolHookTriggers.test.ts -t "BeforeTool sequential chaining passes modified tool_input"
- npm run test -- packages/core/src/core/coreToolHookTriggers.test.ts -t "shouldStop/stopReason contract is propagated"

### Semantic Verification Checklist
- [ ] Contracts compile and are reachable from call paths.
- [ ] Stub behavior is minimal and temporary.
- [ ] No parallel implementation variants were introduced.
- [ ] Next phase has clear failing tests to implement.

### Feature Actually Works
- node scripts/start.js --profile-load synthetic --prompt "validate hooks phase 09 behavior"

## Success Criteria
- Structural commands pass.
- Outcome-focused tests pass.
- Semantic checklist is complete with evidence in completion marker.

## Failure Recovery
- git checkout -- packages/core/src/core/coreToolHookTriggers.ts packages/core/src/core/coreToolHookTriggers.test.ts packages/core/src/core/coreToolScheduler.ts packages/core/src/core/coreToolScheduler.test.ts packages/core/src/hooks/types.ts packages/core/src/hooks/hookRunner.ts packages/core/src/tools/tools.ts
- sed -n '1,120p' project-plans/hooksystemrewrite/plan/09-tool-hook-pipeline-stub.md

## Phase Completion Marker
- Update project-plans/hooksystemrewrite/.completed/P09.md
- Required marker update: set `Status: COMPLETED` and fill all evidence fields.
