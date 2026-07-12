# Phase 11: Side-channel retirement — IMPL (neutralize hookToolRestrictions.ts; providerStopReason WRITER dies P13, FILE deleted P25)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P11`

## Prerequisites
- Required: Phase 10 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P10" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/__tests__/sideChannel.characterization.test.ts` (#2329 refusal + hook-restriction observable behavior, PASSING against current code).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `analysis/pseudocode/hooktoolrestrictions-neutral.md` — follow line numbers EXACTLY.

## Build-order invariant (READ FIRST — C2/C3 cascade correction)
`providerStopReason.ts` has exactly two production references (verified `grep -rn "setProviderStopReason\|getProviderStopReason" packages/agents/src | grep -v test`):
its READER `getProviderStopReason` at `streamChunkWrapper.ts:112` and its WRITER `setProviderStopReason`
at `MessageConverter.ts:588` inside `applyFinishReasonMapping`.
- The READER lives INSIDE `streamChunkWrapper.ts` (in `responseToModelStreamChunk`). P08 stops the
  TurnProcessor/turn.ts USAGE of `streamChunkWrapper`, but the `streamChunkWrapper.ts` FILE (and thus the
  `getProviderStopReason` reader import at `:112`) physically survives until the file is DELETED in **P25**
  (its last production consumer `executor-stream-processor.ts` migrates there — C2). So the READER is NOT
  gone at P08; it is gone at **P25**.
- The WRITER lives inside `applyFinishReasonMapping`, part of the synthetic-fabricator chain P09 deferred
  to **P13**. So the WRITER is gone at **P13**.
Because the READER survives until P25, the **whole-file DELETE of `providerStopReason.ts` moves to P25**
(co-located with the `streamChunkWrapper.ts` delete that removes its last reader) — NOT P13. **P13 removes
only the WRITER** (with the fabricator chain); after P13 `providerStopReason.ts` still has ONE reference
(the `streamChunkWrapper.ts:112` reader) and is therefore NOT yet file-deletable — deleting it at P13
would dangle `streamChunkWrapper.ts:112`'s `import { getProviderStopReason }` and break the build.
**This phase (P11) retires the stop-reason behavior structurally** — the raw stop reason already rides
`chunk.rawStopReason` (sourced from `IContent.metadata.stopReason`) after P08, so the side-channel is
behaviorally dead here even though the file is physically deleted in P25. This phase focuses on
`hookToolRestrictions.ts`.

## Requirements Implemented (Expanded)

