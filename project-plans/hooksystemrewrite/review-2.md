# Hook System Rewrite Spec Review (review-2)

1. **Classification:** Factual error  
   **Location:** `usecaseexamples.md` → Status labels at top (`[Works Today]` definition) and recipes 1/2/3/8/15 marked `[After Rewrite Only]`  
   **Description:** The document claims BeforeTool blocking is not consumed today and requires the rewrite. That contradicts current source: `coreToolHookTriggers.ts` and `geminiChatHookTriggers.ts` are fire-and-forget (`Promise<void>`), so caller-level consumption is indeed missing; however recipe status text says “BeforeTool blocking hooks work because HookRunner processes outputs and rewritten callers will consume them,” which is internally contradictory (“works today” vs “rewritten callers will consume”). The status taxonomy is inconsistent with itself and with individual recipe labels.

2. **Classification:** Factual error  
   **Location:** `overview.md` → §5.2 LLM Response Format (`safetyRatings[].blocked`)  
   **Description:** The spec includes `blocked` in the stable response format example as if present in hook-visible payload. Actual translator (`hookTranslator.ts` `toHookLLMResponse`) drops `blocked` and only maps `category` and `probability` into hook data. So the example overstates what scripts receive.

3. **Classification:** Factual error  
   **Location:** `technical-overview.md` → §5.1 `executeToolWithHooks` step 10 (`ToolResult` gets `suppressDisplay?: boolean`)  
   **Description:** This is described as a design decision in the spec, but current `ToolResult` shape and current trigger implementation do not support this field. Since the document presents concrete behavior, it should be clearly marked as proposed/new-only. As written, it reads like existing-capability detail while no supporting code exists in the listed source files.

4. **Classification:** Factual error  
   **Location:** `technical-overview.md` → §3.1 Invariants (`getEventHandler()` / `getRegistry()` throw `HookSystemNotInitializedError`)  
   **Description:** The file presents an explicit new error type decision while also claiming existing infrastructure is “preserved as-is.” Existing codebase only has `HookRegistryNotInitializedError` in `hookRegistry.ts`; no `HookSystem` exists in source. This is not just “not implemented yet,” it is a type-contract claim that currently has no grounding in code and should be framed as proposal-only.

5. **Classification:** Consistency issue  
   **Location:** `overview.md` vs `technical-overview.md` vs `usecaseexamples.md` (status framing)  
   **Description:** `overview.md` and `technical-overview.md` consistently describe current behavior as fire-and-forget/non-consumed outputs. `usecaseexamples.md` top status note introduces contradictory wording that implies some BeforeTool behavior works today due to runner processing output. This creates cross-doc confusion about what “works today” means (script execution vs end-to-end effect).

6. **Classification:** Factual error  
   **Location:** `overview.md` → §6.2 Hook schema field table (`hooks[].type` “Must be "command"`)  
   **Description:** Source registry validator in `hookRegistry.ts` currently allows both `'command'` and `'plugin'` (`['command', 'plugin'].includes(config.type)`). Spec says only command is valid. That mismatches actual accepted config.

7. **Classification:** Technical concern  
   **Location:** `overview.md` → §7.1 “Zero overhead when disabled”  
   **Description:** Requirement says no hook infrastructure allocations on hot path when disabled/no matches. Current triggers always perform per-call checks and when enabled do per-call registry/planner/runner allocation (`coreToolHookTriggers.ts`, `geminiChatHookTriggers.ts`), violating intended perf properties. This is a valid rewrite objective, but doc currently mixes requirement language with implied current behavior in places; should more sharply separate “current fails this requirement” vs “target requirement.”

8. **Classification:** Factual error  
   **Location:** `usecaseexamples.md` → Recipe #10 Tool Filtering expected behavior (“hook replaces tool config”)  
   **Description:** In current code, `triggerBeforeToolSelectionHook` passes `llm_request: {} as never` and returns `Promise<void>`; no output is applied. The recipe does label as after-rewrite, but explanatory text still uses present-tense behavior in spots. Should be strictly future-tense to avoid implying any current enforcement.

9. **Classification:** Consistency issue  
   **Location:** `overview.md` §7.3 compatibility-field caveat vs `usecaseexamples.md` templates  
   **Description:** Overview warns block detection during OR-merge is reliable only with top-level `decision`, not compatibility-only `permissionDecision`. Cookbook templates consistently use top-level `decision` (good), but the docs never explicitly discourage compatibility-only output in cookbook guidance. Given the caveat, cookbook should include explicit “always set top-level decision” guidance.

10. **Classification:** Technical concern  
    **Location:** `technical-overview.md` → §11.1 Streaming interaction details (AfterModel timing)  
    **Description:** The spec correctly notes AfterModel runs post-stream and displayed content may already be visible. This creates a security/compliance blind spot for recipes like PII redaction (#4) that imply user-visible redaction “before response reaches user.” Docs should explicitly tie this limitation back to cookbook claims to avoid overpromising real-time redaction outcomes.

11. **Classification:** Use case gap  
    **Location:** `usecaseexamples.md` (overall cookbook scope)  
    **Description:** Cookbook lacks a realistic example for “hook timeout/slow dependency” handling and fallback behavior even though timeout/fail-open semantics are central in `hookRunner.ts` and highlighted in specs. A practical recipe demonstrating resilient external policy service outage (timeout + allow with warning) would cover a key real-world use case.

12. **Classification:** Use case gap  
    **Location:** `usecaseexamples.md` (overall cookbook scope)  
    **Description:** No recipe demonstrates multi-hook sequential chaining for `BeforeModel` with partial-overwrite pitfalls (shallow merge) and safe composition patterns. Given the design’s non-trivial merge semantics (`hookAggregator.ts` and `hookRunner.ts`), this is a missing high-value operational use case.

13. **Classification:** Use case gap  
    **Location:** `usecaseexamples.md` (overall cookbook scope)  
    **Description:** No cookbook example covers non-text/multimodal lossiness impact mitigation (e.g., avoiding hooks that rewrite full `llm_response` when tool calls are present). This is a common production pitfall directly implied by `hookTranslator.ts` behavior.

14. **Classification:** Completeness gap  
    **Location:** `technical-overview.md` → caller integration sections (§6.1/§6.2)  
    **Description:** The spec explains that callers should consume outputs but does not define exact mapping for `systemMessage` from hook outputs in either tool or model pipelines. `HookRunner` can emit `systemMessage` (including converted plain text), but there is no explicit end-to-end application contract in trigger/caller integration steps.

15. **Classification:** Completeness gap  
    **Location:** `overview.md` → §8 Decision summary table  
    **Description:** Table marks AfterTool “Can Modify Output? No,” while same section and §3.2 allow `suppressOutput` and `systemMessage` effects. Although not direct mutation of tool payload, these are output-surface modifications. Table wording is ambiguous and can be read as contradiction.

---

## Verification coverage performed

Compared claims against these source files:

- `packages/core/src/hooks/types.ts`
- `packages/core/src/hooks/hookRunner.ts`
- `packages/core/src/hooks/hookAggregator.ts`
- `packages/core/src/hooks/hookPlanner.ts`
- `packages/core/src/hooks/hookRegistry.ts`
- `packages/core/src/hooks/hookTranslator.ts`
- `packages/core/src/core/geminiChatHookTriggers.ts`
- `packages/core/src/core/coreToolHookTriggers.ts`

And these spec docs:

- `project-plans/hooksystemrewrite/overview.md`
- `project-plans/hooksystemrewrite/technical-overview.md`
- `project-plans/hooksystemrewrite/usecaseexamples.md`
