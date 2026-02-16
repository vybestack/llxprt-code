# Requirements Review Round 3 — Combined (typescriptexpert + deepthinker)

12 + 18 = 30 raw issues. Deduplicated below to 22 unique findings.

---

## A. Factual Errors / Spec Inconsistencies

### R3-01: overview.md still says `tools.enableHooks` — spec erratum
Requirements correctly say `enableHooks` but trace to overview.md which still says `tools.enableHooks` (§6.1, §7.1, §9). Fix the spec, or add erratum note in requirements.

### R3-02: HOOK-183 invents `blocked: true` on ToolResult
Tech spec §5.1 says blocked result is a ToolResult with `llmContent` containing block reason, not a `blocked` property. Caller detects block via `beforeOutput?.isBlockingDecision()` before calling `executeFn()`. HOOK-183 invents an API not in the spec.

### R3-03: HOOK-070 selectively documents null case, omits exit code 2
HOOK-070 mentions null exitCode but not exit code 2, which also produces `success: false`. Add: "Exit codes 2 and any other non-zero also produce `success: false`."

---

## B. Redundancy / Consolidation

### R3-04: HOOK-109 and HOOK-186 are near-duplicates
Both describe sequential-escalation. HOOK-186 added in R1 but HOOK-109 already existed. Merge into HOOK-109.

### R3-05: HOOK-091 and HOOK-185 are near-duplicates
Both describe command-based dedup. HOOK-185 adds "first occurrence retained" but HOOK-090 already says that. Merge into HOOK-091.

### R3-06: HOOK-121/122/123/124 fully duplicated by HOOK-188
HOOK-188 consolidates env vars but didn't retire originals. Retire HOOK-121–124 with merge notes, or remove HOOK-188.

### R3-07: HOOK-168 conflates tool restriction with dedup key
Two unrelated topics in one requirement. Remove dedup sentence (covered by HOOK-091/185).

---

## C. Missing [Target] Markers

### R3-08: HOOK-049 missing [Target]
AfterModel suppressOutput — no caller acts on AfterModel outputs today. Same situation as HOOK-029 which IS marked [Target].

### R3-09: HOOK-048 missing [Target]
AfterModel response modification requires caller integration. Same pattern as HOOK-019 which IS marked [Target].

### R3-10: HOOK-050 borderline — fires today but with fake data
AfterModel fires today but passes `{} as never`. The "with real data" part is target. Add note.

### R3-11: HookSystemNotInitializedError requirements need [Target]
Class doesn't exist in current code (only HookRegistryNotInitializedError). Mark [Target].

### R3-12: Audit all effectful requirements for [Target] completeness
Any requirement expecting end-to-end effect (blocking, mutation, suppression, stop propagation) is target-only since callers are fire-and-forget. Systematic audit needed.

---

## D. Completeness Gaps

### R3-13: No requirement for non-0/non-2 exit code stderr conversion
hookRunner.ts converts stderr to `{ decision: 'allow', systemMessage: 'Warning: <stderr>' }` for non-0/non-2 with non-empty stderr. Not captured.

### R3-14: BeforeToolSelection merge semantics (mode precedence, union, sorting)
`hookAggregator.ts` enforces NONE > ANY > AUTO precedence, union of allowedFunctionNames, deterministic sorting. Not fully captured.

### R3-15: Per-event sequential chaining coverage
`applyHookOutputToInput()` handles BeforeAgent and BeforeModel only. After* events and BeforeToolSelection have no-op chaining. Requirements discuss broadly but don't specify per-event.

### R3-16: Malformed JSON stdout handling and parse-fallback precedence
Exit 0 attempts JSON parse, falls back to plain text conversion. Specific precedence not fully captured as protocol requirement.

### R3-17: Policy decisions derive from finalOutput, not aggregate success
`success: false` on AggregatedHookResult means execution failure. Policy (block/allow/stop) comes from `finalOutput` decision/continue fields. This distinction is important and missing.

---

## E. Consistency Issues

### R3-18: HOOK-067 mixes current and target behavior in one requirement
Non-empty stderr = current behavior. Empty stderr fix = target. Split into two requirements.

### R3-19: "Success" vs "policy" language confusion across multiple requirements
Several requirements use success/failure language that could mean execution health or policy outcome. Clarify.

### R3-20: Config-source precedence requirements conflict with actual registry ingestion
Registry processes all hooks as ConfigSource.Project. Four-tier precedence exists in enum but only two tiers are used.

---

## F. Testability

### R3-21: HOOK-200 is documentation, not testable requirement
Rewrite to focus on observable: `createHookOutput('BeforeTool')` returns DefaultHookOutput (not BeforeToolHookOutput), so compatibility fields aren't checked.

---

## G. Scope Clarity

### R3-22: Missing explicit scope boundary for which events are rewrite vs unchanged
HookEventName has 11 events, rewrite covers 5. Universal "hook system shall..." wording could be interpreted for all events. Add scope statement.

---

## Summary: 22 unique issues

| Category | Count |
|---|---|
| Factual errors / spec issues | 3 |
| Redundancy / consolidation | 4 |
| Missing [Target] markers | 5 |
| Completeness gaps | 5 |
| Consistency | 3 |
| Testability | 1 |
| Scope clarity | 1 |
| **Total** | **22** |
