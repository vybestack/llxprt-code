# Phase 16: Runtime enum/value + googlePartHelpers — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P16`

## Prerequisites
- Required: Phase 15 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P15" packages/agents/src`
- Expected files from previous phase: `ConversationManager.ts`/`streamResponseHelpers.ts`/`clientLlmUtilities.ts`/`MessageStreamOrchestrator.ts`/`clientHelpers.ts`/`client.ts` (§2A.4-II access sites on `ContentBlock[]`); `isValidResponse` DELETED. NOTE (Major 3): G1/G2 `toGeminiContents` are NOT gone after P15 — the `getHistory`-boundary conversions + return-type flip are deferred to P21; `client.ts`/`ConversationManager.ts` still carry the single `getHistory` boundary `toGeminiContents` call here.
- Preflight verification: Phase 0.5 completed — check 8 (core block helpers `analyzeResponseOutcome`/`getResponseTextFromBlocks`/`getToolCallBlocks` present) PASS; preflight OQ-7 (no external dependence on Gemini uppercase enum strings) PASS.

## Purpose (C5 split — TWO test categories, precisely labeled)
This is a MIXED test phase for the runtime-value replacements. It contains **two explicitly distinct
categories** (do NOT call the whole phase "RED"):

- **(a) CHARACTERIZATION tests — EXPECTED TO PASS NOW and stay GREEN through P17.** The runtime `Type`
  enum already serializes to the same neutral JSON-schema string values (`Type.OBJECT` → `'object'`,
  etc.), so the tool-schema structure test PINS the CURRENT observable output. It is a
  behavior-preservation net (correct for a migration): it passes now and P17 must keep it identical.
  It is NOT a RED test and MUST NOT be written to fail.
- **(b) TRUE RED tests — EXPECTED TO FAIL NOW (fail NATURALLY) until P17.** The neutral block-helper
  API (`getToolCallBlocks`/`getResponseTextFromBlocks`/`analyzeResponseOutcome` agents wrappers over
  `ContentBlock[]`) does not exist yet, so those tests fail with a genuinely-missing-API failure until
  P17 implements them.

Both categories are behavior-bearing (the `Type` swap and the parts→blocks neutralization are NOT
erasable type-only swaps), which is why they get a preceding test phase before P17. The characterization
tests prevent silent behavior change; the RED tests drive the missing neutral helper API.

## Requirements Implemented (Expanded)

### REQ-006.1: Runtime Type enum replaced (tool-schema structure preserved)
**Full Text**: Runtime `Type` enum (`executor-tool-dispatch.ts:19`, `subagentRuntimeSetup.ts:25-30`) replaced with JSON-schema string literals / `JsonSchema` with identical produced structure.
**Behavior**:
- GIVEN: an executor/subagent tool declaration built today via `Type.OBJECT`/`Type.STRING`/`Type.ARRAY`
- WHEN: the same declaration is built after the swap to `'object'`/`'string'`/`'array'`
- THEN: the emitted JSON-schema structure is byte-identical (same keys, same nested types).
**Why This Matters**: the enum values are load-bearing at runtime; a wrong literal mapping silently corrupts tool schemas.

### REQ-011.1: googlePartHelpers neutralized (identical observable outputs)
**Full Text**: `googlePartHelpers.ts` helpers migrate onto `ContentBlock[]`/`ToolCallBlock` via core block equivalents with identical observable results; `ResponseOutcome` stays core-owned.
**Behavior**:
- GIVEN: representative content (mixed text/thinking/tool-call)
- WHEN: the neutral block helper runs vs. the old parts helper
- THEN: tool-calls found, visible text, outcome flags, and thought-filtering are identical.
**Why This Matters**: proves the parts→blocks migration is behavior-preserving before P17 deletes the parts helpers.

## Implementation Tasks (write the tests; TWO categories — see Purpose)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/toolSchema.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P16`, `@requirement:REQ-006.1`
  — **CATEGORY (a) CHARACTERIZATION: EXPECTED TO PASS NOW** (pins current tool-schema structure).
