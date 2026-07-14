# Phase 0.5: Preflight Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P0.5`

## Purpose
Verify ALL assumptions the overview and this plan rest on BEFORE any implementation. Any mismatch STOPS and updates the plan. This gate MUST pass before Phase 01 (the first provisioning phase) and therefore before Phase 03 (the first production phase).

## Prerequisites
- Required: none — P0.5 is the FIRST executable phase in the sequence (0.5 → 0.6 → 01 … 33).
- Verification: `test -f project-plans/issue2349/overview.md && test -f project-plans/issue2349/specification.md && test -d project-plans/issue2349/analysis/pseudocode`
- Expected files from previous phase: none (first phase).
- Read `overview.md`, `specification.md`, `analysis/domain-model.md`, all `analysis/pseudocode/*.md`.

## Requirements Implemented (Expanded)

### REQ-PF-001: All load-bearing assumptions verified before implementation
**Full Text**: Every load-bearing assumption this plan depends on (provider neutrality, the neutral llm-types surface, the `toModelStreamChunk` provider-metadata gap, the synthetic fabricator + side-channels, the Google-shaped `clientContract.ts`, the 46/7/23/5 counts, runtime value imports, core block helpers, test/AST tooling, public-event usage paths, `ModelGenerationRequest` sufficiency, per-package mutation tooling, and the reserved gate script names) MUST be verified against FRESH command output, and any drift MUST update the affected phase files, BEFORE Phase 01/03 runs.
**Behavior**:
- GIVEN: the plan cites concrete current code facts (line ranges, symbol names, counts) that later phases mechanically act on.
- WHEN: an executor runs every command in the Implementation Tasks below and pastes the FRESH output into `.completed/P0.5.md`.
- THEN: each result either matches its EXPECTED-RESULT, or the drift is recorded AND the affected phase file's cited ranges/counts are updated IN PLACE before any production phase begins.
**Why This Matters**: 60%+ of plan-remediation work traces to unverified assumptions (missing deps, wrong types, impossible call paths, stale line numbers). This gate makes the whole downstream plan executable against the ACTUAL tree, not an assumed one.

### REQ-PF-002: The turn-request DTO decision is made before Phase 04
**Full Text**: The decision on whether `ModelGenerationRequest` is reused, extended, or replaced by a sibling `AgentGenerationRequest` for the turn-request DTO (REQ-001.3) MUST be made from fresh evidence of every `SendMessageParameters` call site and recorded before Phase 04 specifies the DTO.
**Behavior**:
- GIVEN: every current `SendMessageParameters` call site (message + generation options).
- WHEN: check 11 below inventories them and evaluates `ModelGenerationRequest` sufficiency.
- THEN: the reuse/extend/sibling decision is recorded in `.completed/P0.5.md` and reflected in `analysis/pseudocode/neutral-gap-types.md` lines 70-82 before Phase 04.
**Why This Matters**: P03-P05 concretely specify the neutral turn-request DTO; an undecided DTO shape would force rework across every turn-send call site.

## Implementation Tasks

> Each numbered task is a HARD gate. The executor MUST run the command(s) and paste FRESH output into `.completed/P0.5.md`. If the actual result differs from EXPECTED-RESULT, the plan is INVALID for that assumption — STOP, record the drift under "Blocking Issues Found", and update the affected phase file(s) BEFORE Phase 01/03.

### Task 1 — Provider call is neutral both directions
```bash
sed -n '70,85p' packages/core/src/runtime/contracts/RuntimeProvider.ts
```
- EXPECTED-RESULT: `generateChatCompletion(...)` returns `AsyncIterableIterator<IContent>` (both overloads), expected at RuntimeProvider.ts:77-84.
- ALSO: `RuntimeGenerateChatOptions.contents` is `IContent[]` (`packages/core/src/runtime/contracts/RuntimeProviderChat.ts:49-67`).
- The executor MUST run the command and paste FRESH output into `.completed/P0.5.md`. If the actual result differs from EXPECTED-RESULT, the plan is INVALID — STOP and update the affected phases.
- HARD preflight check (Additional Risk 4): the provider call MUST be confirmed neutral in both directions (`RuntimeProvider.ts:77-84`, `RuntimeProviderChat.ts:50`) — this is a load-bearing premise of the whole migration; if it is NOT neutral, the plan is invalid.

