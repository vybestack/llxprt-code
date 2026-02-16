# Phase 08: HookEventHandler and Protocol Contracts Implementation

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P08

## Prerequisites
- Completion marker exists and is complete: project-plans/hooksystemrewrite/.completed/P07a.md
- Verification command: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P07a.md
- Preflight gate complete: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P00a.md

## Requirements Implemented (Expanded)

### Section 8. Communication Protocol
Coverage: 11 active requirements (HOOK-061..HOOK-070).

#### HOOK-061
Requirement Text: The hook system shall write a single JSON object to each hook script's stdin, followed by EOF (stdin closed after writing).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall write a single JSON object to each hook script's stdin, followed by EOF (stdin closed after writing)

#### HOOK-062
Requirement Text: The hook system shall include base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) plus event-specific fields in every stdin JSON object.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall include base fields (`session_id`, `cwd`, `timestamp`, `hook_event_name`, `transcript_path`) plus event-specific fields in every stdin JSON object

#### HOOK-063
Requirement Text: [Target] When a hook script exits with code 0 and writes valid JSON to stdout, the hook system shall parse the JSON and the caller shall apply the contained decisions and modifications to the operation.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes valid JSON to stdout
- THEN: the hook system shall parse the JSON and the caller shall apply the contained decisions and modifications to the operation

#### HOOK-064
Requirement Text: When a hook script exits with code 0 and writes non-JSON text to stdout, the hook system shall treat it as `decision: 'allow'` with no modifications and convert the stdout text to a `systemMessage`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes non-JSON text to stdout
- THEN: the hook system shall treat it as `decision: 'allow'` with no modifications and convert the stdout text to a `systemMessage`

#### HOOK-065
Requirement Text: When a hook script exits with code 0 and writes nothing to stdout, the hook system shall treat it as "allow with no modifications."
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and writes nothing to stdout
- THEN: the hook system shall treat it as "allow with no modifications."

#### HOOK-066
Requirement Text: When a hook script exits with code 2, the hook system shall treat it as a block/deny decision for the associated operation. Stdout is not parsed for JSON on exit code 2 — only stderr is used (see HOOK-067).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 2
- THEN: the hook system shall treat it as a block/deny decision for the associated operation. Stdout is not parsed for JSON on exit code 2 — only stderr is used (see HOOK-067)

#### HOOK-067a
Requirement Text: When a hook script exits with code 2 and stderr is non-empty, the hook system shall use stderr content as the blocking reason via `convertPlainTextToHookOutput()`, producing `{ decision: 'deny', reason: <stderr_text> }`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 2 and stderr is non-empty
- THEN: the hook system shall use stderr content as the blocking reason via `convertPlainTextToHookOutput()`, producing `{ decision: 'deny', reason: <stderr_text> }`

#### HOOK-067b
Requirement Text: [Target] When a hook script exits with code 2 and stderr is empty (including the case where both stdout and stderr are empty), the hook system shall produce a blocking output with `decision: 'deny'` and a default reason string (e.g., `"Blocked by hook"`). In the current codebase, this edge case produces `output: undefined` because the stderr branch (`exitCode !== EXIT_CODE_SUCCESS && stderr.trim()`) is not entered when stderr is empty — `stderr.trim()` is falsy. The rewrite shall fix this to ensure exit code 2 always produces a blocking result regardless of stderr content.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 2 and stderr is empty (including the case where both stdout and stderr are empty)
- THEN: the hook system shall produce a blocking output with `decision: 'deny'` and a default reason string (e.g., `"Blocked by hook"`). In the current codebase, this edge case produces `output: undefined` because the stderr branch (`exitCode !== EXIT_CODE_SUCCESS && stderr.trim()`) is not entered when stderr is empty — `stderr.trim()` is falsy. The rewrite shall fix this to ensure exit code 2 always produces a blocking result regardless of stderr content

#### HOOK-068
Requirement Text: When a hook script exits with any code other than 0 or 2, the hook system shall treat the hook as failed, log a warning, and proceed with the operation (fail-open).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with any code other than 0 or 2
- THEN: the hook system shall treat the hook as failed, log a warning, and proceed with the operation (fail-open)

#### HOOK-069
Requirement Text: The hook system shall capture stderr output from hook scripts for logging and diagnostics, and shall never parse stderr for decisions.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall capture stderr output from hook scripts for logging and diagnostics, and shall never parse stderr for decisions

