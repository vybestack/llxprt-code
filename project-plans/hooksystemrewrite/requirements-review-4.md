# Requirements Review Round 4 — Combined (typescriptexpert + deepthinker)

5 + 7 = 12 raw issues. Deduplicated to 8 unique findings (4 are repeats of previously addressed items).

## Previously Addressed (skip — already handled in R2/R3)
- DT#1 (plugin [Target]) — addressed R2-07, HOOK-083 clarified
- DT#2 (config path mismatch) — addressed R3-01, erratum note added
- DT#6 (allocation testability) — addressed R2-35/R3-11, reworded to observables

---

## R4-01: HOOK-149 missing [Target] — `suppressDisplay` doesn't exist on ToolResult
Add [Target] marker. Same pattern as HOOK-029/HOOK-132.

## R4-02: HOOK-067b and HOOK-197 are near-duplicates (exit-code-2 empty-stderr)
Merge HOOK-197 into HOOK-067b.

## R4-03: HOOK-104 omits `success` precondition for sequential chaining
Source: `if (result.success && result.output)`. Requirement says "each hook's output" without the success guard. Fix: add "and a hook succeeds (exit code 0)" precondition.

## R4-04: HOOK-006 self-contradicts on ownership vs "internal to"
HookSystem owns instances, injects into HookEventHandler. "Internal to HookEventHandler" is misleading. Reword to "injected into HookEventHandler by HookSystem."

## R4-05: No requirement for HookEventHandler base field sourcing from Config
Add requirement: session_id from config.getSessionId(), cwd from config.getWorkingDir(), timestamp from Date.toISOString(), transcript_path as ''.

## R4-06: Sequential BeforeTool merge semantics unspecified
Requirements mark [Target] for tool_input merge but don't specify merge strategy (shallow replace vs deep merge, cumulative vs last-wins). Add explicit requirement.

## R4-07: Some [Target] markers on already-implemented fail-open behavior
Check if any [Target]-marked requirements describe behavior already working in hookRunner.ts (fail-open, timeout, crash handling). Remove [Target] where source already satisfies.

## R4-08: AfterTool/AfterModel systemMessage/suppressOutput integration contract boundaries
Requirements describe effects but don't pin which interface boundary carries them (ToolResult fields vs conversation state vs UI). Add explicit contract.

---

## Summary: 8 actionable findings

| Category | Count |
|---|---|
| [Target] marker | 2 (R4-01, R4-07) |
| Redundancy | 1 (R4-02) |
| Completeness gap | 3 (R4-05, R4-06, R4-08) |
| Factual/consistency | 2 (R4-03, R4-04) |
| **Total** | **8** |
