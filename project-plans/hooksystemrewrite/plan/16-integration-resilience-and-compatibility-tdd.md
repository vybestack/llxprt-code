# Phase 16: Integration Resilience and Compatibility TDD

## Phase ID
PLAN-20260216-HOOKSYSTEMREWRITE.P16

## Prerequisites
- Completion marker exists and is complete: project-plans/hooksystemrewrite/.completed/P15a.md
- Verification command: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P15a.md
- Preflight gate complete: grep -q "^Status: COMPLETED$" project-plans/hooksystemrewrite/.completed/P00a.md

## Requirements Implemented (Expanded)

### Section 12. Matcher & Deduplication
Coverage: 5 active requirements (HOOK-087..HOOK-091).

#### HOOK-087
Requirement Text: When a hook entry has a `matcher` string, the hook planner shall treat it as a regular expression and test it against the `tool_name`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook entry has a `matcher` string
- THEN: the hook planner shall treat it as a regular expression and test it against the `tool_name`

#### HOOK-088
Requirement Text: If a `matcher` string is not a valid regular expression, then the hook planner shall treat it as a literal string for exact matching (fallback to literal on invalid regex).
Behavior Contract:
- GIVEN: an error/unwanted condition is possible during runtime
- WHEN: a `matcher` string is not a valid regular expression
- THEN: the hook planner shall treat it as a literal string for exact matching (fallback to literal on invalid regex)

#### HOOK-089
Requirement Text: When a hook entry has no `matcher` or an empty/wildcard matcher, the hook shall match all tools.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook entry has no `matcher` or an empty/wildcard matcher
- THEN: the hook shall match all tools

#### HOOK-090
Requirement Text: When the same command string appears multiple times for the same event after matcher filtering, the hook planner shall execute it only once and keep the first encountered instance (which is from the highest-priority source due to source-priority sorting in HOOK-086).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: the same command string appears multiple times for the same event after matcher filtering
- THEN: the hook planner shall execute it only once and keep the first encountered instance (which is from the highest-priority source due to source-priority sorting in HOOK-086)

#### HOOK-091
Requirement Text: The deduplication key shall be `command:<command_string>` only — it shall not include event name, matcher, timeout, or source. Deduplication applies within a single event's execution plan, after matcher filtering, not across different events. The first occurrence (highest-priority source due to source-priority sorting in HOOK-086) shall be retained and subsequent duplicates shall be discarded.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The deduplication key shall be `command:<command_string>` only — it shall not include event name, matcher, timeout, or source. Deduplication applies within a single event's execution plan, after matcher filtering, not across different events. The first occurrence (highest-priority source due to source-priority sorting in HOOK-086) shall be retained and subsequent duplicates shall be discarded

### Section 13. Composition & Aggregation — OR-Decision Merge (Tool Events)
Coverage: 6 active requirements (HOOK-092..HOOK-097).

#### HOOK-092
Requirement Text: When multiple hooks fire for a BeforeTool or AfterTool event and any single hook returns a block decision, the aggregated result shall be a block.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a BeforeTool or AfterTool event and any single hook returns a block decision
- THEN: the aggregated result shall be a block

#### HOOK-093
Requirement Text: When multiple hooks fire for a tool event, the aggregator shall concatenate all `reason` strings (newline-separated) from all hooks.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a tool event
- THEN: the aggregator shall concatenate all `reason` strings (newline-separated) from all hooks

#### HOOK-094
Requirement Text: When multiple hooks fire for a tool event, the aggregator shall concatenate all `systemMessage` strings.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a tool event
- THEN: the aggregator shall concatenate all `systemMessage` strings

#### HOOK-095
Requirement Text: When multiple hooks fire for a tool event, the aggregator shall concatenate all `additionalContext` strings.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a tool event
- THEN: the aggregator shall concatenate all `additionalContext` strings

#### HOOK-096
Requirement Text: When multiple hooks fire for a tool event, the aggregator shall use OR logic for `suppressOutput` — any `true` value shall win.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a tool event
- THEN: the aggregator shall use OR logic for `suppressOutput` — any `true` value shall win

#### HOOK-097
Requirement Text: When multiple hooks fire for a tool event and any hook returns `continue` = `false`, the aggregated result shall stop the agent.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a tool event and any hook returns `continue` = `false`
- THEN: the aggregated result shall stop the agent

### Section 14. Composition & Aggregation — Field-Replacement Merge (Model Events)
Coverage: 1 active requirements (HOOK-098..HOOK-098).

