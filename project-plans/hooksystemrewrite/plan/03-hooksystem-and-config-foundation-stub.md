# Phase 03: HookSystem and Config Foundation Stub

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P03

## Prerequisites
- Completion marker exists and is complete: project-plans/hooksystemrewrite/.completed/P02a.md
- Verification command: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P02a.md
- Preflight gate complete: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P00a.md

## Requirements Implemented (Expanded)

### Section 1. Initialization & Lifecycle
Coverage: 9 active requirements (HOOK-001..HOOK-009).

#### HOOK-001
Requirement Text: Where `enableHooks` is set to `true`, the Config shall create a `HookSystem` instance lazily on the first call to `getHookSystem()`.
Behavior Contract:
- GIVEN: `enableHooks` is set to `true`
- WHEN: the corresponding hook flow is executed
- THEN: the Config shall create a `HookSystem` instance lazily on the first call to `getHookSystem()`

#### HOOK-002
Requirement Text: When `getHookSystem()` is called and `getEnableHooks()` returns `false`, the Config shall return `undefined`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `getHookSystem()` is called and `getEnableHooks()` returns `false`
- THEN: the Config shall return `undefined`

#### HOOK-003
Requirement Text: The HookSystem shall call `HookRegistry.initialize()` at most once per Config lifetime, regardless of how many hook events fire.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The HookSystem shall call `HookRegistry.initialize()` at most once per Config lifetime, regardless of how many hook events fire

#### HOOK-004
Requirement Text: When `HookSystem.initialize()` is called a second or subsequent time, the HookSystem shall return immediately without re-initializing the registry.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `HookSystem.initialize()` is called a second or subsequent time
- THEN: the HookSystem shall return immediately without re-initializing the registry

#### HOOK-005
Requirement Text: [Target] When `getEventHandler()` or `getRegistry()` is called before `initialize()`, the HookSystem shall throw a `HookSystemNotInitializedError`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `getEventHandler()` or `getRegistry()` is called before `initialize()`
- THEN: the HookSystem shall throw a `HookSystemNotInitializedError`

#### HOOK-006
Requirement Text: The HookSystem shall expose `getRegistry()`, `getEventHandler()`, and `getStatus()` as its public accessors. Internally the HookSystem shall own single shared instances of `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`, reused across all event fires. The planner, runner, and aggregator are created by HookSystem and injected into `HookEventHandler` by HookSystem; they are not directly accessible from `HookSystem`'s public API.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The HookSystem shall expose `getRegistry()`, `getEventHandler()`, and `getStatus()` as its public accessors. Internally the HookSystem shall own single shared instances of `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`, reused across all event fires. The planner, runner, and aggregator are created by HookSystem and injected into `HookEventHandler` by HookSystem; they are not directly accessible from `HookSystem`'s public API

#### HOOK-007
Requirement Text: The rewritten trigger functions shall never construct new instances of `HookRegistry`, `HookPlanner`, `HookRunner`, or `HookAggregator`; they shall obtain these from the `HookSystem` via `Config`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten trigger functions shall never construct new instances of `HookRegistry`, `HookPlanner`, `HookRunner`, or `HookAggregator`; they shall obtain these from the `HookSystem` via `Config`

#### HOOK-008
Requirement Text: When the first hook event fires, the trigger function shall call `hookSystem.initialize()` to perform lazy initialization before delegating to the event handler.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the first hook event fires
- THEN: the trigger function shall call `hookSystem.initialize()` to perform lazy initialization before delegating to the event handler