### Task 2 — Neutral llm-types surface exists (#2347 landed)
```bash
grep -n "ModelOutput\|ModelStreamChunk\|HookRestrictions\|toModelStreamChunk\|afcHistory\|providerMetadata" packages/core/src/llm-types/modelEnvelope.ts | head -30
ls packages/core/src/llm-types/{modelEnvelope.ts,modelRequest.ts,finishReasons.ts,jsonSchema.ts,toolDeclaration.ts,toolCall.ts,providerApiError.ts}
```
- EXPECTED-RESULT: `ModelOutput`/`ModelStreamChunk`/`HookRestrictions` (modelEnvelope.ts:41-70), `toModelStreamChunk` (modelEnvelope.ts:188), `ModelGenerationRequest`/`ModelGenerationSettings`/`ReasoningConfig` (modelRequest.ts), `CanonicalFinishReason`/`ToolDeclaration`/`ToolChoice`/`JsonSchema`/`ToolCallRequest`/`ProviderApiError`. `afcHistory` NOT yet present (it is the P05 gap add) — expected absent.
- Paste FRESH output into `.completed/P0.5.md`; any drift from EXPECTED-RESULT INVALIDATES the plan (STOP + update).

### Task 3 — `toModelStreamChunk` does NOT copy providerMetadata today (the OQ-16 gap)
```bash
sed -n '185,215p' packages/core/src/llm-types/modelEnvelope.ts
```
- EXPECTED-RESULT: maps `rawStopReason`/`finishReason`/`usage`/`responseId` but NOT `metadata.providerMetadata`. The `providerMetadata` slot exists on `ModelOutput` (line 58) but `toModelStreamChunk` does not populate it; the P05 extension closes this.
- HARD preflight check (Additional Risk 4): confirm `toModelStreamChunk` does NOT copy `metadata.providerMetadata` (modelEnvelope.ts:188-210). P05 depends on this gap being real.
- Paste FRESH output; drift INVALIDATES the plan.

### Task 4 — Synthetic-response fabricator + side-channels exist as described
```bash
sed -n '515,545p' packages/agents/src/core/MessageConverter.ts   # convertIContentToResponse {candidates:[{content:{role,parts}}]}
sed -n '1,56p'   packages/agents/src/core/providerStopReason.ts   # CandidateWithProviderStopReason + set/get
sed -n '1,40p'   packages/agents/src/core/hookToolRestrictions.ts # WeakMap<GenerateContentResponse|FunctionCall> + Symbols
ls packages/agents/src/core/streamChunkWrapper.ts
```
- EXPECTED-RESULT: convertIContentToResponse at :518-543; providerStopReason set/get present; hookToolRestrictions WeakMaps at :15-20 + Symbols; `streamChunkWrapper.ts` present.
- HARD preflight check (Additional Risk 4): confirm agents STILL fabricates the Google-shaped response (`MessageConverter.ts:518-540`) — the migration premise.
- Paste FRESH output; if line ranges/symbols drift, UPDATE the affected phase file lists before proceeding.

### Task 5 — `clientContract.ts` Google-shaped payload types + surface
```bash
sed -n '50,201p' packages/core/src/core/clientContract.ts
```
- EXPECTED-RESULT: `ContractPart`/`ContractContent`/`ContractContentUnion`/`ContractPartListUnion`/`ContractGenerateContentConfig`/`ContractGenerateContentResponse`/`ContractSendMessageParameters` payload types; `AgentClientContract`/`AgentChatContract` members typed in them.
- Paste FRESH output; drift INVALIDATES the plan.

### Task 6 — The 46 production importers + 7 toGeminiContents sites + counts
```bash
grep -rl "@google/genai" packages/agents/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | sort | wc -l   # expect 46
grep -rn "toGeminiContents\|toGeminiContent\b" packages/agents/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__"  # expect 7 toGeminiContents, 0 singular
grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/cli/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | sort | wc -l   # expect 23
grep -rlE "Contract(Content|Part|GenerateContentResponse|PartListUnion|SendMessageParameters|GenerateContentConfig|UsageMetadata|ContentUnion|PartUnion)" packages/core/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | grep -v "core/clientContract.ts" | sort | wc -l   # expect 5 (excludes the clientContract.ts definition file itself)
```
- EXPECTED: 46 agents prod importers; 7 `toGeminiContents` (G1-G7); 0 singular; 23 CLI `Contract*` consumers; 5 core consumers (the definition file `clientContract.ts` is excluded — see Appendix A.3 / P21 embedded list).
- If counts drift, UPDATE the affected phase's file list before proceeding (esp. the P21 embedded 23-CLI + 5-core inventory).

