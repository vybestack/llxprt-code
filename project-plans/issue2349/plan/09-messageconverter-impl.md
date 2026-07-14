# Phase 09: MessageConverter neutralization — IMPL (retype survivors; defer synthetic-fabricator deletion to P13)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P09`

## Prerequisites
- Required: Phase 08 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P08" packages/agents/src`
- Expected files from previous phase: `TurnProcessor.ts`/`turn.ts` (streaming wrap neutral — no longer import/call `streamChunkWrapper`). NOTE (C2): `streamChunkWrapper.ts` is NOT deleted yet — P08 only STOPS USING it in `TurnProcessor.ts`/`turn.ts`; the FILE is deleted in P25 (its last production consumer `executor-stream-processor.ts` migrates there). So `test -f packages/agents/src/core/streamChunkWrapper.ts` STILL SUCCEEDS at the start of P09 (importers remain in `subagentNonInteractive.ts` P23 + `executor-stream-processor.ts` P25).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/messageconverter-neutralization.md` — follow line numbers EXACTLY.

## Build-order invariant (READ FIRST — C3 fix)
`MessageConverter.convertIContentToResponse` (and its exclusive helper chain `applyResponseMetadata` `:634`,
`applyFinishReasonMapping` `:550`, plus `isValidResponse` `:228`) CANNOT be deleted in this phase because
LIVE callers still exist after P08:
- direct path: `DirectMessageProcessor.ts:364`, `:752` (neutralized in P13)
- chat facade: `chatSession.ts:560-561` (`convertIContentToResponse(input): GenerateContentResponse`) + `client.ts:781` (neutralized in P13)
- streaming accumulation: `streamResponseHelpers.ts:109` uses `isValidResponse` (neutralized in P15)

(Verified: `grep -rn "convertIContentToResponse\|applyResponseMetadata\|applyFinishReasonMapping\|isValidResponse\b" packages/agents/src | grep -v test`.)

Therefore **P09 RETYPES the surviving neutral conversion surface only** and keeps the synthetic-fabricator
functions intact (they are dead-on-the-streaming-path but still referenced by the direct path + facade +
streaming accumulator). The synthetic-fabricator chain is DELETED in **P13** (after the direct path,
`chatSession` facade, and `client.ts:781` stop calling it) with `isValidResponse` retired when
`streamResponseHelpers` migrates (P15). Every phase in between stays **build-green**.

## Requirements Implemented (Expanded)

### REQ-002.4 (partial — retype survivors; deletion in P13): MessageConverter neutral survivors
**Full Text**: `MessageConverter.convertIContentToResponse`, `applyResponseMetadata`, `applyFinishReasonMapping`, `isValidResponse` are DELETED; `streamChunkWrapper.ts` is DELETED. (streamChunkWrapper USAGE stops in `TurnProcessor.ts`/`turn.ts` at P08 and the FILE is deleted in P25 with its last consumer — C2; the fabricator chain `convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping` is deleted in P13 and the `isValidResponse` VALIDATOR in P15, per the build-order invariant — THIS phase retypes only the surviving `IContent`↔block conversion.)
**Behavior**:
- GIVEN: the surviving MessageConverter conversion helpers (`IContent`↔`ContentBlock[]` / input normalization)
- WHEN: retyped
- THEN: they operate on neutral blocks/speaker with no `{role,parts}` construction, while the synthetic fabricators remain temporarily for the still-Google direct path.
**Why This Matters**: staged deletion keeps the monorepo compiling; the fabricators die exactly when their last caller does (P13), not before.

### REQ-006.4: createUserContent replaced with a neutral builder
**Full Text**: `createUserContent` (`MessageConverter.ts`) replaced with a neutral builder.
**Behavior**:
- GIVEN: legacy input normalization
- WHEN: it needs a user message
- THEN: it constructs `IContent{speaker:'human'}` via the neutral converter (§2A.4-I(b)), not `createUserContent`/`{role,parts}`.
**Why This Matters**: removes a runtime `@google/genai` value import (`createUserContent`) — not an erasable type swap.

## Implementation Tasks (MODIFY; P06 tests stay green)

### `packages/agents/src/core/MessageConverter.ts`
- RETYPE survivors onto neutral (pseudocode lines 20-31): `createUserContentFromInput` (build `IContent{speaker:'human'}`, no `{role,parts}`, replaces the `createUserContent` value import — REQ-006.4), `isValidIContent`, `extractCuratedHistoryNeutral` (by speaker), `hasLeadingText` (TextBlock). Confirm `classifyMixedParts`/`convertBlocksToParts`/`convertPartListUnionToIContent` callers; retype onto `ContentBlock[]` or replace with core equivalents.
- **RETYPE (NOT delete) the surviving inbound converter** `createUserContentWithFunctionResponseFix` (`:138-173`) and its callers `convertPartListUnionToIContent` (`:190`, `:203`, `:207`): it is inbound `PartListUnion → Content` input normalization (overview §434, OQ-5 [retype→neutral]), NOT a synthetic-response fabricator. Rebuild its `{role:'user',parts}` construction as neutral `IContent`/`ContentBlock[]` directly. It MUST survive this phase (and the whole migration) — the spec DELETE list does NOT include it. Verify: `grep -n "createUserContentWithFunctionResponseFix" packages/agents/src/core/MessageConverter.ts` still shows the definition + its callers after retyping, with no `{role:'user',parts}` literal remaining.
- KEEP (do NOT delete this phase — deleted P13): `convertIContentToResponse` (`:518-543`), `applyResponseMetadata` (`:634`), `applyFinishReasonMapping` (`:550`, incl. `setProviderStopReason` write), `isValidResponse` (`:228`). They remain referenced by the direct path / chatSession facade / streamResponseHelpers until P13/P15.
- Drop the `createUserContent` (value) import once `createUserContentFromInput` replaces it. Keep the `FinishReason` (value) import ONLY if `applyFinishReasonMapping` still needs it (it does, until P13); it is removed in P13 with the fabricator.

### Required Code Markers
EVERY retyped survivor MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `messageconverter-neutralization.md`), not only the prose bullets:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P09
 * @requirement:REQ-002.4
 * @pseudocode lines 20-31   // surviving IContent<->block conversion survivors (per-function range)
 */
```
- `createUserContentFromInput`/`isValidIContent`/`extractCuratedHistoryNeutral`/`hasLeadingText` → `@pseudocode lines 20-31`; `@requirement:REQ-002.4`, and `@requirement:REQ-006.4` on `createUserContentFromInput` (replaces `createUserContent`).
- `createUserContentWithFunctionResponseFix` + `convertPartListUnionToIContent` (retyped inbound normalizer) → `@pseudocode lines 20-31` (the survivor-conversion block); `@requirement:REQ-002.4`.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P09`, `@requirement:REQ-002.4/REQ-006.4`, plus the per-function `@pseudocode lines X-Y` above.

## Integration Points (old code REMOVED / RETYPED)
- The surviving `IContent`↔block conversion is now neutral; the synthetic fabricators are quarantined (still compiled, called only by the not-yet-migrated direct path + facade + streaming accumulator).
- The `setProviderStopReason` writer inside `applyFinishReasonMapping` still exists after P09 (it dies in P13), so `providerStopReason.ts` DELETE is deferred to P13 (see the P11 and P13 build-order notes), not P11.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/streamPipeline.characterization.test.ts   # green
if grep -rn "createUserContent\b" packages/agents/src/core/MessageConverter.ts; then echo "FAIL: createUserContent not replaced by the neutral builder"; exit 1; fi
# Fabricators still present (expected until P13):
grep -c "convertIContentToResponse" packages/agents/src/core/MessageConverter.ts   # >0 (expected; deleted P13)
# ---- MAJOR 4: P09-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# P09 retypes the SURVIVING conversion only; the synthetic fabricator sites (convertIContentToResponse chain,
# usageMetadata builder :651-662) are QUARANTINED and OWNED BY P13 (not closable here). This slice OWNS exactly
# the survivor sites it neutralizes: the `createUserContent`/`{role:'user',parts}` builder path
# (convertPartListUnionToIContent :170-173) retyped to neutral IContent construction.
npx tsx scripts/agents-neutral-gate.ts --count --by-file   # per-site detail; assert the P09-owned survivor hit ID(s) ABSENT; the P13-owned fabricator hits REMAIN (expected)
npx tsx scripts/agents-neutral-gate.ts --count   # net AST count <= P08 (P09 is a partial retype; strict-decrease if any hit closed, else bounded floor with the quarantined fabricator hits explicitly attributed to P13)
npm run typecheck && npm run build   # green cross-package
```

## Success Criteria
- Surviving MessageConverter conversion is neutral (blocks/speaker); `createUserContent` value import gone; synthetic fabricators intact-but-quarantined (their structural-hit IDs remain and are attributed to P13, NOT double-claimed here); monorepo build green.
- **Site-specific closure (Major 4):** the P09-OWNED survivor hit ID(s) (the `createUserContent`/`{role:'user',parts}` builder path retyped to neutral) are ABSENT in `--by-file` output; the fabricator hits still present are explicitly the P13-owned quarantined set, not a P09 failure.

## Failure Recovery
If this phase fails (characterization red, build breaks, or a survivor retype leaks `{role,parts}`):
1. `git checkout -- packages/agents/src/core/MessageConverter.ts`
2. Re-apply retype-only changes; do NOT delete the synthetic fabricators here (that is P13).
3. Cannot proceed to Phase 10 until build is green and P06 is green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P09.md`.