#### HOOK-009
Requirement Text: The `HookSystem.getStatus()` method shall report `{ initialized: boolean; totalHooks: number }`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookSystem.getStatus()` method shall report `{ initialized: boolean; totalHooks: number }`

### Section 2. Zero Overhead When Disabled
Coverage: 4 active requirements (HOOK-010..HOOK-013).

#### HOOK-010
Requirement Text: While `enableHooks` is `false`, the hook system shall not spawn any child processes or allocate hook infrastructure objects (HookRegistry, HookPlanner, HookRunner, HookAggregator). This is observable by verifying `getHookSystem()` returns `undefined`.
Behavior Contract:
- GIVEN: `enableHooks` is `false`
- WHEN: the runtime remains in that state
- THEN: the hook system shall not spawn any child processes or allocate hook infrastructure objects (HookRegistry, HookPlanner, HookRunner, HookAggregator). This is observable by verifying `getHookSystem()` returns `undefined`

#### HOOK-011
Requirement Text: While no hooks are configured for an event, the hook system shall not spawn any child processes and shall return before constructing HookInput payloads.
Behavior Contract:
- GIVEN: no hooks are configured for an event
- WHEN: the runtime remains in that state
- THEN: the hook system shall not spawn any child processes and shall return before constructing HookInput payloads

#### HOOK-012
Requirement Text: While no hooks match the current event (after matcher filtering), the hook system shall not spawn any child processes.
Behavior Contract:
- GIVEN: no hooks match the current event (after matcher filtering)
- WHEN: the runtime remains in that state
- THEN: the hook system shall not spawn any child processes

#### HOOK-013
Requirement Text: The check for "are hooks relevant?" shall be synchronous and shall not perform file I/O — `config.getHookSystem()` shall return `undefined` synchronously when hooks are disabled. On the disabled/no-match fast path, no async operations shall be invoked.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The check for "are hooks relevant?" shall be synchronous and shall not perform file I/O — `config.getHookSystem()` shall return `undefined` synchronously when hooks are disabled. On the disabled/no-match fast path, no async operations shall be invoked

### Section 11. Configuration
Coverage: 7 active requirements (HOOK-080..HOOK-086).

#### HOOK-080
Requirement Text: The hook system shall support the `hooks` configuration key in `settings.json` mapping event names to arrays of hook group definitions.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall support the `hooks` configuration key in `settings.json` mapping event names to arrays of hook group definitions

#### HOOK-081
Requirement Text: The hook system shall support five event names for the rewrite scope: `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, and `BeforeToolSelection`. The `HookEventName` enum defines additional events (`BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`, `Notification`) that are accepted in configuration but are outside the scope of this rewrite; hooks configured for those events will be registered and executed but their outputs will not be applied by callers.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall support five event names for the rewrite scope: `BeforeTool`, `AfterTool`, `BeforeModel`, `AfterModel`, and `BeforeToolSelection`. The `HookEventName` enum defines additional events (`BeforeAgent`, `AfterAgent`, `SessionStart`, `SessionEnd`, `PreCompress`, `Notification`) that are accepted in configuration but are outside the scope of this rewrite; hooks configured for those events will be registered and executed but their outputs will not be applied by callers

#### HOOK-082
Requirement Text: The hook group definition shall support optional `matcher` (regex pattern), optional `sequential` (boolean, default `false`), and required `hooks` (array of command configurations).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook group definition shall support optional `matcher` (regex pattern), optional `sequential` (boolean, default `false`), and required `hooks` (array of command configurations)

#### HOOK-083
Requirement Text: The hook command configuration shall require `type` and `command`. The `type` field shall be validated as `"command"` or `"plugin"` by the registry (see HOOK-191). An optional `timeout` (milliseconds, default 60000) is also supported. Note: the `HookType` enum currently defines only `Command`; the `"plugin"` value is accepted by validation but has no execution path in the runner (see HOOK-195). No `PluginHookConfig` type exists; only `CommandHookConfig` is defined.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook command configuration shall require `type` and `command`. The `type` field shall be validated as `"command"` or `"plugin"` by the registry (see HOOK-191). An optional `timeout` (milliseconds, default 60000) is also supported. Note: the `HookType` enum currently defines only `Command`; the `"plugin"` value is accepted by validation but has no execution path in the runner (see HOOK-195). No `PluginHookConfig` type exists; only `CommandHookConfig` is defined

#### HOOK-084
Requirement Text: The `hooks` configuration shall be supported at project (`.llxprt/settings.json`), user (`~/.llxprt/settings.json`), and system scope, merged by the Config layer before reaching the hook system.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `hooks` configuration shall be supported at project (`.llxprt/settings.json`), user (`~/.llxprt/settings.json`), and system scope, merged by the Config layer before reaching the hook system

