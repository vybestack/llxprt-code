# Requirements Review Round 2 — Combined (typescriptexpert + deepthinker)

Two independent reviewers found 20 and 25 issues respectively. Deduplicated and merged below.

---

## A. Factual Errors

### R2-01: HOOK-006 invents nonexistent API surface
HOOK-006 exposes `getPlanner()`, `getRunner()`, `getAggregator()` — none exist in the tech spec §3.1. HookSystem only has `initialize()`, `getEventHandler()`, `getRegistry()`, `getStatus()`. Planner/runner/aggregator are internal to HookEventHandler.

### R2-02: HOOK-196 wrong about signal-killed process behavior
Claims signal-killed processes are "treated as success." Actual code: `success = exitCode === EXIT_CODE_SUCCESS` where exitCode is `null` from signal kill, so `null === 0` is `false` → `success: false`. The `exitCode` field gets mapped to 0 via `exitCode || EXIT_CODE_SUCCESS`, but `success` is independently computed as `false`. Fix: signal-killed = success:false, exitCode field misleadingly 0.

### R2-03: HOOK-001/010 reference wrong config path `tools.enableHooks`
Actual config field is `enableHooks` (top-level, no `tools.` prefix). See config.ts `enableHooks?: boolean` and `getEnableHooks(): boolean`.

### R2-04: HOOK-154 says internal errors return `success: false`
But `HookEventHandler.safeExecuteEvent()` returns empty result with `success: true` on catch. Requirement contradicts implemented semantics.

### R2-05: HOOK-164 requires preserving non-text parts in translator
Specs explicitly describe lossy text-only translation for v1. Non-text parts are filtered/dropped. Requirement contradicts both overview and technical-overview.

### R2-06: HOOK-168 asserts dedup key includes matcher/sequential/source
Source code (`hookPlanner.ts`) uses only `command:${entry.config.command}`. Requirement doesn't match implementation.

### R2-07: HOOK-160 overstates plugin support
`HookType` enum only has `Command`. Registry validates `'plugin'` as a string but there's no `PluginHookConfig` type and HookRunner only handles command hooks. No end-to-end plugin execution path exists.

---

## B. Missing [Target] Markers

### R2-08: HOOK-017 — block reason as tool output (target, not current)
Requires caller to await hook result and construct ToolResult. Currently fire-and-forget. Target behavior.

### R2-09: HOOK-020 — `continue=false` terminates agent loop (target)
Hook system can't terminate agent loop alone — caller must. Currently callers fire-and-forget.

### R2-10: HOOK-129/130 — scheduler blocked-tool handling (target)
Scheduler never receives hook results today. Requires HOOK-127/128/134 first.

### R2-11: HOOK-134 — no `void` prefix, all callers `await` (target)
The central behavioral change of the rewrite. Currently ALL callers use `void` prefix.

### R2-12: HOOK-154 — `success: false` on internal error (target, if intended)
Current code returns `success: true` on catch. If the change is intentional, mark [Target].

### R2-13: HOOK-160 — plugin support (target or remove)
Not implemented end-to-end. Mark [Target] if rewrite scope, remove if not.

### R2-14: HOOK-168 — enhanced dedup key (target or fix)
Differs from current command-only dedup. Mark [Target] or align to current behavior.

---

## C. EARS Format Violations

### R2-15: HOOK-016a mixes two triggers/actions in one sentence
Exit code 2 with stderr non-empty + exit code 2 with stderr empty in one requirement. Split.

### R2-16: HOOK-152 explicitly marked as non-EARS legacy format
Violates document constraint that all requirements use EARS templates. Rewrite or remove.

---

## D. Consistency Issues