### Task 7 — Runtime `Type`/`FinishReason` value imports (not erasable)
```bash
grep -n "import.*Type" packages/agents/src/agents/executor-tool-dispatch.ts | head
sed -n '25,30p' packages/agents/src/core/subagentRuntimeSetup.ts
grep -rn "FinishReason.STOP\|FinishReason\." packages/agents/src/core/{MessageConverter,streamRequestHelpers,streamResponseHelpers}.ts
```
- EXPECTED: runtime `Type` value at executor-tool-dispatch.ts:19 + subagentRuntimeSetup.ts:25-30; runtime `FinishReason` value in the three files.

### Task 8 — core provides block-based helpers for googlePartHelpers replacement (OQ-6)
```bash
grep -rn "getToolCallBlocks\|getResponseTextFromBlocks" packages/core/src | head
```
- EXPECTED: core exposes block-based equivalents. If NOT, add a phase to create them before P16.

### Task 9 — Test infrastructure + fast-check + AST parser for the gate
```bash
grep "fast-check\|@fast-check" packages/agents/package.json
npm ls typescript ts-morph 2>/dev/null | head    # confirm a parser is available for the AST gate (P31)
grep -c "@google/genai" packages/agents/package.json   # expect present (removed at P32)
```
- EXPECTED: fast-check available; a TypeScript parser (compiler API always available via `typescript`; ts-morph optional) usable for the gate. If ts-morph is required and absent, add its install as a preceding step to P29.

### Task 10 — Public event shape + usage-metadata paths (RISK-1, §7A)
```bash
sed -n '221,252p' packages/core/src/core/turn.ts   # ServerUsageMetadataEvent (Gemini-named) + ServerFinishedEvent.usageMetadata (UsageStats)
sed -n '30,41p' packages/agents/src/api/event-types.ts
sed -n '260,325p' packages/agents/src/api/eventAdapter.ts   # confirm verbatim forward (no UsageStats->Gemini mapper today)
```
- EXPECTED: `ServerUsageMetadataEvent` core-owned + Gemini-named; `FinishedValue.usageMetadata` declared Gemini-named; adapter forwards verbatim (no mapper). Confirms REQ-007.1 characterization is needed and OQ-2u mapper must be WRITTEN.