#### HOOK-085
Requirement Text: The hook registry shall tag all hooks from `config.getHooks()` as `ConfigSource.Project` and all hooks from active extensions as `ConfigSource.Extensions`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook registry shall tag all hooks from `config.getHooks()` as `ConfigSource.Project` and all hooks from active extensions as `ConfigSource.Extensions`

#### HOOK-086
Requirement Text: The hook registry shall apply ordering by `ConfigSource` priority when returning hooks for an event. In practice, only two tiers are used: Project (priority 1) and Extensions (priority 4). All hooks from `config.getHooks()` are tagged as `ConfigSource.Project`; all hooks from active extensions are tagged as `ConfigSource.Extensions`. Project hooks always precede Extensions hooks. The `ConfigSource` enum also defines `User` (priority 2) and `System` (priority 3) levels, but no production code path currently assigns hooks to these sources — they exist for forward compatibility only and are not exercised by `processHooksFromConfig()`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook registry shall apply ordering by `ConfigSource` priority when returning hooks for an event. In practice, only two tiers are used: Project (priority 1) and Extensions (priority 4). All hooks from `config.getHooks()` are tagged as `ConfigSource.Project`; all hooks from active extensions are tagged as `ConfigSource.Extensions`. Project hooks always precede Extensions hooks. The `ConfigSource` enum also defines `User` (priority 2) and `System` (priority 3) levels, but no production code path currently assigns hooks to these sources — they exist for forward compatibility only and are not exercised by `processHooksFromConfig()`

### Section 23. New Components
Coverage: 8 active requirements (HOOK-142..HOOK-149).

#### HOOK-142
Requirement Text: The `HookSystem` class shall be importable from `packages/core/src/hooks/hookSystem.ts` and shall own `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookSystem` class shall be importable from `packages/core/src/hooks/hookSystem.ts` and shall own `HookRegistry`, `HookPlanner`, `HookRunner`, `HookAggregator`, and `HookEventHandler`

#### HOOK-143
Requirement Text: The `HookEventHandler` class shall be importable from `packages/core/src/hooks/hookEventHandler.ts` and shall expose `fireBeforeToolEvent`, `fireAfterToolEvent`, `fireBeforeModelEvent`, `fireAfterModelEvent`, and `fireBeforeToolSelectionEvent` methods.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookEventHandler` class shall be importable from `packages/core/src/hooks/hookEventHandler.ts` and shall expose `fireBeforeToolEvent`, `fireAfterToolEvent`, `fireBeforeModelEvent`, `fireAfterModelEvent`, and `fireBeforeToolSelectionEvent` methods

#### HOOK-144
Requirement Text: The `HookEventHandler` shall build `HookInput` payloads with base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) sourced from the `Config` object.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookEventHandler` shall build `HookInput` payloads with base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) sourced from the `Config` object

#### HOOK-145
Requirement Text: When the execution plan is `null` (no matching hooks), the `HookEventHandler` shall return an empty success `AggregatedHookResult` with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the execution plan is `null` (no matching hooks)
- THEN: the `HookEventHandler` shall return an empty success `AggregatedHookResult` with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`

#### HOOK-146
Requirement Text: The `HookEventHandler` shall log telemetry at debug level for every event fire, including event name, hook count, total duration, and success/failure.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookEventHandler` shall log telemetry at debug level for every event fire, including event name, hook count, total duration, and success/failure

#### HOOK-147
Requirement Text: The `HookEventHandler` shall wrap its entire `fire*Event()` body in try/catch and, on error, log a warning and return the empty success result (see HOOK-113 and HOOK-145) — never propagating exceptions.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookEventHandler` shall wrap its entire `fire*Event()` body in try/catch and, on error, log a warning and return the empty success result (see HOOK-113 and HOOK-145) — never propagating exceptions

#### HOOK-148
Requirement Text: [Target] The `HookSystemNotInitializedError` shall be a new error class introduced in `hookSystem.ts`, mirroring the existing `HookRegistryNotInitializedError` pattern. This class does not exist in the current codebase.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookSystemNotInitializedError` shall be a new error class introduced in `hookSystem.ts`, mirroring the existing `HookRegistryNotInitializedError` pattern. This class does not exist in the current codebase

