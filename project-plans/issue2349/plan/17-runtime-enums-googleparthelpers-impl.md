# Phase 17: Runtime enum/value replacements + googlePartHelpers neutralization — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P17`

## Prerequisites
- Required: Phase 16 completed (RED tests for tool-schema + block-helper behavior are failing against current parts-based code).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P16" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/**/__tests__/runtimeEnums.*.test.ts` + `googlePartHelpers.*.test.ts` (tool-schema structure + block-helper output tests, currently failing).
- Preflight verification: Phase 0.5 completed — check 8 (core block helpers) PASS.
- Pseudocode: `messageconverter-neutralization.md` lines 20-29 (block-based validator/leading-text/user-input helpers: `createUserContentFromInput` 20-22, `isValidIContent` 23-24, `extractCuratedHistoryNeutral` 25-27, `hasLeadingText` 28-29) — the concrete governing range for the block-based helper migration + the helper table below. Runtime-value swaps are mechanical value substitutions (no pseudocode function; see Required Code Markers).

## Requirements Implemented (Expanded)

### REQ-006.1: Runtime Type enum replaced
**Full Text**: Runtime `Type` enum (`executor-tool-dispatch.ts:19`, `subagentRuntimeSetup.ts:25-30`) replaced with JSON-schema string literals / `JsonSchema`. NOT an erasable type-only swap (`Type` is a runtime value binding).
**Behavior**:
- GIVEN: a subagent/executor builds a tool schema
- WHEN: it runs
- THEN: the schema is produced from neutral JSON-schema literals (`Type.STRING`→`'string'`, etc.) with identical structure; no external consumer depends on Gemini uppercase enum strings (OQ-7 verified in preflight).
**Why This Matters**: removes a runtime `@google/genai` value import that a pure retype cannot erase.

### REQ-006.2: Runtime FinishReason replaced
**Full Text**: Runtime `FinishReason` (`MessageConverter`, `streamRequestHelpers:20`, `streamResponseHelpers:17`) replaced with `CanonicalFinishReason`.
**Behavior**:
- GIVEN: a stream/finish path
- WHEN: a finish reason is set/compared
- THEN: it uses `CanonicalFinishReason` values, not the runtime `FinishReason` enum.
**Why This Matters**: removes the last runtime `FinishReason.*` value uses (most removed in P08/P13/P15; residual here).

### REQ-006.3: ApiError value replaced
**Full Text**: `ApiError` value → `isProviderApiError`/`ProviderApiError`.
**Behavior**:
- GIVEN: error handling in `schemaDepthErrorEnrichment.ts`/`DirectMessageProcessor.ts`/`TurnProcessor.ts`
- WHEN: an API error is inspected
- THEN: it uses `isProviderApiError`/`ProviderApiError`, not `instanceof ApiError`/`new ApiError`.
**Why This Matters**: removes a runtime `@google/genai` class value.

### REQ-006.4: createUserContent replaced
**Full Text**: `createUserContent` → neutral builder (finished here if any residual remains after P09).
**Behavior**:
- GIVEN: user-message construction
- WHEN: needed
- THEN: a neutral `IContent{speaker:'human'}` builder is used, never `createUserContent`.
**Why This Matters**: removes the last runtime `createUserContent` value import.

### REQ-011.1: googlePartHelpers neutralized
**Full Text**: `googlePartHelpers.ts` renamed/retyped onto `ContentBlock[]`/`ToolCallBlock` using core block equivalents (`getToolCallBlocks`/`getResponseTextFromBlocks`/`analyzeResponseOutcome`) — OQ-6; no `Part`/`FunctionCall`/`GenerateContentResponseUsageMetadata`. `ResponseOutcome` STAYS core-owned. Verify core equivalents exist before removal.
**Behavior**:
- GIVEN: each old parts-based helper
- WHEN: a caller invokes the neutral replacement on `ContentBlock[]`
- THEN: the observable result (tool calls found, visible text, outcome flags, thought filtering) is identical to today's parts-based result.
**Why This Matters**: overview OQ-6; the file is the last NEUTRALIZE-IN-PLACE mechanism carrying the Gemini `Part` shape.

## Helper-by-helper migration table (M5 — verified against real code)

`ResponseOutcome` STAYS **core-owned** (`packages/core/src/utils/generateContentResponseUtilities.ts:31`); agents consume it, do not re-declare it. Core block equivalents VERIFIED present: `analyzeResponseOutcome(blocks)` (`:44`), `getResponseTextFromBlocks(blocks)` (`:75`), `getToolCallBlocks(blocks)` (`:92`). There is NO dedicated exported thought predicate in core — the neutral equivalent is the inline `block.type === 'thinking'` test on `ContentBlock` (or the existing block-based predicate in `chatSession-thinking-helpers.ts:46`).