### REQ-003.1: providerStopReason retired (behavior here; WRITER dies P13; FILE DELETE in P25)
**Full Text**: `providerStopReason.ts` is retired; raw provider stop reason rides `ModelStreamChunk.rawStopReason` sourced from `IContent.metadata.stopReason`; #2329 refusal `stopReason` on the `Finished` event is preserved. (Staged: behavior neutral HERE; WRITER `setProviderStopReason` removed in P13 with the fabricator chain; the FILE is DELETED in P25 when its READER inside `streamChunkWrapper.ts:112` is removed with the whole-file `streamChunkWrapper.ts` delete — C2.)
**Behavior**:
- GIVEN: a provider raw stop reason (e.g. Anthropic `refusal`)
- WHEN: the turn finishes
- THEN: `Finished.stopReason` reflects it from `chunk.rawStopReason` — the raw stop reason no longer depends on the bolted-on `Candidate.providerStopReason` field on the live path (the field's WRITER is removed in P13 and its READER + the file itself in P25).
**Why This Matters**: the side-channel is a symptom of the synthetic round-trip; its behavior is neutral here, its writer dies with the fabricator (P13), and the file is removed with its last reader `streamChunkWrapper.ts` (P25) — so the deletion never dangles an import mid-plan.

### REQ-003.2: hookToolRestrictions neutralized
**Full Text**: `hookToolRestrictions.ts` stops using `WeakMap`/`Symbol` identity keying on `GenerateContentResponse`/`FunctionCall`; restriction metadata rides explicit `HookRestrictions` on `ModelStreamChunk`, and filtering operates on `ContentBlock[]`/`ToolCallBlock` (`turn.filterBlocksByAllowedTools`).
**Behavior**:
- GIVEN: a before-tool-selection hook restricts allowed tools
- WHEN: the model emits tool calls
- THEN: restricted `ToolCallRequest`s are filtered out of emitted events + AFC via `chunk.hookRestrictions`, with NO `WeakMap`/`Symbol` keying.
**Why This Matters**: removes the second identity-keyed side-channel that only existed to cross the synthetic-response boundary.

## Implementation Tasks (MODIFY; P10 tests stay green)

### `packages/agents/src/core/providerStopReason.ts` — DELETE DEFERRED TO P25 (writer removed P13)
- Do NOT delete the file here. It still has BOTH references: the WRITER `setProviderStopReason` at `MessageConverter.ts:588` (removed in P13 with the fabricator chain) AND the READER `getProviderStopReason` at `streamChunkWrapper.ts:112` (removed in P25 when the `streamChunkWrapper.ts` file is deleted — C2). Confirm both remain: `grep -rn "providerStopReason" packages/agents/src --include=*.ts | grep -v test` ⇒ `MessageConverter.ts:588` (writer) + `streamChunkWrapper.ts:112` (reader) + the file itself. The file cannot be deleted until BOTH are gone (P25), else `streamChunkWrapper.ts:112`'s `import { getProviderStopReason }` dangles.

### `packages/agents/src/core/hookToolRestrictions.ts` (NEUTRALIZE to ZERO Google types, lines 20-43)
- The neutral block filter `filterHookRestrictedBlocks(blocks: ContentBlock[], allowedToolNames)` was ADDED in P07 (extracted from `turn.filterBlocksByAllowedTools`); this phase KEEPS it and builds the rest of the neutral API around it.
- DELETE all WeakMaps + Symbols + `HookRestrictedResponse`/`HookRestrictedFunctionCall` types.
- Implement `applyHookRestrictionsToChunk` (block-based, sets `chunk.hookRestrictions`), `getHookRestrictedAllowedTools`/`hasFilteredHookRestrictedToolCalls` (read `chunk.hookRestrictions`), `filterAfcByHookRestrictions` (IContent[] block filter).
- Drop ALL `GenerateContentResponse`/`FunctionCall`/`Content`/`Part` currency AND the `@google/genai` import from this file. **End state (C4): `hookToolRestrictions.ts` has ZERO `@google/genai`, ZERO `GenerateContentResponse`, ZERO `WeakMap`, ZERO `Symbol(`, and NO allow-list entry.** The old `attachHookRestrictedAllowedTools`/`filterHookRestrictedContent(s)` `GenerateContentResponse` functions are DELETED from this module.
- **C4 — the residual before-model blocking `GenerateContentResponse` helper is NOT allowed to remain in this side-channel module.** Spec §21 requires side-channels RETIRED BY DELETION, not adaptation. The before-model blocking-hook path (`beforeModelHookDecision.ts:72` → `attachHookRestrictedAllowedTools(syntheticResponse: GenerateContentResponse, ...)`) is retained until P13, but its temporary `GenerateContentResponse`-shaped restriction-stamping helper MUST NOT live in `hookToolRestrictions.ts`. Instead:
  - CREATE `packages/agents/src/core/beforeModelBlockingCompat.ts` — a clearly-named, single-purpose TEMPORARY hook-wire compat module that holds ONLY the before-model blocking `GenerateContentResponse` restriction-stamping helper consumed by `beforeModelHookDecision.ts`/`DirectMessageProcessor._buildBlockingSyntheticResponse` until P13. It has an EXPLICIT owning deletion phase (P13) stated in a top-of-file doc comment (`@plan:PLAN-20260707-AGENTNEUTRAL.P11 — DELETE in P13`).
  - **Why this temp module SURVIVES to P13 and is not eliminated by C3 (Major 4 decision):** C3 keeps the before-model blocking path `GenerateContentResponse`-typed until P13 (the shared `AgentExecutionBlockedError` transport cannot be retyped until ALL three BLOCK writers are neutral, which happens atomically in P13). Between P11 (where `hookToolRestrictions.ts` is fully neutralized) and P13, the before-model blocking restriction-stamping helper still needs a `GenerateContentResponse`-typed home that is NOT the neutralized side-channel module. Therefore the temp module is REQUIRED for build-green staging and is deleted in P13 alongside the C3 error retype.
  - **HARD constraints on the temp module (Major 4):** it exports EXACTLY ONE function (`attachHookRestrictedAllowedToolsToBlockingResponse`); NO re-export of any other symbol; NO barrel/`index` re-export; a small explicit cap of ≤ 40 source lines (doc comment + the one function); and it is the ONLY allow-listed compat island. It MUST NOT grow a second helper or become a general Google-shaped utility.
  - This module IS the single bounded exception, recorded in `dev-docs/agents-neutral-gate-allowlist.md` as an AST-context-keyed entry (NOT `hookToolRestrictions.ts`, NOT a bare file path — the entry names the single exported function's AST context), and it is DELETED in P13 when the before-model blocking synthetic machinery dies. `hookToolRestrictions.ts` itself ends this phase FULLY neutral with NO allow-list entry.
  - Re-point `beforeModelHookDecision.ts:72` (and any before-model blocking caller) from `hookToolRestrictions.attachHookRestrictedAllowedTools` to `beforeModelBlockingCompat.attachHookRestrictedAllowedToolsToBlockingResponse`.
- Update the CHUNK/stream consumers (`StreamProcessor`, `TurnProcessor`, `turn.ts`, `DirectMessageProcessor`) to the neutral API (some already done P07/P08; finish here). Do NOT retype the before-model blocking-hook `GenerateContentResponse` path (P13); it now lives in `beforeModelBlockingCompat.ts`, not in the side-channel module.

### Required Code Markers
EVERY new/neutralized function MUST carry the marker block with the SPECIFIC `@pseudocode` line range (from `hooktoolrestrictions-neutral.md`), not only the prose bullets:
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P11
 * @requirement:REQ-003.2
 * @pseudocode lines 20-43   // block-based restriction API (per-function range)
 */
```
- `applyHookRestrictionsToChunk` / `getHookRestrictedAllowedTools` / `hasFilteredHookRestrictedToolCalls` / `filterAfcByHookRestrictions` → `@pseudocode lines 20-43`; `@requirement:REQ-003.2`. (`filterHookRestrictedBlocks` was introduced in P07 and carries its P07 marker.)
- `beforeModelBlockingCompat.attachHookRestrictedAllowedToolsToBlockingResponse` (temporary before-model compat; DELETE in P13) → `@plan:PLAN-20260707-AGENTNEUTRAL.P11`; `@requirement:REQ-003.2`.
- The stop-reason structural retirement (raw stop reason now rides `chunk.rawStopReason`) → `@requirement:REQ-003.1` (no new function; annotate the consumer change).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P11`, `@requirement:REQ-003.1/.2`, plus the per-function `@pseudocode lines X-Y` above.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/sideChannel.characterization.test.ts   # green
# C4 — hookToolRestrictions.ts is FULLY retired by deletion (spec §21), ZERO Google shapes, NO allow-list entry (HARD asserts):
if grep -rnE "WeakMap|Symbol\(" packages/agents/src/core/hookToolRestrictions.ts; then echo "FAIL: identity-keyed side-channel (WeakMap/Symbol) still present"; exit 1; fi
if grep -n "@google/genai" packages/agents/src/core/hookToolRestrictions.ts; then echo "FAIL: residual @google/genai in hookToolRestrictions.ts (C4)"; exit 1; fi
if grep -n "GenerateContentResponse" packages/agents/src/core/hookToolRestrictions.ts; then echo "FAIL: residual GenerateContentResponse helper in hookToolRestrictions.ts (C4)"; exit 1; fi
if grep -nE "hookToolRestrictions" dev-docs/agents-neutral-gate-allowlist.md; then echo "FAIL: hookToolRestrictions.ts must have NO allow-list entry (C4)"; exit 1; fi
grep -n "chunk.hookRestrictions\|HookRestrictions" packages/agents/src/core/hookToolRestrictions.ts   # neutral chunk restriction API present (diagnostic)
# The temporary before-model blocking GenerateContentResponse compat lives in its OWN named module (NOT the side-channel),
# owned for deletion by P13, and is the single AST-context allow-listed hook-wire compat entry:
test -f packages/agents/src/core/beforeModelBlockingCompat.ts   # temporary before-model blocking compat (DELETE in P13)
grep -nE "beforeModelBlockingCompat" dev-docs/agents-neutral-gate-allowlist.md   # AST-context-keyed entry present (removed in P13)
grep -n "DELETE in P13" packages/agents/src/core/beforeModelBlockingCompat.ts   # explicit owning deletion phase documented
# Major 4 — HARD constraints on the temp compat: exactly ONE exported function, NO re-export, ≤40 lines:
test "$(grep -cE '^export ' packages/agents/src/core/beforeModelBlockingCompat.ts)" -eq 1   # exactly one export
if grep -nE '^export \* |export \{[^}]*\} from|export .* from ' packages/agents/src/core/beforeModelBlockingCompat.ts; then echo "FAIL: beforeModelBlockingCompat.ts must not re-export any symbol"; exit 1; fi
test "$(wc -l < packages/agents/src/core/beforeModelBlockingCompat.ts)" -le 40   # line cap
grep -nE "attachHookRestrictedAllowedToolsToBlockingResponse" packages/agents/src/core/beforeModelBlockingCompat.ts   # the single exported helper
# providerStopReason.ts is NOT yet deleted. It still has BOTH refs: WRITER MessageConverter.ts:588 (removed P13)
# AND READER streamChunkWrapper.ts:112 (removed P25 with the streamChunkWrapper.ts file DELETE, C2):
grep -rn "providerStopReason" packages/agents/src --include=*.ts | grep -v test   # MessageConverter.ts:588 (writer) + streamChunkWrapper.ts:112 (reader) + the file
# ---- MAJOR 4: P11-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly these structural-hit IDs; assert ABSENT now:
#   hookToolRestrictions.filterHookRestrictedContent `content.parts` reader/mutator (:184-192, F5);
#   hookToolRestrictions clone/`{...content, parts: filter(...)}` builder (:115-118/:189-191, F3);
#   hookToolRestrictions AFC content-length filter (:133, G-filter).
# The bounded before-model GenerateContentResponse helper (if kept) is an ALLOW-LISTED entry (removed P13), NOT an open hit.
# MAJOR 2 — HARD-ASSERT the owned-hit closure + net-count ratchet (not comment-only):
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p11_byfile.txt
while read -r id; do
  if grep -qF "$id" /tmp/p11_byfile.txt; then echo "FAIL(Major 4): P11-owned structural hit still present (and not allow-listed): $id"; exit 1; fi
done < <(grep -F 'owner=P11' dev-docs/agents-neutral-gate-baseline.md | sed -E 's/ *owner=P11.*//; s/^[-* ]*//')
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than prior (P09) $prev"; exit 1; }
echo "PASS: P11 net --count $cur < prior $prev; owned hits closed (bounded before-model helper allow-listed)"
npm run typecheck && npm run build   # green cross-package
```

## Success Criteria
- **C4: `hookToolRestrictions.ts` is retired by DELETION, not adaptation** — ZERO `@google/genai`, ZERO `GenerateContentResponse`, ZERO `WeakMap`, ZERO `Symbol(`, and NO allow-list entry for it. The CHUNK/stream restriction currency is neutral (`chunk.hookRestrictions`, `ContentBlock[]`/`ToolCallBlock`). The temporary before-model blocking `GenerateContentResponse` compat lives in the separate, clearly-named `beforeModelBlockingCompat.ts` (its own AST-context allow-list entry) with an explicit P13 deletion owner — NOT inside the side-channel module. Stop reason rides `chunk.rawStopReason`; characterization green; `providerStopReason.ts` is behaviorally dead here (its WRITER is removed in P13, its READER + the file itself in P25 with the `streamChunkWrapper.ts` delete — C2); build green.
- **Site-specific closure (Major 4):** every P11-OWNED baseline structural-hit ID (`filterHookRestrictedContent` `.parts` reader/mutator; the clone/`{...content,parts:filter}` builder; the AFC content-length filter) is ABSENT (or centrally allow-listed as the bounded before-model helper) in `--by-file` output, in ADDITION to the net `--count` strictly decreasing below P09; those IDs are removed from the baseline listing.

## Failure Recovery
If this phase fails (characterization red, build breaks, or a residual WeakMap remains):
1. `git checkout -- packages/agents/src/core/hookToolRestrictions.ts` and any updated consumers.
2. Re-apply the neutral block-based restriction API per `hooktoolrestrictions-neutral.md`; do NOT delete `providerStopReason.ts` here.
3. Cannot proceed to Phase 12 until build is green and P10 is green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P11.md`.