### Task 11 — `ModelGenerationRequest` sufficiency for the turn request DTO (REQ-001.3 / REQ-PF-002, OQ-1)
```bash
sed -n '1,80p' packages/core/src/llm-types/modelRequest.ts   # ModelGenerationRequest fields (contents/settings/tools/abortSignal/modelParams/...)
grep -rn "SendMessageParameters" packages/agents/src --include=*.ts | grep -v -E "\.(test|spec)\." | head -40   # all call sites feeding the DTO
sed -n '95,135p' packages/agents/src/core/StreamProcessor.ts   # a representative SendMessageParameters call site (message + config)
# Enumerate EVERY Gemini config field the agents call sites actually pass (abortSignal + GenerateContentConfig members — OQ-18):
grep -rnE "config\?\.\w+|abortSignal|GenerateContentConfig|thinkingConfig|responseJsonSchema|responseMimeType|responseSchema|safetySettings|cachedContent" packages/agents/src/core/StreamProcessor.ts packages/agents/src/core/TurnProcessor.ts packages/agents/src/core/DirectMessageProcessor.ts | grep -v -E "\.(test|spec)\."
```
- EXPECTED-RESULT: every `SendMessageParameters` call site supplies (a) a message expressible as `AgentMessageInput` and (b) generation options expressible as `ModelGenerationSettings` — i.e. `ModelGenerationRequest` (`{ contents: IContent[]; settings?; tools?; abortSignal?; modelParams? }`) is SUFFICIENT, so `sendParamsToRequest` reuses/extends it with NO new top-level type. **Explicitly confirm each Gemini config field the agents pass has a neutral home (Additional Risk 2 round 8, OQ-18):** `abortSignal`→`ModelGenerationRequest.abortSignal`; tool declarations→`tools`/`ToolDeclaration`; `thinkingConfig`→`ReasoningConfig`; `responseJsonSchema`/`responseMimeType`→`ModelGenerationSettings`/`modelParams`; `responseSchema`/`safetySettings`/`cachedContent`→out of scope unless a call site actually passes them (this grep proves whether any do). If ANY call site needs a field with NO neutral slot on `ModelGenerationRequest`/`ModelGenerationSettings`, this is LOAD-BEARING: RECORD it here and either (i) add the neutral slot in P03-P05, or (ii) introduce the sibling `AgentGenerationRequest` — the decision MUST be made and P03-P05 updated BEFORE P04 writes the DTO tests, so no Gemini config field is left without a neutral home.
- Paste FRESH output; the decision (reuse vs extend vs sibling) MUST be recorded in `.completed/P0.5.md` and reflected in `analysis/pseudocode/neutral-gap-types.md` lines 70-82 before Phase 04 (REQ-PF-002).
- **C4 — `iContentFromBlocks` prerequisite:** the neutral block→IContent helper `iContentFromBlocks(blocks: ContentBlock[], speaker?): IContent` (neutral-gap-types.md lines 42-48, landed in P03-P05) depends only on `IContent`/`ContentBlock`/`IContent['speaker']` from `../services/history/IContent.js` — verify these are importable (they already back `iContentFromAgentMessageInput`). Confirm P07's `_processAfterModelHook` and P13's direct after-model path are the two consumers (`grep -rn "iContentFromBlocks" project-plans/issue2349/plan` ⇒ referenced by P07 + P13). No phantom helper name remains in the plan (`grep -rn "iContentFromBlocks" packages/` today ⇒ 0; it is CREATED in P05).

### Task 12 — Mutation tooling for EVERY package that will be mutation-tested (Major 1 + C3)
```bash
# agents already has Stryker (verified). Confirm it, and confirm CORE does NOT yet (P01 provisions it).
grep -nE '@stryker-mutator/(core|vitest-runner)' packages/agents/package.json   # expect BOTH present (^9.6.1)
grep -n '"test:mutation:api"' packages/agents/package.json                        # expect present
grep -nE '@stryker-mutator/(core|vitest-runner)' packages/core/package.json       # expect ABSENT (provisioned by P01)
test -f packages/core/stryker.conf.json && echo "core stryker present" || echo "core stryker ABSENT (P01 will add)"
ls packages/core/vitest.config.* 2>/dev/null                                       # confirm the vitest config filename P01's stryker.conf will reference
```
- EXPECTED-RESULT: `packages/agents` HAS `@stryker-mutator/core` + `@stryker-mutator/vitest-runner` (`^9.6.1`) and `test:mutation:api`; `packages/core` currently has NEITHER the devDeps NOR a `stryker.conf.json` — this is the C3 gap that **Phase 01** provisions BEFORE P05. Record the exact core `vitest.config.*` filename so P01's `stryker.conf.json` references the real file.
- Paste FRESH output. Every package whose NNa runs a mutation gate (core via P01+P05; agents via the migration slices) MUST have runnable tooling; if agents tooling is missing/renamed, UPDATE the affected phases.

### Task 13 — Reserve the EXACT root npm-script names for the two gates (Major 1)
```bash
# Confirm the planned gate script names do NOT already exist (no collision) and record their reserved slot.
grep -nE '"lint:agents-neutral-gate"|"lint:agents-neutral-test-gate"' package.json && echo "COLLISION — pick new names" || echo "names free (reserve them)"
grep -nE '"lint:cli-boundary"|"lint:agents-api-surface"' package.json   # the sibling scripts P31 patterns after (root package.json lines ~92-94)
grep -nE 'lint:cli-boundary|lint:agents-api-surface' .github/workflows/ci.yml   # the CI steps P31 adds alongside (ci.yml ~261/~275)
```
- EXPECTED-RESULT: neither `lint:agents-neutral-gate` nor `lint:agents-neutral-test-gate` exists yet (RESERVED for P31); the sibling scripts `lint:cli-boundary`/`lint:agents-api-surface` DO exist as the pattern to follow, and their CI steps live at `ci.yml` ~261/~275. Record the reserved names + exact edit locations so P31 wires them without discovering a collision late.
- Paste FRESH output; if either name already exists, choose a non-colliding name and update P31 + P33 references before Phase 03.