#### HOOK-149
Requirement Text: [Target] The `ToolResult` type shall support an optional `suppressDisplay?: boolean` field so that AfterTool hooks can suppress display while preserving the LLM-facing content. The current `ToolResult` interface (in `tools.ts`) has fields `llmContent`, `returnDisplay`, `metadata?`, and `error?` — no `suppressDisplay` field exists. This field must be added as part of the rewrite. Same pattern as HOOK-029 (AfterTool suppressOutput) and HOOK-132 (caller sets suppressDisplay).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `ToolResult` type shall support an optional `suppressDisplay?: boolean` field so that AfterTool hooks can suppress display while preserving the LLM-facing content. The current `ToolResult` interface (in `tools.ts`) has fields `llmContent`, `returnDisplay`, `metadata?`, and `error?` — no `suppressDisplay` field exists. This field must be added as part of the rewrite. Same pattern as HOOK-029 (AfterTool suppressOutput) and HOOK-132 (caller sets suppressDisplay)

### Section 24. Trigger Function Contracts
Coverage: 5 active requirements (HOOK-150..HOOK-154).

#### HOOK-150
Requirement Text: The `fireBeforeToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `fireBeforeToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`

#### HOOK-151
Requirement Text: The `fireAfterToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>, toolResponse: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `fireAfterToolHook` trigger function shall accept `(config: Config, toolName: string, toolInput: Record<string, unknown>, toolResponse: Record<string, unknown>)` and return `Promise<DefaultHookOutput | undefined>`

#### HOOK-152
Requirement Text: The `fireBeforeModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeModelHookResult>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `fireBeforeModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeModelHookResult>`

#### HOOK-153
Requirement Text: The `fireAfterModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters, llmResponse: GenerateContentResponse)` and return `Promise<AfterModelHookResult>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `fireAfterModelHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters, llmResponse: GenerateContentResponse)` and return `Promise<AfterModelHookResult>`

#### HOOK-154
Requirement Text: The `fireBeforeToolSelectionHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeToolSelectionHookResult>`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `fireBeforeToolSelectionHook` trigger function shall accept `(config: Config, llmRequest: GenerateContentParameters)` and return `Promise<BeforeToolSelectionHookResult>`

### Section 32. File Manifest & Module Exports
Coverage: 2 active requirements (HOOK-175..HOOK-176).

#### HOOK-175
Requirement Text: The `packages/core/src/hooks/index.ts` shall export `HookSystem` and `HookEventHandler`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `packages/core/src/hooks/index.ts` shall export `HookSystem` and `HookEventHandler`

#### HOOK-176
Requirement Text: The `BeforeModelHookResult`, `AfterModelHookResult`, and `BeforeToolSelectionHookResult` types shall be exported from `geminiChatHookTriggers.ts`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `BeforeModelHookResult`, `AfterModelHookResult`, and `BeforeToolSelectionHookResult` types shall be exported from `geminiChatHookTriggers.ts`

### Section 38. Additional Completeness Requirements (R3)
Coverage: 6 active requirements (HOOK-209..HOOK-214).

#### HOOK-209
Requirement Text: When a hook script exits with a non-zero, non-2 exit code (e.g., exit code 1) and stderr is non-empty, the hook system shall convert the stderr text to a `systemMessage` via `convertPlainTextToHookOutput()`, producing `{ decision: 'allow', systemMessage: 'Warning: <stderr_text>' }`. The hook is treated as failed (fail-open) — `success: false` — but the stderr content is preserved as a warning message in the output.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with a non-zero
- THEN: non-2 exit code (e.g., exit code 1) and stderr is non-empty, the hook system shall convert the stderr text to a `systemMessage` via `convertPlainTextToHookOutput()`, producing `{ decision: 'allow', systemMessage: 'Warning: <stderr_text>' }`. The hook is treated as failed (fail-open) — `success: false` — but the stderr content is preserved as a warning message in the output