#### HOOK-070
Requirement Text: The hook system shall mark `success: true` only for exit code 0 in `HookExecutionResult`. Exit code 2, exit code 1, any other non-zero exit code, and exit code `null` (signal-killed) all produce `success: false` via the expression `exitCode === EXIT_CODE_SUCCESS` (see HOOK-196). In particular, exit code 2 produces `success: false` even though it represents an intentional block decision — the `success` field reflects execution health, not policy outcome (see HOOK-160, HOOK-213).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall mark `success: true` only for exit code 0 in `HookExecutionResult`. Exit code 2, exit code 1, any other non-zero exit code, and exit code `null` (signal-killed) all produce `success: false` via the expression `exitCode === EXIT_CODE_SUCCESS` (see HOOK-196). In particular, exit code 2 produces `success: false` even though it represents an intentional block decision — the `success` field reflects execution health, not policy outcome (see HOOK-160, HOOK-213)

### Section 9. Stable Hook API Data Formats
Coverage: 4 active requirements (HOOK-071..HOOK-074).

#### HOOK-071
Requirement Text: The hook system shall present LLM data to scripts in a stable, SDK-version-independent format using the `LLMRequest` and `LLMResponse` types defined in `hookTranslator.ts`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall present LLM data to scripts in a stable, SDK-version-independent format using the `LLMRequest` and `LLMResponse` types defined in `hookTranslator.ts`

#### HOOK-072
Requirement Text: The `LLMRequest` format shall include `model`, `messages` (array with `role` and `content`), `config` (temperature, maxOutputTokens, topP, topK, etc.), and `toolConfig` (mode, allowedFunctionNames).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `LLMRequest` format shall include `model`, `messages` (array with `role` and `content`), `config` (temperature, maxOutputTokens, topP, topK, etc.), and `toolConfig` (mode, allowedFunctionNames)

#### HOOK-073
Requirement Text: The `LLMResponse` format shall include `text`, `candidates` (with content parts, finishReason, index, safetyRatings), and `usageMetadata`.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `LLMResponse` format shall include `text`, `candidates` (with content parts, finishReason, index, safetyRatings), and `usageMetadata`

#### HOOK-074
Requirement Text: The `HookToolConfig` format shall include `mode` (`"AUTO"`, `"ANY"`, `"NONE"`) and `allowedFunctionNames` (array of strings).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookToolConfig` format shall include `mode` (`"AUTO"`, `"ANY"`, `"NONE"`) and `allowedFunctionNames` (array of strings)

### Section 10. Data Translation
Coverage: 5 active requirements (HOOK-075..HOOK-079).

#### HOOK-075
Requirement Text: The `HookTranslatorGenAIv1.toHookLLMRequest()` shall extract only text content from message parts and filter out non-text parts (images, function calls, function responses, inline data, file data). This is intentionally lossy for v1 — non-text parts are dropped, not preserved.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookTranslatorGenAIv1.toHookLLMRequest()` shall extract only text content from message parts and filter out non-text parts (images, function calls, function responses, inline data, file data). This is intentionally lossy for v1 — non-text parts are dropped, not preserved

#### HOOK-076
Requirement Text: When a message has no text content after filtering, the translator shall drop that message entirely from the `LLMRequest.messages` array.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a message has no text content after filtering
- THEN: the translator shall drop that message entirely from the `LLMRequest.messages` array

#### HOOK-077
Requirement Text: The `HookTranslatorGenAIv1.toHookLLMResponse()` shall extract only text parts from candidate content and simplify safety ratings by stripping the `blocked` field. **Implementer note:** The TypeScript `LLMResponse` type in `hookTranslator.ts` still declares `blocked?: boolean` on `safetyRatings` entries, but the runtime `toHookLLMResponse()` implementation strips it during conversion. Ensure the type is updated to match runtime behavior, or add a code comment documenting the intentional omission.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `HookTranslatorGenAIv1.toHookLLMResponse()` shall extract only text parts from candidate content and simplify safety ratings by stripping the `blocked` field. **Implementer note:** The TypeScript `LLMResponse` type in `hookTranslator.ts` still declares `blocked?: boolean` on `safetyRatings` entries, but the runtime `toHookLLMResponse()` implementation strips it during conversion. Ensure the type is updated to match runtime behavior, or add a code comment documenting the intentional omission

