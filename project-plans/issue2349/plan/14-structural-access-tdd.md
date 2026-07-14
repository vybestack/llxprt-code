# Phase 14: Structural-access sites — TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P14`

## Prerequisites
- Required: Phase 13 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P13" packages/agents/src`
- Expected files from previous phase: `DirectMessageProcessor.ts`/`TurnProcessor.ts` (direct path → `ModelOutput`; `sendMessage` → `ModelOutput`); the `providerStopReason` WRITER removed (`grep -rn "setProviderStopReason" packages/agents/src | grep -v test` ⇒ empty — the `providerStopReason.ts` FILE itself survives with only its reader until the P25 co-located delete, C2); `convertIContentToResponse` chain gone (`grep -rn "convertIContentToResponse" packages/agents/src | grep -v test` ⇒ empty).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: TDD-ONLY phase — writes NO production code, so it implements NO pseudocode lines. It PINS the observable behavior that the P15 impl (which follows `stream-processor-neutral.md` consolidation lines + `messageconverter-neutralization.md`) must preserve; the concrete `@pseudocode lines X-Y` citations live in P15, not here. This phase's tests reference the §2A.4-II access/mutation inventory (overview) as the behavior catalog, not a pseudocode line map.

## Purpose
Pin observable behavior of the §2A.4-II structural-access sites (which READ/MUTATE `.parts`/`candidate.content`) before retyping them onto `ContentBlock[]`/`IContent`.

## Requirements Implemented (Expanded)

### REQ-005.1: ConversationManager text consolidation on blocks
**Full Text**: `ConversationManager` text consolidation (`appendTextContentParts`, `_consolidateModelOutput`, `hasTextContent`, `_recordOutputContent`) reimplemented on `ContentBlock[]`: consolidate adjacent `TextBlock`s at the SAME merge boundaries, thought-filter via `ThinkingBlock`, no `.parts` mutation.
**Behavior (adjacent-text merge, BR-7):**
- GIVEN: a model run producing two adjacent text outputs
- WHEN: the run is consolidated and committed to history
- THEN: the adjacent `TextBlock`s merge into one with IDENTICAL boundaries to today (observable via committed history text).
**Behavior (thought filtering, BR-5):**
- GIVEN: a model run containing a thought with include-in-context = false
- WHEN: the run is recorded
- THEN: the `ThinkingBlock` text is dropped from the committed history text but its signature is retained on the block.
**Why This Matters**: consolidation/thought-filter are the highest-risk `.parts` mutators; pinning them observably lets P15 move them to blocks without changing history.

### REQ-005.2: clientLlmUtilities stateless helpers on blocks
**Full Text**: `clientLlmUtilities` stateless helpers (`next_speaker` text extraction/fallback) read `TextBlock.text` on neutral `IContent[]` (OQ-3s).
**Behavior:**
- GIVEN: representative last-message content
- WHEN: the `next_speaker` helper runs
- THEN: it produces the SAME speaker decision + fallback as today, derived from `TextBlock.text` (not `.parts`).
**Why This Matters**: the stateless helper must keep its decision identical while its input becomes neutral.

### REQ-005.3: streamResponseHelpers accumulation on blocks
**Full Text**: `streamResponseHelpers` accumulation reads `ContentBlock[]`/`CanonicalFinishReason` from the neutral chunk (no `chunk.candidates`/`.parts`).
**Behavior:**
- GIVEN: a scripted neutral chunk stream
- WHEN: it is accumulated
- THEN: the recorded history + finish reason match today, derived from blocks (not `candidates`/`.parts`).
**Why This Matters**: the accumulator is where Google `Part[]` currency must die without changing recorded history/finish reason.

### REQ-005.4: MessageStreamOrchestrator pending-tool-call detection on blocks
**Full Text**: `MessageStreamOrchestrator` pending-tool-call detection derives from `ToolCallBlock` presence on the neutral last `IContent`.
**Behavior:**
- GIVEN: a last message with, and (separately) without, a tool call
- WHEN: pending-tool-call detection runs before IDE-context injection
- THEN: IDE-context injection fires IFF a `ToolCallBlock` is present (identical to today).
**Why This Matters**: detection must switch from `'functionCall' in part` to `ToolCallBlock` without changing when IDE context is injected.

### REQ-005.5: Full construction/access surface eliminated or bounded
**Full Text**: The full §2A.4-I construction surface and §2A.4-II access/mutation surface are eliminated or bounded (including `clientHelpers` compress-split detection + `client.stripThoughts`), on `ContentBlock[]`/`IContent`, never `.parts`/`candidate.content`/`{role,parts}`/`{candidates}`.
**Behavior (compress-split):**
- GIVEN: a history requiring a compression split
- WHEN: the split point is chosen
- THEN: it is the SAME function-response boundary as today, computed on blocks (`ToolResponseBlock`), not `.parts`.
**Behavior (stripThoughts):**
- GIVEN: history containing thought signatures
- WHEN: `client.stripThoughts` runs
- THEN: thought text is dropped but the signature is retained, computed on `ContentBlock[]` (no `.parts` map/delete).
**Why This Matters**: these are the remaining `.parts` readers/mutators; pinning them observably de-risks the P15 block migration.

## Implementation Tasks (test-writing; behavioral; safety net for P15)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P14`, `@requirement:REQ-005.1`, `@requirement:REQ-005.2`, `@requirement:REQ-005.3`, `@requirement:REQ-005.4`, `@requirement:REQ-005.5`

### Assertions (observable) — each maps to its REQ marker
- **REQ-005.1** Adjacent text consolidation: two adjacent model text outputs → single merged text in recorded history (same boundaries as today); thought filtering excludes thoughts from recorded history text when config off, signature retained on the ThinkingBlock (BR-5).
- **REQ-005.2** `next_speaker` helper (clientLlmUtilities): text extraction + fallback detection produce same decision as today for representative inputs.
- **REQ-005.3** streamResponseHelpers accumulation: recorded history + finish reason match today for a scripted neutral chunk stream.
- **REQ-005.4** MessageStreamOrchestrator: pending-tool-call detection triggers IDE-context injection when last message has a tool call (ToolCallBlock), not otherwise.
- **REQ-005.5** clientHelpers compress-split: split point chosen at the same function-response boundary; `client.stripThoughts` drops thought text but keeps signature.
- PROPERTY: for ANY run of adjacent TextBlocks, consolidation yields one TextBlock whose text === concatenation.

## Forbidden
- NO assertions on `.parts`/`candidate.content`.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts   # PASS against current
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts   # aggregate >=30%
```

## Success Criteria
- Consolidation (BR-7), thought-filter (BR-5), next_speaker, pending-tool-call, and compress-split each covered by observable assertions — never `.parts`/`candidate.content`.
- ≥30% property-based; tests PASS against current code (safety net for P15).

## Failure Recovery
1. If a test asserts `.parts`/`candidate.content`: rewrite to observable behavior (consolidated text / decision / injection outcome).
2. If a test does not pass against current code: fix it to reflect ACTUAL behavior.
3. `git checkout --` the test file and re-author. Cannot proceed to Phase 15 until green + behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P14.md`.