#### HOOK-210
Requirement Text: When multiple hooks fire for BeforeToolSelection, the aggregator shall merge outputs using the following specific semantics: (1) mode precedence is NONE > ANY > AUTO (most-restrictive-wins); (2) `allowedFunctionNames` from all hooks are combined using set union; (3) the final `allowedFunctionNames` list shall be sorted alphabetically for deterministic caching behavior; (4) if any hook specifies mode `NONE`, `allowedFunctionNames` shall be empty regardless of other hooks' outputs. These semantics are implemented in `hookAggregator.ts` `mergeToolSelectionOutputs()` using `FunctionCallingConfigMode` enum values.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for BeforeToolSelection
- THEN: the aggregator shall merge outputs using the following specific semantics: (1) mode precedence is NONE > ANY > AUTO (most-restrictive-wins); (2) `allowedFunctionNames` from all hooks are combined using set union; (3) the final `allowedFunctionNames` list shall be sorted alphabetically for deterministic caching behavior; (4) if any hook specifies mode `NONE`, `allowedFunctionNames` shall be empty regardless of other hooks' outputs. These semantics are implemented in `hookAggregator.ts` `mergeToolSelectionOutputs()` using `FunctionCallingConfigMode` enum values

#### HOOK-211
Requirement Text: The `applyHookOutputToInput()` function in `hookRunner.ts` shall implement per-event sequential chaining for `BeforeAgent` (merge `additionalContext` into `prompt`) and `BeforeModel` (merge `llm_request` via shallow merge). For all other events — `AfterTool`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, and out-of-scope events — `applyHookOutputToInput()` shall perform no input modification (fall through to the `default` case which returns the input unchanged). [Target] The rewrite shall add a `BeforeTool` chaining branch (see HOOK-024/HOOK-106). `AfterTool`, `AfterModel`, and `BeforeToolSelection` have no chaining semantics because their inputs do not carry modifiable fields from previous hooks.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `applyHookOutputToInput()` function in `hookRunner.ts` shall implement per-event sequential chaining for `BeforeAgent` (merge `additionalContext` into `prompt`) and `BeforeModel` (merge `llm_request` via shallow merge). For all other events — `AfterTool`, `AfterModel`, `BeforeToolSelection`, `BeforeTool`, and out-of-scope events — `applyHookOutputToInput()` shall perform no input modification (fall through to the `default` case which returns the input unchanged). [Target] The rewrite shall add a `BeforeTool` chaining branch (see HOOK-024/HOOK-106). `AfterTool`, `AfterModel`, and `BeforeToolSelection` have no chaining semantics because their inputs do not carry modifiable fields from previous hooks

#### HOOK-212
Requirement Text: When a hook script exits with code 0 and writes stdout content, the hook system shall attempt to parse it as JSON. If JSON parsing succeeds, the parsed object shall be used as the hook output. If JSON parsing fails (malformed JSON, plain text, etc.), the hook system shall fall back to `convertPlainTextToHookOutput(stdout, 0)`, producing `{ decision: 'allow', systemMessage: <stdout_text> }`. This JSON-first-then-plain-text precedence is the canonical parsing protocol for exit code 0. If the parsed JSON result is a string (double-encoded JSON), the system shall parse it a second time (see HOOK-193/HOOK-201).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes stdout content
- THEN: the hook system shall attempt to parse it as JSON. If JSON parsing succeeds, the parsed object shall be used as the hook output. If JSON parsing fails (malformed JSON, plain text, etc.), the hook system shall fall back to `convertPlainTextToHookOutput(stdout, 0)`, producing `{ decision: 'allow', systemMessage: <stdout_text> }`. This JSON-first-then-plain-text precedence is the canonical parsing protocol for exit code 0. If the parsed JSON result is a string (double-encoded JSON), the system shall parse it a second time (see HOOK-193/HOOK-201)