| Old symbol (`googlePartHelpers.ts`) | All production call sites (verified) | New neutral symbol / disposition | Expected behavior | Test (@requirement) |
|---|---|---|---|---|
| `isThoughtPart(part)` (`:38`) | `TurnProcessor.ts:799`, `ConversationManager.ts:275,283`, `streamResponseHelpers.ts:136`, `MessageConverter.ts:421`; parallel local copy `chatSession-thinking-helpers.ts:46` (already block/`unknown`-based) | Replace with `block.type === 'thinking'` on `ContentBlock` (drop the `Part`-based predicate); consolidate on the `chatSession-thinking-helpers` block predicate where a named helper is wanted. | A `ThinkingBlock` is a thought; `TextBlock`/`ToolCallBlock` are not; thought-filtering drops thinking from recorded history text while retaining signature (BR-5). | `@requirement:REQ-011.1` |
| `getFunctionCallsFromParts(parts)` (`:54`) | `subagentNonInteractive.ts:148`, `hookToolRestrictions.ts:172,174,290`, `turn.ts:372`, `executor-stream-processor.ts:206` | `getToolCallBlocks(blocks)` (core `:92`) → `ToolCallBlock[]`; map to `ToolCallRequest` where a request shape is needed. (`hookToolRestrictions` sites migrate in P11; residual here.) | Same tool calls (name/args/id), in order. | `@requirement:REQ-011.1` |
| `getResponseTextFromParts(parts)` (`:71`) | `DirectMessageProcessor.ts:896` (dies P13), `MessageConverter.ts:533` (dies P13) | `getResponseTextFromBlocks(blocks)` (core `:75`); residual readers use the core block function. | Concatenated non-empty `TextBlock` text; `undefined` when none. | `@requirement:REQ-011.1` |
| `analyzeResponseOutcomeFromParts(parts)` (`:90`) | `streamResponseHelpers.ts:126` | `analyzeResponseOutcome(blocks)` (core `:44`) → core-owned `ResponseOutcome`. | Same outcome flags (`hasVisibleText`/`hasThinking`/`hasToolCalls`/`isActionable`). | `@requirement:REQ-011.1` |
| `type UsageMetadataWithCache` (`:25`) | `TurnProcessor.ts:47,845`, `MessageConverter.ts:31,651` (dies P13), `streamChunkWrapper.ts` (usage-mapping stops P08; FILE DELETED P25, C2) | Replace with neutral `UsageStats` (+ `cachedContentTokenCount` in `UsageStats`/`ModelOutput.usage`); DELETE the alias. | Cache/usage ride neutral `UsageStats`. | `@requirement:REQ-011.1`/`REQ-007.*` |
| `type ThoughtPart` (`:31`) | `MessageConverter.ts:29,494` (dies P13) | Replace with `ThinkingBlock`; DELETE the `Part`-based alias (keep the block/`unknown`-based `chatSession-thinking-helpers.ts:33` one, renamed neutral). | Thinking + signature ride `ThinkingBlock`. | `@requirement:REQ-011.1` |

After migration, `googlePartHelpers.ts` is RENAMED away from "google" to the EXACT new path `packages/agents/src/core/contentBlockHelpers.ts` (Minor 1 — decided: RENAME, not keep) OR its remaining exports are folded into core block utilities (in which case the file is DELETED, not renamed). This phase takes the RENAME option: `git mv packages/agents/src/core/googlePartHelpers.ts packages/agents/src/core/contentBlockHelpers.ts` and update every import specifier to the new path. The old path MUST NOT exist after this phase, and ZERO `@google/genai` imports remain in the renamed file.

## Implementation Tasks (MODIFY — make ALL P16 tests pass)
- `agents/executor-tool-dispatch.ts`, `core/subagentRuntimeSetup.ts`: runtime `Type` → JSON-schema string literals / `JsonSchema`.
- `core/MessageConverter.ts`, `core/streamRequestHelpers.ts`, `core/streamResponseHelpers.ts`: residual runtime `FinishReason` → `CanonicalFinishReason`.
- `core/schemaDepthErrorEnrichment.ts`, `core/DirectMessageProcessor.ts`, `core/TurnProcessor.ts`: residual `ApiError` → `isProviderApiError`.
- `core/googlePartHelpers.ts` → NEUTRALIZE per the table; use core block helpers; RENAME to `core/contentBlockHelpers.ts` (Minor 1 — exact new path) via `git mv`, and update all import specifiers to the new path.

### Required Code Markers
The block-based validator/leading-text/user-input helper migration is governed by `messageconverter-neutralization.md` lines 20-29 (`createUserContentFromInput` 20-22, `isValidIContent` 23-24, `extractCuratedHistoryNeutral` 25-27, `hasLeadingText` 28-29 — the block-based survivors that replace `.parts`/`.role` reads). The `googlePartHelpers` block-helper migration reuses those SAME block-based validity/text/tool-call semantics, so it cites that concrete range. EVERY touched function MUST carry the marker block with its SPECIFIC concrete `@pseudocode` line range — NO literal `<...>` placeholder:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P17
 * @requirement:REQ-011.1
 * @pseudocode lines 23-29   // messageconverter-neutralization.md — block-based validator/leading-text helpers (per-function: isValidIContent 23-24, hasLeadingText 28-29)
 */
