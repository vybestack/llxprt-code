# Requirements Review Round 1 — Combined (typescriptexpert + deepthinker)

Two independent reviewers found 30 issues each. Deduplicated and merged below.

---

## A. EARS Format Violations

### R1-01: HOOK-016 mixes two triggers
HOOK-016 combines exit code 2 AND JSON `decision: "block"/"deny"` in one event-driven requirement. These are two different code paths (exit 2 uses stderr via `convertPlainTextToHookOutput()`; JSON decision on exit 0 uses stdout parsing). Split into two requirements or use aggregated framing.

### R1-02: HOOK-021 embeds state in event template
"When only hooks whose matcher regex matches ... exist" embeds a state qualifier inside event-driven template. Reword: "When a BeforeTool event is fired, the hook system shall invoke only hooks whose matcher matches tool_name."

### R1-03: HOOK-060 conflates two actions
"shall not affect tool selection and shall log a warning" — two independently testable outcomes in one requirement. The logging contract (level/message) is under-specified.

### R1-04: HOOK-006 is architectural, not behavioral
"shall own exactly one instance each of..." — hard to test without inspecting internal state. Reword as observable behavior.

### R1-05: HOOK-142/143 specify file paths
File locations are conventions, not testable EARS requirements. Move to implementation notes or reword as importability.

---

## B. Factual Errors

### R1-06: Exit code 2 stdout parsing (HOOK-016, HOOK-067)
In `hookRunner.ts`, stdout JSON is only parsed when `exitCode === EXIT_CODE_SUCCESS` (0). Exit code 2 falls to stderr branch via `convertPlainTextToHookOutput()`. HOOK-067 implies stdout JSON is parsed on exit 2, then falls back to stderr. This contradicts source code. Also: exit code 2 + empty stderr = undefined output (unaddressed edge case).

### R1-07: Sequential block-exit not implemented (HOOK-107)
`hookRunner.ts` `executeHooksSequential()` never checks blocking decisions or breaks from loop. HOOK-107 specifies target behavior but reads as if describing current behavior. Mark as [Target — new behavior].

### R1-08: BeforeTool chaining not implemented (HOOK-024)
`applyHookOutputToInput()` currently supports only BeforeAgent and BeforeModel. No BeforeTool branch exists. Same issue as R1-07 — must be marked as target/new behavior.

### R1-09: systemMessage injection is target-only (HOOK-030)
Infrastructure can carry `systemMessage` but no current mechanism injects it into conversation state. Target behavior, not current.

### R1-10: AfterModel suppressOutput is target-only (HOOK-049)
`AfterModelHookOutput` has no display-integration logic. Target behavior.

### R1-11: HOOK-055 overstates tool filtering
`applyToolConfigModifications()` updates `toolConfig` but returns `tools: target.tools || []` unchanged. No direct filtering of tool definitions occurs. Requirement overstates guaranteed effect.

### R1-12: HOOK-063/064 read as fully realized
Parsing happens in HookRunner, but application depends on callers (currently fire-and-forget). These are target behaviors that read as current.

### R1-13: Signal-killed processes treated as success (HOOK-023 gap)
`hookRunner.ts` line 308: `exitCode: exitCode || EXIT_CODE_SUCCESS` — if `exitCode` is `null` (signal kill), defaults to 0 = success. A signal-killed process is silently treated as success=true.

---

## C. Trace Issues

### R1-14: HOOK-065 broken trace
`Traces to: overview.md §` — missing section number.

### R1-15: HOOK-048 traces to source code
Trace includes `types.ts AfterModelHookOutput.getModifiedResponse()` — source code ref, not spec section. Should trace to technical-overview.md §5.2 and overview.md §3.4.

### R1-16: HOOK-131 introduces format not in functional spec
`"\n\n[System] "` format only exists in technical-overview.md, not overview.md. Minor trace gap.

---

## D. Completeness Gaps

### R1-17: No requirement for `"ask"` decision value
`HookDecision` type includes `"ask"`. No requirement specifies its semantics (treated as allow? reserved?).

### R1-18: No `executeToolWithHooks` stop-result structure
HOOK-020 says "terminate the agent loop" but no requirement describes the stop ToolResult structure or how callers detect it vs normal results.

### R1-19: BeforeModel conflation of shouldStopExecution and blocked
`fireBeforeModelHook` treats both `isBlockingDecision()` and `shouldStopExecution()` as `blocked: true`. A `continue: false` hook that is not a blocking decision still returns `blocked: true`. Not captured in any requirement.

### R1-20: No `tool_response` shape specification (HOOK-026)
AfterTool input includes `tool_response` but no requirement specifies its structure (llmContent, returnDisplay, metadata, error).

### R1-21: Missing deduplication requirement
`hookPlanner.deduplicateHooks` based on `command` string — no requirement captures this. Important for deterministic execution.

### R1-22: Missing sequential-escalation rule
If any matching hook has `sequential=true`, entire plan runs sequentially. Key behavioral rule in `hookPlanner.createExecutionPlan`, not captured.

### R1-23: Missing source-priority ordering
Registry sorts by source priority (`project > user > system > extensions` via `getSourcePriority`). Observable behavior, not captured.