#### HOOK-213
Requirement Text: The `success` field on `AggregatedHookResult` shall represent hook execution health (did all hooks run without errors?), not policy outcome (did hooks allow or block the operation?). `success: false` means at least one hook encountered an execution failure (crash, timeout, non-zero exit code, signal kill). Policy decisions (block, allow, stop) are derived from `finalOutput` — specifically `finalOutput.isBlockingDecision()` for block/deny, `finalOutput.shouldStopExecution()` for agent termination, and `finalOutput.decision` for the raw decision value. Callers shall never use `success: false` alone to determine whether an operation should proceed — they must check `finalOutput` for policy. In particular, exit code 2 produces `success: false` (execution failure) AND `finalOutput.isBlockingDecision() === true` (policy block) — both fields must be consulted.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `success` field on `AggregatedHookResult` shall represent hook execution health (did all hooks run without errors?), not policy outcome (did hooks allow or block the operation?). `success: false` means at least one hook encountered an execution failure (crash, timeout, non-zero exit code, signal kill). Policy decisions (block, allow, stop) are derived from `finalOutput` — specifically `finalOutput.isBlockingDecision()` for block/deny, `finalOutput.shouldStopExecution()` for agent termination, and `finalOutput.decision` for the raw decision value. Callers shall never use `success: false` alone to determine whether an operation should proceed — they must check `finalOutput` for policy. In particular, exit code 2 produces `success: false` (execution failure) AND `finalOutput.isBlockingDecision() === true` (policy block) — both fields must be consulted

#### HOOK-214
Requirement Text: Throughout this requirements document, the terms "success" and "failure" when applied to `AggregatedHookResult.success` or `HookExecutionResult.success` refer exclusively to execution health — whether the hook process ran to completion without errors. The terms "block", "deny", "allow", and "stop" refer exclusively to policy outcomes derived from hook output fields (`decision`, `continue`, `stopReason`). A hook can have `success: false` (execution failure) while still producing a valid policy output (e.g., exit code 2 = execution failure + block policy). Requirements that describe "fail-open" behavior (HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060, HOOK-110) mean: when execution fails (`success: false`) and no explicit block decision was produced, the operation proceeds as if the hook did not run.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: Throughout this requirements document, the terms "success" and "failure" when applied to `AggregatedHookResult.success` or `HookExecutionResult.success` refer exclusively to execution health — whether the hook process ran to completion without errors. The terms "block", "deny", "allow", and "stop" refer exclusively to policy outcomes derived from hook output fields (`decision`, `continue`, `stopReason`). A hook can have `success: false` (execution failure) while still producing a valid policy output (e.g., exit code 2 = execution failure + block policy). Requirements that describe "fail-open" behavior (HOOK-023, HOOK-031, HOOK-042, HOOK-052, HOOK-060, HOOK-110) mean: when execution fails (`success: false`) and no explicit block decision was produced, the operation proceeds as if the hook did not run

Canonical requirement source: project-plans/hooksystemrewrite/requirements.md.

## Resolved Requirement Set

Active requirements owned by this phase: HOOK-001, HOOK-002, HOOK-003, HOOK-004, HOOK-005, HOOK-006, HOOK-007, HOOK-008, HOOK-009, HOOK-010, HOOK-011, HOOK-012, HOOK-013, HOOK-080, HOOK-081, HOOK-082, HOOK-083, HOOK-084, HOOK-085, HOOK-086, HOOK-142, HOOK-143, HOOK-144, HOOK-145, HOOK-146, HOOK-147, HOOK-148, HOOK-149, HOOK-150, HOOK-151, HOOK-152, HOOK-153, HOOK-154, HOOK-175, HOOK-176, HOOK-209, HOOK-210, HOOK-211, HOOK-212, HOOK-213, HOOK-214

## Current vs Target Delta

| Requirement | Current State | Target State |
|---|---|---|
| HOOK-005 | Current behavior must be confirmed from code before implementation in this phase. | When `getEventHandler()` or `getRegistry()` is called before `initialize()`, the HookSystem shall throw a `HookSystemNotInitializedError`. |
| HOOK-148 | Current behavior must be confirmed from code before implementation in this phase. | The `HookSystemNotInitializedError` shall be a new error class introduced in `hookSystem.ts`, mirroring the existing `HookRegistryNotInitializedError` pattern. This class does not exist in the current codebase. |
| HOOK-149 | Current behavior must be confirmed from code before implementation in this phase. | The `ToolResult` type shall support an optional `suppressDisplay?: boolean` field so that AfterTool hooks can suppress display while preserving the LLM-facing content. The current `ToolResult` interface (in `tools.ts`) has fields `llmContent`, `returnDisplay`, `metadata?`, and `error?` — no `suppressDisplay` field exists. This field must be added as part of the rewrite. Same pattern as HOOK-029 (AfterTool suppressOutput) and HOOK-132 (caller sets suppressDisplay). |