- `packages/agents/src/core/__tests__/blockHelpers.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P16`, `@requirement:REQ-011.1`
  — **CATEGORY (b) TRUE RED: EXPECTED TO FAIL NOW** (neutral block-helper agents API absent until P17).

### Assertions (observable)
- **Tool schema — CATEGORY (a), CHARACTERIZATION, PASSES NOW:** build a representative executor tool declaration and a subagent tool declaration; snapshot the produced JSON-schema structure and assert the CURRENT observable output (`type: 'object'`/`'string'`/`'array'`). Because `Type.OBJECT` already serializes to `'object'`, this test PASSES today and characterizes the structure P17 MUST preserve byte-for-byte. It is a behavior-preservation net, NOT a RED test — do NOT write it to fail. (If a future provider ever changed the enum serialization, this test would catch the regression; that is its purpose.)
- **Block helpers — CATEGORY (b), TRUE RED, FAILS NOW (write against the PLANNED neutral API):** call the neutral `getToolCallBlocks(blocks)`/`getResponseTextFromBlocks(blocks)`/`analyzeResponseOutcome(blocks)` equivalents on `ContentBlock[]` fixtures and assert the same results the current `getFunctionCallsFromParts`/`getResponseTextFromParts`/`analyzeResponseOutcomeFromParts` produce for the equivalent parts. These FAIL NATURALLY now because the agents block-based wrappers do not exist yet (genuinely-missing API), and go green at P17.
- **Thought filtering:** a `ThinkingBlock` is recognized as a thought and filtered from recorded history text while retaining signature (BR-5); `TextBlock`/`ToolCallBlock` are not.
- PROPERTY: for ANY `ContentBlock[]`, `getResponseTextFromBlocks(blocks)` equals the concatenation of non-empty `TextBlock` texts (undefined if none).
- PROPERTY: for ANY `ContentBlock[]`, `getToolCallBlocks(blocks)` yields exactly the `ToolCallBlock`s in order.

## Forbidden
- NO assertions on `Part[]`/`{functionCall}`/`.parts` internals of the OLD helpers (those are being deleted).
- NO reverse testing / mock theater / structure-only assertions.

## Verification Commands
```bash
# CATEGORY (a) CHARACTERIZATION — MUST PASS NOW (tool-schema structure pinned; stays green through P17):
npm test -- packages/agents/src/core/__tests__/toolSchema.characterization.test.ts   # GREEN now

# CATEGORY (b) TRUE RED — MUST FAIL NATURALLY NOW (neutral block-helper agents API absent until P17):
npm test -- packages/agents/src/core/__tests__/blockHelpers.characterization.test.ts   # FAILS naturally (missing API), not "structure-only pass"

# Property ratio computed over ALL test files this phase creates (C4), aggregate ≥30%:
prop_ratio \
  packages/agents/src/core/__tests__/toolSchema.characterization.test.ts \
  packages/agents/src/core/__tests__/blockHelpers.characterization.test.ts
```

## Success Criteria
- **Category (a)** `toolSchema.characterization.test.ts` PASSES NOW (pins the current tool-schema structure; is a green behavior-preservation net, correctly NOT labeled RED) and P17 must keep it green.
- **Category (b)** `blockHelpers.characterization.test.ts` FAILS NATURALLY now against the missing neutral agents block-helper API (genuinely-missing API, not a value mismatch), and goes green at P17.
- Aggregate ≥30% property-based across BOTH files (via `prop_ratio`); BR-5 covered.
- No reverse testing / mock theater / structure-only assertions.

## Failure Recovery
If this phase fails (category (a) does not pass now, category (b) does not fail naturally, coverage short, or a forbidden pattern present):
1. `git checkout -- packages/agents/src/core/__tests__/toolSchema.characterization.test.ts packages/agents/src/core/__tests__/blockHelpers.characterization.test.ts`
2. Re-author: (a) as a green characterization pin of the current structure; (b) behaviorally against the planned neutral helper API (do NOT assert old parts internals; do NOT weaken (b) to pass).
3. Cannot proceed to Phase 17 until (a) passes, (b) fails naturally, and the checklist is satisfied.

## Phase Completion Marker
`project-plans/issue2349/.completed/P16.md`.