### Task 14 — Output-to-plan update STEP (Minor 2 — MANDATORY before marking P0.5 complete)
After running EVERY command above, compare each FRESH line number / count against the ranges cited in the phase files that consume them. For each drift:
1. UPDATE the affected phase file's site map / cited line ranges IN PLACE (e.g. `MessageConverter.ts:518-543`, `DirectMessageProcessor.ts:677-701`, `clientContract.ts:63-123`, `eventAdapter.ts:229-235`/`:317-323`, `executor-prompt-builder.ts:47-58`, the 46/7/23/5 counts, AND the P21-embedded 23-CLI + 5-core inventory) so no downstream phase acts on a stale number.
2. Record BOTH the old and new values in `.completed/P0.5.md` under "Line-number drift updates".
3. P0.5 CANNOT be marked complete while any consumed line range differs from fresh evidence without a corresponding phase-file update.
Each `NNa` verification (verification-template §2 line-number freshness) then compares its phase's cited ranges against this P0.5-captured evidence and FAILS the phase if it acted on a stale, un-refreshed line number.

### Task 15 — Behavior-area test-count BASELINE for the P28 preservation gate (Major 5)
Run EXACTLY the P28 behavior-area probe command set (identical commands, so the P0.5 baseline and the P28
post-migration comparison are directly comparable) and RECORD each integer in `.completed/P0.5.md` under a
clearly-labeled "P28 behavior-area baseline counts" block. P28 parses THESE recorded values and FAILS if the
baseline block is missing or any post-migration count drops below it.
```bash
# #2329 refusal/stop reason (Finished event):
grep -rlE "issue2329|directRefusal|stopReason|finishReason" packages/agents/src --include='*.test.ts' --include='*.spec.ts' | wc -l
# retry/abort/timeout ordering:
grep -rlE "retryBoundary|abort-timeout|idle-timeout|preRequestTimeout" packages/agents/src --include='*.test.ts' | wc -l
# history commit-once / thinking history:
grep -rlE "thinkingHistory|modelStamp|runtime\.history" packages/agents/src --include='*.test.ts' | wc -l
# hook events / tool restrictions:
grep -rlE "hook-events|tool-restrictions|hook-control" packages/agents/src --include='*.test.ts' | wc -l
# overflow/compression:
grep -rlE "overflow|compression" packages/agents/src --include='*.test.ts' | wc -l
```
- EXPECTED-RESULT: five integers (one per behavior-area). These are the PRE-migration baseline. There is no
  fixed expected value — the point is to CAPTURE and FREEZE them. Record all five verbatim in
  `.completed/P0.5.md` under the exact header `P28 behavior-area baseline counts` with one labeled line per
  area (e.g. `refusal-stop=<n>`, `retry-abort-timeout=<n>`, `history-thinking=<n>`, `hook-tool-restrictions=<n>`,
  `overflow-compression=<n>`).
- Paste FRESH output; P28 mechanically parses this block. If the block is absent when P28 runs, P28 FAILS
  (no invented baseline). The command set here MUST stay byte-identical to P28's probes.

## Verification Commands
```bash
# Every task command above MUST have been run and its FRESH output pasted into .completed/P0.5.md.
# Major 5: the P28 behavior-area baseline block MUST be present with all five labeled counts:
grep -qE "P28 behavior-area baseline counts" project-plans/issue2349/.completed/P0.5.md || echo "FAIL: P0.5 marker lacks the P28 behavior-area baseline block (task 15 / Major 5)"
for k in "refusal-stop" "retry-abort-timeout" "history-thinking" "hook-tool-restrictions" "overflow-compression"; do
  grep -qE "$k=[0-9]+" project-plans/issue2349/.completed/P0.5.md || echo "FAIL: P0.5 marker missing behavior-area baseline '$k=' (task 15)"
done
# This section re-asserts the marker is complete and every gate checkbox is checked.
test -f project-plans/issue2349/.completed/P0.5.md || echo "FAIL: P0.5 marker missing"
# The marker MUST contain actual command output, not prose restatements:
grep -qE "AsyncIterableIterator<IContent>|generateChatCompletion" project-plans/issue2349/.completed/P0.5.md || echo "FAIL: marker lacks pasted provider evidence (task 1)"
grep -qE "convertIContentToResponse|candidates" project-plans/issue2349/.completed/P0.5.md || echo "FAIL: marker lacks pasted fabricator evidence (task 4)"
# Counts recorded:
grep -qE "\b46\b" project-plans/issue2349/.completed/P0.5.md || echo "FAIL: marker lacks the 46-importer count (task 6)"
# Every Verification Gate checkbox below must be checked before P0.5 is complete.
```