Each target delta above MUST be proven by phase verification tests before advancing.

## Implementation Tasks

### Files to Create
- packages/core/src/hooks/hookSystem.ts
- packages/core/src/hooks/errors.ts
- packages/core/src/hooks/hookSystem.test.ts

### Files to Modify
- packages/core/src/config/config.ts
- packages/core/src/config/config.test.ts
- packages/core/src/hooks/index.ts
- packages/core/src/hooks/hookRegistry.ts
- packages/core/src/hooks/hookRegistry.test.ts
- packages/core/src/hooks/types.ts

### File and Symbol-Level Tasks
- packages/core/src/config/config.ts: getHookSystem(), getEnableHooks(), lazy init boundary
- packages/core/src/hooks/hookSystem.ts: HookSystem constructor, initialize(), getRegistry(), getEventHandler(), getStatus()
- packages/core/src/hooks/errors.ts: HookSystemNotInitializedError
- packages/core/src/hooks/hookRegistry.ts: source-priority registration and dedup plumbing
- packages/core/src/hooks/types.ts: HookSystem status and trigger contracts

### Required Markers
- @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
- @requirement:HOOK-001, HOOK-002, HOOK-003, HOOK-004, HOOK-005, HOOK-006, HOOK-007, HOOK-008, HOOK-009, HOOK-010, HOOK-011, HOOK-012, HOOK-013, HOOK-080, HOOK-081, HOOK-082, HOOK-083, HOOK-084, HOOK-085, HOOK-086, HOOK-142, HOOK-143, HOOK-144, HOOK-145, HOOK-146, HOOK-147, HOOK-148, HOOK-149, HOOK-150, HOOK-151, HOOK-152, HOOK-153, HOOK-154, HOOK-175, HOOK-176, HOOK-209, HOOK-210, HOOK-211, HOOK-212, HOOK-213, HOOK-214
- @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md

## Verification Commands

### Structural Checks
- grep -R "@plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03" packages/core packages/cli integration-tests
- grep -R "@requirement:" packages/core packages/cli integration-tests
- npm run test -- packages/core/src/hooks/hookSystem.test.ts packages/core/src/config/config.test.ts packages/core/src/hooks/hookRegistry.test.ts
- npm run typecheck

### Deferred Implementation Detection
- rg -n -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented)" packages/core packages/cli integration-tests --glob "*.ts" --glob "*.tsx"

### Outcome-Focused Verification (Foundation)
- npm run test -- packages/core/src/config/config.test.ts -t "enableHooks true initializes hook system"
- npm run test -- packages/core/src/config/config.test.ts -t "enableHooks false returns undefined"
- npm run test -- packages/core/src/config/config.test.ts -t "tools.enableHooks does not enable hooks"
- npm run test -- packages/core/src/hooks/hookSystem.test.ts -t "initialize called once"

### Semantic Verification Checklist
- [ ] Contracts compile and are reachable from call paths.
- [ ] Stub behavior is minimal and temporary.
- [ ] No parallel implementation variants were introduced.
- [ ] Next phase has clear failing tests to implement.

### Feature Actually Works
- node scripts/start.js --profile-load synthetic --prompt "validate hooks phase 03 behavior"

## Success Criteria
- Structural commands pass.
- Outcome-focused tests pass.
- Semantic checklist is complete with evidence in completion marker.

## Failure Recovery
- git checkout -- packages/core/src/hooks/hookSystem.ts packages/core/src/hooks/errors.ts packages/core/src/hooks/hookSystem.test.ts packages/core/src/config/config.ts packages/core/src/config/config.test.ts packages/core/src/hooks/index.ts packages/core/src/hooks/hookRegistry.ts packages/core/src/hooks/hookRegistry.test.ts packages/core/src/hooks/types.ts
- sed -n '1,120p' project-plans/hooksystemrewrite/plan/03-hooksystem-and-config-foundation-stub.md

## Phase Completion Marker
- Update project-plans/hooksystemrewrite/.completed/P03.md
- Required marker update: set `Status: COMPLETED` and fill all evidence fields.