```
- `googlePartHelpers` neutralized helpers → `@requirement:REQ-011.1` + concrete `@pseudocode` lines from `messageconverter-neutralization.md`:
  - `getResponseTextFromParts`→`getResponseTextFromBlocks` reader (visible-text extraction) → `@pseudocode lines 28-29` (block-based leading/visible-text helper `hasLeadingText`, the governing block-text semantics).
  - `isThoughtPart`→`block.type === 'thinking'` test → `@pseudocode lines 23-24` (block-based validity/predicate semantics `isValidIContent`).
  - `getFunctionCallsFromParts`→`getToolCallBlocks` and `analyzeResponseOutcomeFromParts`→`analyzeResponseOutcome`: these delegate to EXISTING core block utilities (`generateContentResponseUtilities.ts:44/:75/:92`), not a MessageConverter pseudocode function. They carry `@plan`/`@requirement:REQ-011.1` + a note `// delegates to core block utility (getToolCallBlocks/analyzeResponseOutcome) — mechanical helper substitution, no dedicated pseudocode function` (the accepted no-pseudocode-function rule below).
- **Runtime-value replacements (`Type`→JSON-schema literals, `FinishReason`→`CanonicalFinishReason`, `ApiError`→`isProviderApiError`, residual `createUserContent`→neutral builder) are MECHANICAL VALUE SUBSTITUTIONS with NO dedicated pseudocode function.** Each carries `@plan:PLAN-20260707-AGENTNEUTRAL.P17` + `@requirement:REQ-006.1/.2/.3/.4` + the exact note `// mechanical value substitution (runtime enum/class → neutral value); no pseudocode function`. This is the explicit no-pseudocode-function rule ACCEPTED by P0.6 check E: P0.6 requires each mapped impl phase to CONTAIN at least one `@pseudocode` citation (satisfied by the `googlePartHelpers` helpers citing lines 23-29 above) — it does NOT require every function to map to a pseudocode line, so a mechanical value substitution annotated with this note is compliant and is NOT flagged.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P17`, `@requirement:REQ-006.1/.2/.3/.4/REQ-011.1`, plus the per-function `@pseudocode lines X-Y` (or the mechanical-substitution note) above.

## Verification Commands
```bash
# Minor 1 — the file is RENAMED: the old path must NOT exist; the new path must exist with ZERO @google/genai.
test ! -f packages/agents/src/core/googlePartHelpers.ts   # OLD path gone (renamed)
test -f packages/agents/src/core/contentBlockHelpers.ts    # NEW neutral path exists
if grep -rn "from '@google/genai'" packages/agents/src/agents/executor-tool-dispatch.ts packages/agents/src/core/subagentRuntimeSetup.ts packages/agents/src/core/contentBlockHelpers.ts; then echo "FAIL: residual @google/genai import in a P17-migrated file"; exit 1; fi
if grep -rn "googlePartHelpers" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: googlePartHelpers specifier not updated to contentBlockHelpers"; exit 1; fi
if grep -rnE "Type\.|FinishReason\.|new ApiError|: ApiError" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: runtime Google enum/class value remains in agents production"; exit 1; fi
npm test -- packages/agents/src/core/__tests__/toolSchema.characterization.test.ts   # green (was RED in P16)
npm run typecheck && npm run build   # green cross-package
```

## Success Criteria
- Zero runtime Google enum/class values in agents prod; the renamed `contentBlockHelpers.ts` (formerly `googlePartHelpers.ts`, Minor 1) is block-based per the table with ZERO `@google/genai` and the OLD path no longer exists (`test ! -f .../googlePartHelpers.ts`); all import specifiers point to the new path; `ResponseOutcome` still core-owned; NO literal `<...>` `@pseudocode` placeholder remains (Major 1 — concrete lines 23-29 cited; runtime-value swaps annotated as mechanical no-pseudocode substitutions); P16 tests green; mutation gate ≥80% on the changed helper file `contentBlockHelpers.ts` (verification-template §8).

## Failure Recovery
If this phase fails (P16 tests stay red/green-against-stub, build breaks, or a residual runtime Google value remains):
1. `git checkout -- packages/agents/src/agents/executor-tool-dispatch.ts packages/agents/src/core/subagentRuntimeSetup.ts packages/agents/src/core/schemaDepthErrorEnrichment.ts` and any other touched file; if the RENAME (`git mv googlePartHelpers.ts → contentBlockHelpers.ts`) was applied, revert it with `git mv packages/agents/src/core/contentBlockHelpers.ts packages/agents/src/core/googlePartHelpers.ts` (or `git checkout -- packages/agents/src/core/googlePartHelpers.ts` after resetting the rename) and restore the original import specifiers.
2. Re-apply per the helper table; do NOT edit P16 tests to pass.
3. Cannot proceed to Phase 18 until P16 tests pass and no runtime Google value remains.

## Phase Completion Marker
`project-plans/issue2349/.completed/P17.md`.