## Blocking Issues Found
[Fill during execution. Any FAIL updates the plan before Phase 03. Record each drift under "Line-number drift updates" with old→new values.]

## Verification Gate
- [ ] 1 provider neutral both directions (HARD, Additional Risk 4)
- [ ] 2 neutral llm-types surface present
- [ ] 3 toModelStreamChunk providerMetadata gap confirmed (HARD, Additional Risk 4)
- [ ] 4 synthetic fabricator + side-channels confirmed; agents still fabricates (HARD, Additional Risk 4)
- [ ] 5 clientContract Google-shaped payload types confirmed
- [ ] 6 counts (46/7/23/5) match (or plan updated, incl. P21 embedded inventory)
- [ ] 7 runtime Type/FinishReason value imports located
- [ ] 8 core block helpers present (or phase added)
- [ ] 9 fast-check + AST parser available
- [ ] 10 public event + usage paths confirmed
- [ ] 11 `ModelGenerationRequest` sufficiency for the turn request DTO decided (reuse/extend/sibling — REQ-001.3 / REQ-PF-002)
- [ ] 12 mutation tooling confirmed for every mutation-tested package (agents present; core gap → P01 provisions it); core `vitest.config.*` filename recorded
- [ ] 13 root gate script names reserved (no collision) + P31 edit locations recorded
- [ ] 14 line-number drift → plan update completed (Minor 2)
- [ ] 15 P28 behavior-area baseline counts captured + recorded (5 labeled integers, Major 5)

IF ANY CHECKBOX IS UNCHECKED: STOP and update the plan.

## Success Criteria
- Every task (1-15) ran and its FRESH pasted output is in `.completed/P0.5.md` (not prose restatement).
- Task 15 recorded the P28 behavior-area baseline (5 labeled counts) using the byte-identical P28 probe commands (Major 5).
- Every EXPECTED-RESULT matched, or the drift was recorded AND the affected phase file(s) updated in place.
- The turn-request DTO decision (REQ-PF-002) is recorded and reflected in `neutral-gap-types.md` lines 70-82.
- All 15 Verification Gate checkboxes checked.
- The HARD preflight checks (Additional Risk 4) all confirmed: provider neutral, agents still fabricates, `toModelStreamChunk` does not copy providerMetadata.

## Failure Recovery
If this phase fails (any EXPECTED-RESULT mismatch, missing dependency, impossible call path, or un-updated drift):
1. Do NOT proceed to Phase 0.6/01/03. Record the exact failing task + its actual output under "Blocking Issues Found".
2. If a cited line range/count drifted: UPDATE the affected phase file(s) IN PLACE and record old→new in the marker (Task 14) before re-running.
3. If a HARD assumption is false (provider not neutral / agents not fabricating / `toModelStreamChunk` already copies providerMetadata): the plan premise is invalid — STOP and escalate for plan revision; do NOT silently proceed.
4. If a dependency/tooling gap is found (e.g. core Stryker absent — expected; ts-morph absent if required): confirm the provisioning phase (P01 for core Stryker; a pre-P29 step for ts-morph) covers it.
5. Re-run every task command and re-check all 15 gates before marking P0.5 complete.

## Phase Completion Marker
Create: `project-plans/issue2349/.completed/P0.5.md` containing the FRESH, PASTED output of EVERY command above (not a restatement of the EXPECTED-RESULT), plus the checklist state and any "Line-number drift updates" (old→new). The marker is INVALID if it contains only "confirmed"/"matches" prose without the actual command output. If ANY actual result differs from its EXPECTED-RESULT (including the counts 46/7/23/5 in task 6), the plan is INVALID: record the drift under "Blocking Issues Found" and update the affected phase file lists BEFORE Phase 01/03.
