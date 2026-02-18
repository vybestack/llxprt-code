# Hook System Rewrite Spec Review (review-1)

## Scope reviewed

I fully read the three spec docs:
1. `project-plans/hooksystemrewrite/overview.md`
2. `project-plans/hooksystemrewrite/technical-overview.md`
3. `project-plans/hooksystemrewrite/usecaseexamples.md`

I also read the current implementation and caller sites:
- `packages/core/src/hooks/types.ts`
- `packages/core/src/hooks/hookRunner.ts`
- `packages/core/src/hooks/hookAggregator.ts`
- `packages/core/src/hooks/hookTranslator.ts`
- `packages/core/src/hooks/hookRegistry.ts`
- `packages/core/src/hooks/hookPlanner.ts`
- `packages/core/src/core/geminiChatHookTriggers.ts`
- `packages/core/src/core/coreToolHookTriggers.ts`
- `packages/core/src/core/geminiChat.ts` (1300–1450)
- `packages/core/src/core/coreToolScheduler.ts` (1720–1800)

---

## Issues

### Issue 1
- **Classification**: Factual error
- **Location**: `overview.md` §6.3/§6.4 (configuration precedence and scope)
- **Description**: The overview says project/user/system/extension hook sources are merged and ordered. Current code in `HookRegistry.processHooksFromConfig()` only loads `config.getHooks()` and extension hooks; there is no explicit source-level ingestion for user/system hooks in registry logic. It tags `config.getHooks()` as `ConfigSource.Project`, which is misleading if `Config` already returns merged data. The spec presents source-level behavior as hook-system behavior, but source distinction is not actually preserved in runtime data and ordering semantics become ambiguous.

### Issue 2
- **Classification**: Factual error
- **Location**: `overview.md` §6.2 (schema), §7.9 (dedup)
- **Description**: Spec claims dedup is based on “same command appears in multiple sources, highest priority kept.” Implementation dedup in `HookPlanner.getHookKey()` uses only `command:${entry.config.command}` and does not include event, matcher, timeout, or source. This can deduplicate commands that should remain distinct (e.g., same command with different timeout or matcher under same event). The dedup semantics in spec are narrower than actual behavior.

### Issue 3
- **Classification**: Factual error
- **Location**: `overview.md` §3.1 (BeforeTool can modify tool input)
- **Description**: The overview describes input mutation support for BeforeTool via `hookSpecificOutput.tool_input`. Current `HookRunner.applyHookOutputToInput()` only applies chaining for `BeforeAgent` and `BeforeModel`; there is no BeforeTool input mutation path. In current codebase, BeforeTool scripts cannot alter tool input for subsequent hooks or caller execution.

### Issue 4
- **Classification**: Factual error
- **Location**: `overview.md` §3.2 (AfterTool can inject context/suppress output/system message)
- **Description**: Current callers (`coreToolScheduler.ts`) fire and forget AfterTool via `void triggerAfterToolHook(...)`, so none of these outputs are consumed. The spec presents these as active observable behavior “the model sees…”, but that is not true in current implementation.

### Issue 5
- **Classification**: Factual error
- **Location**: `overview.md` §3.3–§3.5, §8 decision table
- **Description**: Overview says BeforeModel/AfterModel/BeforeToolSelection modifications and blocking work. Current `geminiChat.ts` invokes all three trigger functions with `void`, so they are observational only. No request mutation, synthetic response, response mutation, or toolConfig restriction reaches provider call path.

### Issue 6
- **Classification**: Factual error
- **Location**: `overview.md` §4.2 (stdout semantics), §9 (error table)
- **Description**: Spec states “exit 0 + non-JSON stdout becomes systemMessage.” Runner does this conversion, but because callers ignore outputs, systemMessage is not surfaced. The spec conflates parser behavior with end-to-end visible behavior.

### Issue 7
- **Classification**: Consistency issue
- **Location**: `overview.md` §7.4 (sequential chaining)
- **Description**: It references “BeforeAgent additionalContext appended to prompt” despite `BeforeAgent` being explicitly out-of-scope in §10. This is an internal contradiction in document scope boundaries.

### Issue 8
- **Classification**: Technical concern
- **Location**: `overview.md` §7.3 (composition rules)
- **Description**: Claimed OR-decision merge for BeforeTool depends on `isBlockingDecision()`. Aggregator currently constructs `DefaultHookOutput` during OR merge, so compatibility fields (`hookSpecificOutput.permissionDecision`) are ignored there. Only final output is wrapped as `BeforeToolHookOutput`. This can miss blocking decisions encoded in compatibility fields in multi-hook aggregation.

### Issue 9
- **Classification**: Factual error
- **Location**: `technical-overview.md` §3.1 HookSystem API
- **Description**: Spec introduces `HookSystemNotInitializedError`, but no such class exists in current hooks code. Existing not-initialized error type is `HookRegistryNotInitializedError` in `hookRegistry.ts`.

### Issue 10
- **Classification**: Completeness gap
- **Location**: `technical-overview.md` §3.2 HookEventHandler construction of `transcript_path`
- **Description**: Spec fixes `transcript_path` to empty string placeholder but does not define migration path to real transcript location or whether this field is intentionally unsupported. This matters because many audit/compliance use cases depend on this field being meaningful.

### Issue 11
- **Classification**: Technical concern
- **Location**: `technical-overview.md` §5.1 `executeToolWithHooks` step 10
- **Description**: It says set suppression flag on `ToolResult` or signal caller. Current `ToolResult` shape (as used in scheduler) has no explicit suppression channel in shown code. Spec leaves integration-critical contract undefined, risking dead-end implementation.