### R2-17: HOOK-031 vs HOOK-196 contradict on crash/signal behavior
HOOK-031: crashes are fail-open. HOOK-196: signal-kills are success. Signal-kill IS a crash. Actual code: signal-kill = success:false (HOOK-031's intent).

### R2-18: HOOK-070 vs HOOK-196 on exit code 0 semantics
HOOK-070: success=true only for exitCode 0. HOOK-196: signal-killed mapped to exitCode 0. But success is false for signal-killed processes. Inconsistent.

### R2-19: HOOK-013 vs HOOK-001/008 on object allocation
HOOK-013 forbids object allocations. HOOK-001/008 imply lazy creation/initialization. Conflicting unless scoped to disabled/no-match fast path.

### R2-20: HOOK-027/030/029 AfterTool combined effects undefined
additionalContext + systemMessage + suppressOutput have no precedence/ordering when all present simultaneously.

### R2-21: HOOK-016a vs HOOK-023/042 — need canonical exit-code precedence table
Different requirements describe exit-code handling with inconsistent detail. Need a single canonical table referenced by all.

### R2-22: HOOK-086 four-tier priority is actually two-tier in practice
Registry only uses `ConfigSource.Project` and `ConfigSource.Extensions`. User and System never assigned in production. Misleading.

---

## E. Completeness Gaps

### R2-23: No `BeforeToolHookOutput` compatibility fields requirement
`permissionDecision` and `permissionDecisionReason` compatibility fields in types.ts are untested behavior. Need requirement.

### R2-24: No `createHookOutput()` factory vs `createSpecificHookOutput()` behavior
Two factories return different types for BeforeTool events. `createHookOutput()` returns `DefaultHookOutput`, `createSpecificHookOutput()` returns `BeforeToolHookOutput`. Undocumented.

### R2-25: No double-encoded JSON handling requirement
`hookRunner.ts` parses once, checks if result is string, parses again. Real behavioral feature, no requirement.

### R2-26: No BeforeModel block-without-response caller behavior
When `blocked: true` AND `syntheticResponse: undefined`, what does the caller do? Vague "empty/error response" in spec, no testable requirement.

### R2-27: No `"ask"` decision type purpose
HOOK-182 says non-blocking. But why would a hook use "ask" vs "allow"? Intended to prompt user? Reserved? Undefined.

### R2-28: Missing non-regression requirements for out-of-scope events
SessionStart, SessionEnd, Notification, PreCompress, BeforeAgent, AfterAgent should have explicit non-regression requirements.

### R2-29: Missing scheduler state handling for blocked tools
Partial coverage of block behavior but no concrete requirements for scheduler state transitions and no-retry semantics.

### R2-30: Missing BeforeToolSelection translator wiring requirement
No direct requirement ensuring BeforeToolSelection uses actual `GenerateContentParameters` and translator instead of `{} as never`.

### R2-31: Missing trigger-function-performs-init requirement
Tech spec §4.2 says trigger functions (not constructors) perform initialization. Central to zero-startup-overhead. Not explicitly captured.

---

## F. Testability Issues

### R2-32: HOOK-017 under-specified for test assertions
"Model shall see block reason as tool output" — which field, what format, reason vs stopReason?

### R2-33: HOOK-031/052 "log a warning" — no log schema
Logger namespace, message shape, required fields all unspecified.

### R2-34: HOOK-050 stream-abort behavior undefined
What if stream aborts before full aggregation? Does AfterModel fire with partial response, synthetic error, or not at all?

### R2-35: HOOK-010/011/012 "not allocate infrastructure" not observable
"Not spawn processes" is testable. "Not allocate objects" requires instrumentation. Use observable proxies.

### R2-36: HOOK-013 mixes observable constraints with implementation details
"No async operations, file I/O, or object allocations" is partly untestable. Second clause (`getHookSystem()` returns `undefined`) is testable.

---

## G. Trace Issues

### R2-37: HOOK-088 traces to source code only
No spec section reference. Fallback-to-literal-on-invalid-regex is undocumented in both specs.

### R2-38: HOOK-091 dedup scope unclear
Same-event dedup after filtering, not cross-event. Should note post-matcher-filtering scope.

### R2-39: Multiple late-section requirements (150+) have weak traces
HOOK-152/154/160/164/168 trace to sections that don't substantiate the exact asserted behavior.

---

## H. Duplicates

### R2-40: HOOK-125/126 say the same thing
Both: no TTY dependency. HOOK-125 is more specific. Consolidate.

---

## I. Minor

### R2-41: HOOK-077 `blocked` field in LLMResponse type vs runtime
Runtime strips `blocked` from safetyRatings but TypeScript type still declares `blocked?: boolean`. Implementer note.

---

## Summary: 41 unique issues

| Category | Count |
|---|---|
| Factual errors | 7 |
| Missing [Target] markers | 7 |
| EARS format violations | 2 |
| Consistency issues | 6 |
| Completeness gaps | 9 |
| Testability issues | 5 |
| Trace issues | 3 |
| Duplicates | 1 |
| Minor | 1 |
| **Total** | **41** |