### R1-24: Missing timeout termination specifics
SIGTERM on timeout, SIGKILL fallback after 5s. Only high-level fail-open is captured.

### R1-25: Missing environment variables requirement
`$LLXPRT_PROJECT_DIR`, `$GEMINI_PROJECT_DIR`, `$CLAUDE_PROJECT_DIR` injected into child process env. Not captured.

### R1-26: Missing exit-code-2 stderr-as-reason behavior
When exit 2 and no stdout JSON, stderr text becomes blocking reason via `convertPlainTextToHookOutput()`. Specific observable rule, not captured.

### R1-27: Missing aggregation semantics
OR-merge for tool events, field-replacement for model events (later overrides earlier), union-merge for tool selection (with mode precedence NONE > ANY > AUTO). Core composition behavior, not captured.

### R1-28: Missing hook type validation requirement
Registry validates `type` must be `'command'` or `'plugin'`, `'command'` requires `command` field. Invalid definitions discarded with logging. Not captured.

### R1-29: No EPIPE error handling requirement
`hookRunner.ts` handles EPIPE on stdin (child closes early). Important robustness behavior.

### R1-30: No double-encoded JSON handling requirement
`hookRunner.ts` handles stdout that is a double-encoded JSON string. Existing behavior.

### R1-31: Missing getSyntheticResponse asymmetry
`BeforeModelHookOutput.getSyntheticResponse()` only returns response if `hookSpecificOutput.llm_response` is present. Does NOT auto-generate for `shouldStopExecution()`. Asymmetry with `AfterModelHookOutput.getModifiedResponse()`.

---

## E. Duplicates/Redundancy

### R1-32: HOOK-003/004 substantially redundant
Same invariant expressed two ways. Consider merging or marking HOOK-004 as mechanism for HOOK-003.

### R1-33: HOOK-127/128 duplicated by HOOK-150/151
HOOK-150/151 are supersets (parameters + return type). HOOK-127/128 only add transitional "instead of void" language.

### R1-34: HOOK-110 generalizes HOOK-023/031/042/052/060
General fail-open requirement duplicates per-event fail-open requirements. Mark as summary or remove per-event versions.

---

## F. Testability Issues

### R1-35: HOOK-010 "measurable latency" untestable
No bound, metric, or baseline. Cannot produce deterministic pass/fail. Reword or defer to HOOK-013.

### R1-36: HOOK-011 "per-event infrastructure" not observable
Black-box untestable. Reword as observable behavior.

### R1-37: HOOK-013 "fast-path boolean check" implementation-prescriptive
Specify observable behavior instead: "shall require no async operations, file I/O, or object allocations."

### R1-38: HOOK-029 suppressDisplay ambiguous observation points
"not displayed to user, but model shall still see it" — two channels, no explicit observation points.

### R1-39: HOOK-039 context message ordering unspecified
"include additional context messages" — no ordering, dedup, append/prepend defined.

### R1-40: HOOK-050 "after streaming chunks collected" undefined boundary
Needs formal definition of complete-response boundary for testing.

### R1-41: HOOK-125 "behave identically" untestable
Reword as: "shall not read from or depend on the process's TTY state."

### R1-42: HOOK-156 "outputs now actually take effect" narrative
Not a testable requirement. Move to design goals or remove.

---

## G. Consistency Issues

### R1-43: HOOK-016 vs HOOK-023 interaction undefined
Exit code 2 blocks. Non-0-non-2 is fail-open. But HOOK-016 also allows JSON `decision: block` — which only works on exit 0. A hook returning `decision: block` on non-zero non-2 exit won't block. Interaction unresolved.

### R1-44: HOOK-036/037 vs HOOK-042 exit-code precedence
If script emits valid block JSON but exits non-zero (non-2), it's treated as failure (fail-open) not block. Precedence of exit-code vs output semantics is ambiguous for BeforeModel.

### R1-45: HOOK-055 vs HOOK-056/057 aggregation conflict
HOOK-055 implies per-hook restriction. Aggregator performs union of allowed names across hooks. Requirements don't state union behavior, creating contradictory interpretations.

### R1-46: HOOK-098 says "in parallel" but applies to all modes
Aggregator merge strategy applies regardless of parallel/sequential. Remove "in parallel" qualifier.

### R1-47: HOOK-081 lists 5 events but enum has 11
Correct for rewrite scope, but configuring hooks for out-of-scope events (SessionStart etc.) currently works. Should clarify: supported, blocked, or undefined?

### R1-48: Plugin type accepted by validator but no execution path (HOOK-083)
`HookType` enum has only `Command`. `hookRegistry.ts` accepts `'plugin'` but runner only handles command hooks. What happens when a validated plugin hook reaches the runner?

---

## Summary: 48 unique issues (from 60 raw across both reviewers)

| Category | Count |
|---|---|
| EARS format violations | 5 |
| Factual errors | 8 |
| Trace issues | 3 |
| Completeness gaps | 15 |
| Duplicates/redundancy | 3 |
| Testability | 8 |
| Consistency | 6 |
| **Total** | **48** |