#### HOOK-098
Requirement Text: When multiple hooks fire for a BeforeModel or AfterModel event, the aggregator shall shallow-merge `hookSpecificOutput` across hooks, with later hook outputs overriding earlier ones for the same fields. This merge strategy applies regardless of whether hooks execute in parallel or sequentially.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for a BeforeModel or AfterModel event
- THEN: the aggregator shall shallow-merge `hookSpecificOutput` across hooks, with later hook outputs overriding earlier ones for the same fields. This merge strategy applies regardless of whether hooks execute in parallel or sequentially

### Section 15. Composition & Aggregation — Union Merge (Tool Selection)
Coverage: 4 active requirements (HOOK-099..HOOK-102).

#### HOOK-099
Requirement Text: When multiple hooks fire for BeforeToolSelection, the aggregator shall union (combine) all `allowedFunctionNames` from all hooks.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for BeforeToolSelection
- THEN: the aggregator shall union (combine) all `allowedFunctionNames` from all hooks

#### HOOK-100
Requirement Text: When multiple hooks fire for BeforeToolSelection, the aggregator shall resolve mode by most-restrictive-wins: `NONE` > `ANY` > `AUTO`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: multiple hooks fire for BeforeToolSelection
- THEN: the aggregator shall resolve mode by most-restrictive-wins: `NONE` > `ANY` > `AUTO`

#### HOOK-101
Requirement Text: When any BeforeToolSelection hook specifies mode `NONE`, the aggregated result shall have mode `NONE` and an empty `allowedFunctionNames` list, regardless of other hooks' outputs.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: any BeforeToolSelection hook specifies mode `NONE`
- THEN: the aggregated result shall have mode `NONE` and an empty `allowedFunctionNames` list, regardless of other hooks' outputs

#### HOOK-102
Requirement Text: The aggregator shall sort `allowedFunctionNames` alphabetically for deterministic behavior.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The aggregator shall sort `allowedFunctionNames` alphabetically for deterministic behavior

### Section 16. Sequential Chaining
Coverage: 7 active requirements (HOOK-103..HOOK-109).

#### HOOK-103
Requirement Text: While a hook group has `sequential: true`, the hooks in that group shall execute in array order, one at a time.
Behavior Contract:
- GIVEN: a hook group has `sequential: true`
- WHEN: the runtime remains in that state
- THEN: the hooks in that group shall execute in array order, one at a time

#### HOOK-104
Requirement Text: When hooks execute sequentially and a hook succeeds (`success: true`, i.e., exit code 0) with non-empty output, that hook's output shall be applied to the input before passing it to the next hook via `applyHookOutputToInput()`. If a hook does not succeed or produces no output, the input shall be passed unchanged to the next hook.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: hooks execute sequentially and a hook succeeds (`success: true`
- THEN: i.e., exit code 0) with non-empty output, that hook's output shall be applied to the input before passing it to the next hook via `applyHookOutputToInput()`. If a hook does not succeed or produces no output, the input shall be passed unchanged to the next hook

#### HOOK-105
Requirement Text: When hooks execute sequentially for BeforeModel, a modified `llm_request` from one hook shall become the `llm_request` for the next hook via shallow merge.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: hooks execute sequentially for BeforeModel
- THEN: a modified `llm_request` from one hook shall become the `llm_request` for the next hook via shallow merge

#### HOOK-106
Requirement Text: [Target] When hooks execute sequentially for BeforeTool, a modified `tool_input` from one hook shall replace the `tool_input` for the next hook.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: hooks execute sequentially for BeforeTool
- THEN: a modified `tool_input` from one hook shall replace the `tool_input` for the next hook

#### HOOK-107
Requirement Text: [Target] When any hook in a sequential chain returns a block decision, the remaining hooks in the chain shall not execute.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: any hook in a sequential chain returns a block decision
- THEN: the remaining hooks in the chain shall not execute

#### HOOK-108
Requirement Text: While `sequential` is `false` (the default), all hooks for an event shall execute concurrently and their outputs shall be aggregated after all complete.
Behavior Contract:
- GIVEN: `sequential` is `false` (the default)
- WHEN: the runtime remains in that state
- THEN: all hooks for an event shall execute concurrently and their outputs shall be aggregated after all complete