#### HOOK-078
Requirement Text: When `fromHookLLMRequest()` is called, the translator shall accept a `baseRequest` parameter and preserve SDK fields from the original request that the hook format cannot represent (e.g., `tools`, `systemInstruction`, non-text content parts).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fromHookLLMRequest()` is called
- THEN: the translator shall accept a `baseRequest` parameter and preserve SDK fields from the original request that the hook format cannot represent (e.g., `tools`, `systemInstruction`, non-text content parts)

#### HOOK-079
Requirement Text: When `fromHookLLMResponse()` is called, the translator shall reconstruct a `GenerateContentResponse` from text parts only; non-text parts from the original response shall not be preserved.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fromHookLLMResponse()` is called
- THEN: the translator shall reconstruct a `GenerateContentResponse` from text parts only; non-text parts from the original response shall not be preserved

### Section 28. HookEventHandler Internal Flow
Coverage: 5 active requirements (HOOK-162..HOOK-166).

#### HOOK-162
Requirement Text: When the `HookEventHandler` fires a tool event, it shall pass `{ toolName }` as context to the planner for matcher filtering.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the `HookEventHandler` fires a tool event
- THEN: it shall pass `{ toolName }` as context to the planner for matcher filtering

#### HOOK-163
Requirement Text: When the `HookEventHandler` fires a model event, it shall pass `undefined` as context (no matcher) to the planner.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the `HookEventHandler` fires a model event
- THEN: it shall pass `undefined` as context (no matcher) to the planner

#### HOOK-164
Requirement Text: When the execution plan has `sequential: true`, the `HookEventHandler` shall delegate to `runner.executeHooksSequential()`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the execution plan has `sequential: true`
- THEN: the `HookEventHandler` shall delegate to `runner.executeHooksSequential()`

#### HOOK-165
Requirement Text: When the execution plan has `sequential: false`, the `HookEventHandler` shall delegate to `runner.executeHooksParallel()`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the execution plan has `sequential: false`
- THEN: the `HookEventHandler` shall delegate to `runner.executeHooksParallel()`

#### HOOK-166
Requirement Text: When execution completes, the `HookEventHandler` shall call `aggregator.aggregateResults(results, eventName)` to produce the `AggregatedHookResult`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: execution completes
- THEN: the `HookEventHandler` shall call `aggregator.aggregateResults(results, eventName)` to produce the `AggregatedHookResult`

### Section 33. Decision Summary Matrix
Coverage: 5 active requirements (HOOK-177..HOOK-181).

#### HOOK-177
Requirement Text: The BeforeTool event shall support blocking, tool input modification, and agent stopping.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The BeforeTool event shall support blocking, tool input modification, and agent stopping

#### HOOK-178
Requirement Text: The AfterTool event shall support context injection (`additionalContext`), output suppression, system message injection, and agent stopping — but shall not support blocking or direct output modification.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The AfterTool event shall support context injection (`additionalContext`), output suppression, system message injection, and agent stopping — but shall not support blocking or direct output modification

#### HOOK-179
Requirement Text: The BeforeModel event shall support blocking (with or without synthetic response), request modification, context injection (add messages), and agent stopping.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The BeforeModel event shall support blocking (with or without synthetic response), request modification, context injection (add messages), and agent stopping

#### HOOK-180
Requirement Text: The AfterModel event shall support response modification, response replacement, output suppression, and agent stopping — but shall not support blocking.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The AfterModel event shall support response modification, response replacement, output suppression, and agent stopping — but shall not support blocking

#### HOOK-181
Requirement Text: The BeforeToolSelection event shall support tool restriction (`allowedFunctionNames`), mode change, and agent stopping — but shall not support blocking, input modification, or output modification.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The BeforeToolSelection event shall support tool restriction (`allowedFunctionNames`), mode change, and agent stopping — but shall not support blocking, input modification, or output modification

Canonical requirement source: project-plans/hooksystemrewrite/requirements.md.

## Resolved Requirement Set

Active requirements owned by this phase: HOOK-061, HOOK-062, HOOK-063, HOOK-064, HOOK-065, HOOK-066, HOOK-067a, HOOK-067b, HOOK-068, HOOK-069, HOOK-070, HOOK-071, HOOK-072, HOOK-073, HOOK-074, HOOK-075, HOOK-076, HOOK-077, HOOK-078, HOOK-079, HOOK-162, HOOK-163, HOOK-164, HOOK-165, HOOK-166, HOOK-177, HOOK-178, HOOK-179, HOOK-180, HOOK-181

## Current vs Target Delta