### Issue 12
- **Classification**: Technical concern
- **Location**: `technical-overview.md` §5.2 BeforeToolSelection result application
- **Description**: Proposed `fireBeforeToolSelectionHook(config, llmRequest)` requires applying modifications to “currentToolConfig/currentTools”, but function signature omits those inputs and current trigger has only `_tools`. Without explicit source-of-truth parameters, apply logic can’t be deterministic.

### Issue 13
- **Classification**: Factual error
- **Location**: `technical-overview.md` §8 Message Bus integration
- **Description**: Spec treats bus integration as part of rewrite but current code has no hook-related bus types/subscriptions in reviewed files. This is not merely “future extension” in wording; file manifest marks `confirmation-bus/types.ts` as modify-if-included, which leaves ambiguity whether this is required or optional deliverable.

### Issue 14
- **Classification**: Consistency issue
- **Location**: `technical-overview.md` §3.2 empty result `success: true` vs §9 partial failures
- **Description**: Aggregator’s `success` currently becomes false when any hook execution fails. The spec repeatedly emphasizes fail-open and safe defaults but mixes “success semantics” inconsistently between empty fast path and real executions. This is likely to confuse telemetry/monitoring and test expectations.

### Issue 15
- **Classification**: Completeness gap
- **Location**: `technical-overview.md` §6 caller integration (`geminiChat.ts`)
- **Description**: It does not address streaming interaction timing precisely. Current `geminiChat.ts` streams chunks, accumulates `aggregatedText`, then builds `directResponse` from last content. Applying BeforeModel blocking/synthetic response in this flow needs explicit behavior for stream lifecycle, retries, and metrics hooks; spec leaves these side effects unspecified.

### Issue 16
- **Classification**: Technical concern
- **Location**: `technical-overview.md` §5.1 block behavior in `executeToolWithHooks`
- **Description**: It proposes returning blocked ToolResult to model, but scheduler currently has buffering/state transitions (`setStatusInternal`, `bufferResult`, `publishBufferedResults`) that distinguish execution success/cancel/error. Spec does not define required status mapping for blocked pre-execution tool calls.

### Issue 17
- **Classification**: Factual error
- **Location**: `usecaseexamples.md` “PII Redaction” expected behavior
- **Description**: Example claims redacted response is what user sees and transcript stores. Current runtime ignores AfterModel hook outputs (`void triggerAfterModelHook`), so this recipe does not actually work today.

### Issue 18
- **Classification**: Factual error
- **Location**: `usecaseexamples.md` “Tool Filtering (Read-Only Mode)”
- **Description**: Example relies on BeforeToolSelection changing available tools, but current trigger uses `llm_request: {} as never` and caller ignores output. Read-only enforcement is non-functional in current code.

### Issue 19
- **Classification**: Technical concern
- **Location**: `usecaseexamples.md` “Response Caching”
- **Description**: The recipe says cache key is message content only and ignores model config. This can return semantically stale or wrong responses across model/version/config changes (temperature, safety settings, tool config, system prompts). For production use this is unsafe unless explicitly constrained.

### Issue 20
- **Classification**: Use case gap
- **Location**: `usecaseexamples.md` overall cookbook
- **Description**: Examples heavily focus on shell scripts and jq but omit robust examples for malformed JSON, huge payload handling, unicode/binary content, and safe handling of non-text multimodal parts. Current translator intentionally drops non-text parts; cookbook should include caveats and patterns for that limitation.

### Issue 21
- **Classification**: Consistency issue
- **Location**: `usecaseexamples.md` minimal template “Always allow”
- **Description**: Template contains `cat` then `echo '{}'`; this writes original stdin to stdout before JSON, producing invalid mixed stdout and likely parse failure. It contradicts the protocol requirement of writing a single JSON object on stdout.

### Issue 22
- **Classification**: Technical concern
- **Location**: `overview.md` §5 stable LLM formats vs code translator behavior
- **Description**: Spec frames stable format as preserving request/response semantics, but translator currently strips non-text request/response parts and reconstructs text-only structures. This lossy transform can break tool-call/function-call rich scenarios if hooks modify and return LLM payloads.

### Issue 23
- **Classification**: Completeness gap
- **Location**: `technical-overview.md` §7 type flow
- **Description**: It assumes safe round-trip conversion via translator but does not document lossy cases (non-text parts, safety fields, metadata). Without explicit non-goals, implementers may assume fidelity guarantees that do not exist.

### Issue 24
- **Classification**: Technical concern
- **Location**: `overview.md` §7.2 fail-open and blocking semantics
- **Description**: Runtime currently marks exit code 2 as `success: false` (Runner success only for exit 0). Aggregator success semantics can therefore report event failure even on intentional policy block. This is semantically awkward and should be specified to avoid incorrect alerts/retries.

### Issue 25
- **Classification**: Use case gap
- **Location**: all three docs
- **Description**: No explicit multi-hook conflict examples for BeforeModel and BeforeToolSelection where two hooks produce incompatible modifications (e.g., one sets mode NONE, another injects allowed list; one rewrites model). Given composition is core to rewrite, concrete conflict-resolution scenarios are missing.

---

## High-priority remediation recommendations

1. Tighten specs to clearly separate **current behavior** vs **target rewrite behavior** (especially in overview and cookbook).
2. Normalize dedup and precedence semantics in docs to match planner/registry reality, or update implementation contract.
3. Explicitly document translator lossiness and non-text limitations.
4. Define concrete caller-state behavior for blocked/stopped tool calls in scheduler status/buffering model.
5. Fix cookbook templates/examples that violate protocol (`cat` + JSON mix) or claim currently non-functional outcomes without “post-rewrite” label.