#### HOOK-109
Requirement Text: When any hook group for an event has `sequential: true`, the hook planner shall set `sequential: true` on the entire execution plan, causing all hooks for that event to run sequentially regardless of other groups' settings. Verified in source: `deduplicatedEntries.some(entry => entry.sequential === true)`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: any hook group for an event has `sequential: true`
- THEN: the hook planner shall set `sequential: true` on the entire execution plan, causing all hooks for that event to run sequentially regardless of other groups' settings. Verified in source: `deduplicatedEntries.some(entry => entry.sequential === true)`

### Section 17. Error Handling & Resilience
Coverage: 7 active requirements (HOOK-110..HOOK-116).

#### HOOK-110
Requirement Text: The hook system shall never allow a hook failure to prevent tool execution or model calls — the only way to block is an explicit block decision (exit code 2 or `decision: 'block'|'deny'` on exit code 0). See the Canonical Exit-Code Precedence Table (§35) for complete exit-code-to-behavior mapping.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall never allow a hook failure to prevent tool execution or model calls — the only way to block is an explicit block decision (exit code 2 or `decision: 'block'|'deny'` on exit code 0). See the Canonical Exit-Code Precedence Table (§35) for complete exit-code-to-behavior mapping

#### HOOK-111
Requirement Text: The hook system shall never throw exceptions to callers — every public function in the trigger layer shall catch all exceptions and return a safe default.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall never throw exceptions to callers — every public function in the trigger layer shall catch all exceptions and return a safe default

#### HOOK-112
Requirement Text: When 3 hooks run and 1 fails, the hook system shall aggregate and return the outputs of the 2 successful hooks (partial success preservation).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: 3 hooks run and 1 fails
- THEN: the hook system shall aggregate and return the outputs of the 2 successful hooks (partial success preservation)

#### HOOK-113
Requirement Text: When a hook infrastructure error occurs (HookSystem init failure, planner error), the `fire*Event()` method shall catch it, log at warn level via `DebugLogger`, and return an empty success result with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook infrastructure error occurs (HookSystem init failure
- THEN: planner error), the `fire*Event()` method shall catch it, log at warn level via `DebugLogger`, and return an empty success result with `{ success: true, finalOutput: undefined, allOutputs: [], errors: [], totalDuration: 0 }`

#### HOOK-114
Requirement Text: When a hook script exits with code 0 and stdout contains invalid JSON, the hook system shall treat stdout as a plain-text `systemMessage` and proceed with `decision: 'allow'`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exits with code 0 and stdout contains invalid JSON
- THEN: the hook system shall treat stdout as a plain-text `systemMessage` and proceed with `decision: 'allow'`