| Requirement | Current State | Target State |
|---|---|---|
| HOOK-063 | Current behavior must be confirmed from code before implementation in this phase. | When a hook script exits with code 0 and writes valid JSON to stdout, the hook system shall parse the JSON and the caller shall apply the contained decisions and modifications to the operation. |
| HOOK-067b | Current behavior must be confirmed from code before implementation in this phase. | When a hook script exits with code 2 and stderr is empty (including the case where both stdout and stderr are empty), the hook system shall produce a blocking output with `decision: 'deny'` and a default reason string (e.g., `"Blocked by hook"`). In the current codebase, this edge case produces `output: undefined` because the stderr branch (`exitCode !== EXIT_CODE_SUCCESS && stderr.trim()`) is not entered when stderr is empty — `stderr.trim()` is falsy. The rewrite shall fix this to ensure exit code 2 always produces a blocking result regardless of stderr content. |

Each target delta above MUST be proven by phase verification tests before advancing.

## Implementation Tasks

### Files to Create
- packages/core/src/hooks/hookEventHandler.ts
- packages/core/src/hooks/hookEventHandler.test.ts

### Files to Modify
- packages/core/src/hooks/hookPlanner.ts
- packages/core/src/hooks/hookRunner.ts
- packages/core/src/hooks/hookRunner.test.ts
- packages/core/src/hooks/hookAggregator.ts
- packages/core/src/hooks/hookTranslator.ts
- packages/core/src/hooks/types.ts

### File and Symbol-Level Tasks
- packages/core/src/hooks/hookEventHandler.ts: fireBeforeToolEvent(), fireAfterToolEvent(), fireBeforeModelEvent(), fireAfterModelEvent(), fireBeforeToolSelectionEvent()
- packages/core/src/hooks/hookPlanner.ts: matcher filtering, dedup keys, sequential plan decision
- packages/core/src/hooks/hookRunner.ts: executeHooksSequential(), applyHookOutputToInput(), timeout/signal handling
- packages/core/src/hooks/hookAggregator.ts: merge semantics by event family and canonical precedence
- packages/core/src/hooks/hookTranslator.ts: toHookLLMRequest(), toHookLLMResponse()

### Required Markers
- @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P08
- @requirement:HOOK-061, HOOK-062, HOOK-063, HOOK-064, HOOK-065, HOOK-066, HOOK-067a, HOOK-067b, HOOK-068, HOOK-069, HOOK-070, HOOK-071, HOOK-072, HOOK-073, HOOK-074, HOOK-075, HOOK-076, HOOK-077, HOOK-078, HOOK-079, HOOK-162, HOOK-163, HOOK-164, HOOK-165, HOOK-166, HOOK-177, HOOK-178, HOOK-179, HOOK-180, HOOK-181
- @pseudocode:analysis/pseudocode/02-hook-event-handler-flow.md

## Verification Commands

### Structural Checks
- grep -R "@plan:PLAN-20260216-HOOKSYSTEMREWRITE.P08" packages/core packages/cli integration-tests
- grep -R "@requirement:" packages/core packages/cli integration-tests
- npm run test -- packages/core/src/hooks/hookEventHandler.test.ts packages/core/src/hooks/hookRunner.test.ts packages/core/src/hooks/hookTranslator.test.ts
- npm run typecheck

### Deferred Implementation Detection
- rg -n -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented)" packages/core packages/cli integration-tests --glob "*.ts" --glob "*.tsx"

### Semantic Verification Checklist
- [ ] All active requirements for this phase are implemented and test-proven.
- [ ] Caller behavior uses explicit policy decisions, not inferred success flags.
- [ ] Unified shouldStop/stopReason semantics are applied where required.
- [ ] Scope boundaries are preserved for out-of-scope events.

### Feature Actually Works
- node scripts/start.js --profile-load synthetic --prompt "validate hooks phase 08 behavior"

## Success Criteria
- Structural commands pass.
- Outcome-focused tests pass.
- Semantic checklist is complete with evidence in completion marker.

## Failure Recovery
- git checkout -- packages/core/src/hooks/hookEventHandler.ts packages/core/src/hooks/hookEventHandler.test.ts packages/core/src/hooks/hookPlanner.ts packages/core/src/hooks/hookRunner.ts packages/core/src/hooks/hookRunner.test.ts packages/core/src/hooks/hookAggregator.ts packages/core/src/hooks/hookTranslator.ts packages/core/src/hooks/types.ts
- sed -n '1,120p' project-plans/hooksystemrewrite/plan/08-hookeventhandler-and-protocol-contracts-implementation.md

## Phase Completion Marker
- Update project-plans/hooksystemrewrite/.completed/P08.md
- Required marker update: set `Status: COMPLETED` and fill all evidence fields.