#### HOOK-115
Requirement Text: When `fireBeforeToolHook` encounters any uncaught exception, it shall return `undefined` (safe default allowing the tool to proceed).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeToolHook` encounters any uncaught exception
- THEN: it shall return `undefined` (safe default allowing the tool to proceed)

#### HOOK-116
Requirement Text: When `fireBeforeModelHook` encounters any uncaught exception, it shall return `{ blocked: false }` (safe default allowing the model call to proceed).
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: `fireBeforeModelHook` encounters any uncaught exception
- THEN: it shall return `{ blocked: false }` (safe default allowing the model call to proceed)

### Section 18. Timeout Enforcement
Coverage: 4 active requirements (HOOK-117..HOOK-120).

#### HOOK-117
Requirement Text: When a hook script exceeds its configured timeout, the hook system shall send `SIGTERM` to the script process.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script exceeds its configured timeout
- THEN: the hook system shall send `SIGTERM` to the script process

#### HOOK-118
Requirement Text: When a hook script has not exited 5 seconds after receiving `SIGTERM`, the hook system shall send `SIGKILL`.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script has not exited 5 seconds after receiving `SIGTERM`
- THEN: the hook system shall send `SIGKILL`

#### HOOK-119
Requirement Text: When a hook script is killed due to timeout, the hook system shall treat it as an error (fail-open) and log a warning including the timeout duration.
Behavior Contract:
- GIVEN: the system is in the hook event path covered by this phase
- WHEN: a hook script is killed due to timeout
- THEN: the hook system shall treat it as an error (fail-open) and log a warning including the timeout duration

#### HOOK-120
Requirement Text: The default hook timeout shall be 60,000 milliseconds (60 seconds).
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The default hook timeout shall be 60,000 milliseconds (60 seconds)

### Section 19. Environment Variables
Coverage: 0 active requirements (none).

Merged/Retired IDs (not implemented directly in this phase):
- HOOK-121 is merged into HOOK-188; implement via owner phase 11.
- HOOK-122 is merged into HOOK-188; implement via owner phase 11.
- HOOK-123 is merged into HOOK-188; implement via owner phase 11.
- HOOK-124 is merged into HOOK-188; implement via owner phase 11.

### Section 20. Mode Independence
Coverage: 1 active requirements (HOOK-125..HOOK-125).

#### HOOK-125
Requirement Text: The hook system shall not read from or depend on the process's TTY state — hook behavior shall be identical regardless of invocation mode: interactive (default TTY), non-interactive (`--prompt`), headless (`--headless`), or piped input/output. The hook system shall not depend on TTY availability or user interaction for any hook behavior.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall not read from or depend on the process's TTY state — hook behavior shall be identical regardless of invocation mode: interactive (default TTY), non-interactive (`--prompt`), headless (`--headless`), or piped input/output. The hook system shall not depend on TTY availability or user interaction for any hook behavior

Merged/Retired IDs (not implemented directly in this phase):
- HOOK-126 is merged into HOOK-125; implement via owner phase 17.

### Section 25. Existing Hook Scripts — Backward Compatibility
Coverage: 2 active requirements (HOOK-155..HOOK-156).

#### HOOK-155
Requirement Text: The hook system shall not change the stdin JSON format, stdout JSON format, exit code semantics, environment variables, timeout behavior, or sequential chaining behavior visible to hook scripts.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The hook system shall not change the stdin JSON format, stdout JSON format, exit code semantics, environment variables, timeout behavior, or sequential chaining behavior visible to hook scripts

#### HOOK-156
Requirement Text: [Target] The rewritten hook system shall honor hook output decisions and modifications (blocking, input modification, context injection, etc.) that the current implementation parses but does not apply.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The rewritten hook system shall honor hook output decisions and modifications (blocking, input modification, context injection, etc.) that the current implementation parses but does not apply

### Section 27. Transcript Path
Coverage: 1 active requirements (HOOK-161..HOOK-161).

#### HOOK-161
Requirement Text: The `transcript_path` base field shall be set to an empty string `''` until `Config` exposes a `getTranscriptPath()` method.
Behavior Contract:
- GIVEN: normal hook system execution
- WHEN: the relevant runtime path is invoked
- THEN: The `transcript_path` base field shall be set to an empty string `''` until `Config` exposes a `getTranscriptPath()` method

### Section 35. Canonical Exit-Code Precedence Table
Coverage: 0 active requirements (none).

### Section 37. Rewrite Scope Boundary
Coverage: 0 active requirements (none).

Canonical requirement source: project-plans/hooksystemrewrite/requirements.md.

## Resolved Requirement Set

Active requirements owned by this phase: HOOK-087, HOOK-088, HOOK-089, HOOK-090, HOOK-091, HOOK-092, HOOK-093, HOOK-094, HOOK-095, HOOK-096, HOOK-097, HOOK-098, HOOK-099, HOOK-100, HOOK-101, HOOK-102, HOOK-103, HOOK-104, HOOK-105, HOOK-106, HOOK-107, HOOK-108, HOOK-109, HOOK-110, HOOK-111, HOOK-112, HOOK-113, HOOK-114, HOOK-115, HOOK-116, HOOK-117, HOOK-118, HOOK-119, HOOK-120, HOOK-125, HOOK-155, HOOK-156, HOOK-161

Merged/retired IDs that must NOT be implemented separately:
- HOOK-121 -> HOOK-188 (owner phase 11)
- HOOK-122 -> HOOK-188 (owner phase 11)
- HOOK-123 -> HOOK-188 (owner phase 11)
- HOOK-124 -> HOOK-188 (owner phase 11)
- HOOK-126 -> HOOK-125 (owner phase 17)

## Current vs Target Delta

| Requirement | Current State | Target State |
|---|---|---|
| HOOK-106 | Current behavior must be confirmed from code before implementation in this phase. | When hooks execute sequentially for BeforeTool, a modified `tool_input` from one hook shall replace the `tool_input` for the next hook. |
| HOOK-107 | Current behavior must be confirmed from code before implementation in this phase. | When any hook in a sequential chain returns a block decision, the remaining hooks in the chain shall not execute. |
| HOOK-156 | Current behavior must be confirmed from code before implementation in this phase. | The rewritten hook system shall honor hook output decisions and modifications (blocking, input modification, context injection, etc.) that the current implementation parses but does not apply. |

Each target delta above MUST be proven by phase verification tests before advancing.

## Implementation Tasks

### Files to Create
- integration-tests/hooks/hooks-tool-pipeline.integration.test.ts
- integration-tests/hooks/hooks-model-pipeline.integration.test.ts
- integration-tests/hooks/hooks-scope-boundary.integration.test.ts

### Files to Modify
- packages/core/src/core/client.ts
- packages/core/src/config/settingsSchema.ts
- schemas/settings.schema.json
- packages/core/src/hooks/index.ts
- packages/core/src/hooks/README.md
- project-plans/hooksystemrewrite/usecaseexamples.md

### File and Symbol-Level Tasks
- packages/core/src/core/client.ts: runtime wiring for enableHooks and mode-independent behavior
- packages/core/src/hooks/index.ts: stable exports for HookSystem/HookEventHandler
- packages/core/src/config/settingsSchema.ts + schemas/settings.schema.json: canonical enableHooks path only
- integration-tests/hooks/*.integration.test.ts: end-to-end pipeline and scope-boundary assertions
- project-plans/hooksystemrewrite/usecaseexamples.md: align configuration examples to top-level enableHooks

### Required Markers
- @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P16
- @requirement:HOOK-087, HOOK-088, HOOK-089, HOOK-090, HOOK-091, HOOK-092, HOOK-093, HOOK-094, HOOK-095, HOOK-096, HOOK-097, HOOK-098, HOOK-099, HOOK-100, HOOK-101, HOOK-102, HOOK-103, HOOK-104, HOOK-105, HOOK-106, HOOK-107, HOOK-108, HOOK-109, HOOK-110, HOOK-111, HOOK-112, HOOK-113, HOOK-114, HOOK-115, HOOK-116, HOOK-117, HOOK-118, HOOK-119, HOOK-120, HOOK-125, HOOK-155, HOOK-156, HOOK-161
- @pseudocode:analysis/pseudocode/06-resilience-timeouts-compatibility.md

## Verification Commands

### Structural Checks
- grep -R "@plan:PLAN-20260216-HOOKSYSTEMREWRITE.P16" packages/core packages/cli integration-tests
- grep -R "@requirement:" packages/core packages/cli integration-tests
- npm run test -- integration-tests/hooks/hooks-tool-pipeline.integration.test.ts integration-tests/hooks/hooks-model-pipeline.integration.test.ts integration-tests/hooks/hooks-scope-boundary.integration.test.ts
- npm run typecheck

### Deferred Implementation Detection
- rg -n -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented)" packages/core packages/cli integration-tests --glob "*.ts" --glob "*.tsx"

### Outcome-Focused Verification (Integration + Scope Boundaries)
- npm run test -- integration-tests/hooks/hooks-tool-pipeline.integration.test.ts
- npm run test -- integration-tests/hooks/hooks-model-pipeline.integration.test.ts
- npm run test -- integration-tests/hooks/hooks-scope-boundary.integration.test.ts -t "out-of-scope events fire but outputs are not applied"
- npm run test -- integration-tests/hooks/hooks-model-pipeline.integration.test.ts -t "AggregatedHookResult.success is not used for block policy"

### Semantic Verification Checklist
- [ ] New tests fail for correct behavioral reasons before implementation.
- [ ] Tests verify outcomes, not internal implementation details.
- [ ] Integration boundaries include negative and edge-path tests.
- [ ] Tests explicitly cover current vs target deltas listed above.

### Feature Actually Works
- node scripts/start.js --profile-load synthetic --prompt "validate hooks phase 16 behavior"

## Success Criteria
- Structural commands pass.
- Outcome-focused tests pass.
- Semantic checklist is complete with evidence in completion marker.

## Failure Recovery
- git checkout -- integration-tests/hooks/hooks-tool-pipeline.integration.test.ts integration-tests/hooks/hooks-model-pipeline.integration.test.ts integration-tests/hooks/hooks-scope-boundary.integration.test.ts packages/core/src/core/client.ts packages/core/src/config/settingsSchema.ts schemas/settings.schema.json packages/core/src/hooks/index.ts packages/core/src/hooks/README.md project-plans/hooksystemrewrite/usecaseexamples.md
- sed -n '1,120p' project-plans/hooksystemrewrite/plan/16-integration-resilience-and-compatibility-tdd.md

## Phase Completion Marker
- Update project-plans/hooksystemrewrite/.completed/P16.md
- Required marker update: set `Status: COMPLETED` and fill all evidence fields.
