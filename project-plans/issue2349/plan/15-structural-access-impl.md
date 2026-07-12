# Phase 15: Structural-access sites — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P15`

## Prerequisites
- Required: Phase 14 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P14" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts` (carries `@requirement:REQ-005.1..005.5`; PASSING against current code).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `stream-processor-neutral.md` (consolidation lines 28-31), `messageconverter-neutralization.md` (validators), §2A.4 dispositions.

## Requirements Implemented (Expanded)

### REQ-005.1: ConversationManager text consolidation reimplemented on blocks
**Full Text**: `ConversationManager` text-consolidation + thought-filter (`appendTextContentParts`, `_consolidateModelOutput`, `hasTextContent`, `_recordOutputContent`) reimplemented on `ContentBlock[]`: consolidate adjacent `TextBlock`s at the SAME merge boundaries, thought-filter via `ThinkingBlock`, no `.parts` mutation. **NOTE (Major 3 — getHistory staging):** the `getHistory` PUBLIC RETURN-TYPE flip to `IContent[]` and the G1/G2 `toGeminiContents` deletions do NOT happen here — they move to **P21** (the atomic cross-package contract flip), because `getHistory()` currently returns `Content[]` and has cross-package callers in CLI + core (see the "getHistory staging" box below). In P15, `getHistory` KEEPS returning `Content[]` via a thin boundary conversion; its INTERNAL consolidation/thought reimplementation on blocks still lands here.
**Behavior**:
- GIVEN: adjacent model text
- WHEN: consolidated
- THEN: adjacent `TextBlock`s merge with identical boundaries (BR-7). GIVEN thoughts with include-in-context false; THEN `ThinkingBlock` text is dropped from history but its signature is retained (BR-5). GIVEN a live chat; WHEN `getHistory()` is called; THEN it awaits idle and returns a defensively-cloned value (return TYPE flips in P21, not here).
**Why This Matters**: eliminates the ConversationManager §2A.4-II read/mutate surface without changing observable consolidation/thought/history semantics, WHILE keeping the monorepo build green (the public `getHistory` type flips atomically with its cross-package callers in P21).

> **getHistory staging decision (Major 3 — DECIDED: P21, not P15).**
> Current: `AgentClient.getHistory()` returns `Promise<Content[]>` (`client.ts:403`, chat-live path `:413`, stored-history path `:420-422` via `toGeminiContents` = **G1**); `ConversationManager.getHistory()` returns `Content[]` (`ConversationManager.ts:412-424` via `toGeminiContents` = **G2** + `structuredClone`). Cross-package callers of the neutral surface exist in **CLI** (`checkpointPersistence.ts:101`, `chatCommand.ts:177/409/448/539`, `copyCommand.ts:30`) and **core** (`agentClientLifecycle.ts:111-112`, `config.ts:276`, `checkpointUtils.ts:126`), plus agents-internal (`chatSession.ts:503`, `turn.ts:629`, `agentImpl.ts:842/1244` (`as readonly AgentMessage[]`), `sessionControl.ts:194/313` (`as Content[]`)).
> If P15 flipped `getHistory`'s return type to `IContent[]`, EVERY cross-package caller would fail typecheck at the P15 boundary — the monorepo build would be RED between P15 and P21. That is exactly the forbidden boundary "client.ts/ConversationManager.ts neutral but the public contract still requires `Content[]`."
> DECISION: the `getHistory` return-type flip + **G1 + G2 deletion** move into **P21**, atomic with `AgentClientContract.getHistory` retype and the migration of all cross-package consumers (many of which — `sessionControl`, `agentClientLifecycle`, `checkpointUtils` — are ALREADY in P21's 23-CLI + 5-core consumer set). P15 does the INTERNAL block reimplementation only; the public type stays `Content[]` until P21 flips it in one build-green phase.

### REQ-005.2: clientLlmUtilities stateless helpers on blocks (OQ-3s)
**Full Text**: `clientLlmUtilities` stateless helpers (`next_speaker` text extraction/fallback) read `TextBlock.text` on neutral `IContent[]`; retyped with the contract (OQ-3s), not a bounded adapter.
**Behavior**:
- GIVEN: representative last-message content
- WHEN: next_speaker runs
- THEN: the same decision + fallback are produced from `TextBlock.text`, never `.parts`.
**Why This Matters**: removes a stateless `.parts` reader that would otherwise survive the import swap.

### REQ-005.3: streamResponseHelpers accumulation on blocks
**Full Text**: `streamResponseHelpers` accumulation (`accumulateChunkMetadata`, `recordHistoryWithUsage`) reads `ContentBlock[]`/`CanonicalFinishReason` from the neutral chunk (no `chunk.candidates`/`.parts`); the `isValidResponse(chunk)` guard is replaced with a neutral block-presence check.
**Behavior**:
- GIVEN: a scripted neutral chunk stream
- WHEN: accumulated
- THEN: recorded history + finish reason match today, derived from blocks; `MessageConverter.isValidResponse` has ZERO callers afterward and is deleted.
**Why This Matters**: retires the last caller of the final synthetic-fabricator survivor (`isValidResponse`).

### REQ-005.4: MessageStreamOrchestrator pending-tool-call detection on blocks
**Full Text**: `MessageStreamOrchestrator`/`MessageStreamTerminalHandler` pending-tool-call detection derives from `ToolCallBlock` presence on the neutral last `IContent`.
**Behavior**:
- GIVEN: a last message with/without a tool call
- WHEN: detection runs
- THEN: IDE-context injection fires iff a `ToolCallBlock` is present (same as today).
**Why This Matters**: removes the `.parts`-based pending-tool-call probe.

### REQ-005.5: Full construction/access surface eliminated or bounded
**Full Text**: The full §2A.4-I construction surface and §2A.4-II access/mutation surface are eliminated or bounded — `clientHelpers` compress-split detection + `client.stripThoughts` operate on `ContentBlock[]`; no residual `.parts`/`candidate.content`/`{role,parts}`/`{candidates}` in the migrated files.
**Behavior**:
- GIVEN: a compression split
- WHEN: chosen
- THEN: the split is at the SAME function-response boundary, computed on blocks; `stripThoughts` drops thought text, keeps signature.
**Why This Matters**: closes the remaining §2A.4 access surface in this slice.

### REQ-010.1 (staging note — NOT owned here): toGeminiContents G1/G2 deletion is DEFERRED to P21 (with the getHistory return-type flip, Major 3)
> This is a STAGING note, not a P15-owned requirement (REQ-010.1's G1/G2 deletion is OWNED by P21 — see the execution-tracker REQ-010 coverage line). It documents why P15 does NOT close G1/G2, so a coordinator does not mistake the surviving boundary calls for a defect.

**Full Text**: The `ContentConverters.toGeminiContents(...)` conversions **G1** (`client.ts:420-422`, stored-history path) and **G2** (`ConversationManager.ts:412-424`) are NOT deleted in P15 — they are the boundary conversions that keep `getHistory()` returning `Content[]` while its cross-package callers are still Google-typed. They are deleted in **P21** (REQ-010.1), atomic with the `getHistory` return-type flip and the migration of the CLI + core consumers. In P15, `getHistory`'s INTERNAL body is reimplemented on blocks but the boundary `toGeminiContents` at the return remains until P21. (G4/G5/G7 in P19; G6 in P08; G3 hook adapter is the only bounded allow-listed survivor iff OQ-1a.)
**Behavior**:
- GIVEN: the P15 boundary
- WHEN: searched
- THEN: `client.ts`/`ConversationManager.ts` MAY still contain the single `toGeminiContents` boundary call in `getHistory` (G1/G2) — deleted in P21. No OTHER `toGeminiContents` call is added.
**Why This Matters**: keeps the build green at the P15 boundary; the two converter flows vanish atomically with their cross-package callers in P21 (the ONLY correct place — see the getHistory staging box under REQ-005.1).

### REQ-010.2: no GeminiContent* imports in the fully-migrated files
**Full Text**: No imports of `GeminiContent`/`GeminiContentPart`/`GeminiFunctionCall` (barrel or direct) remain in the files this slice FULLY migrates (`clientLlmUtilities.ts`, `streamResponseHelpers.ts`, `MessageStreamOrchestrator.ts`, `MessageStreamTerminalHandler.ts`, `clientHelpers.ts`). NOTE: `client.ts` and `ConversationManager.ts` retain their `getHistory` boundary `Content`/`toGeminiContents` usage until **P21** (Major 3 staging), so their `GeminiContent*`/`Content` import removal is asserted in P21a, not P15a.
**Behavior**:
- GIVEN: the fully-migrated files (excluding `client.ts`/`ConversationManager.ts`, which finish in P21)
- WHEN: searched
- THEN: zero `GeminiContent*` imports remain.
**Why This Matters**: closes the barrel-import bypass vector on this slice's fully-migrated files; the two getHistory-boundary files close in P21 with their cross-package callers.

## Implementation Tasks (MODIFY; P14 tests stay green)

### `packages/agents/src/core/ConversationManager.ts` (RETYPE with block-level merge reimplementation — §3.2 #13) — `@requirement:REQ-005.1`
- `appendTextContentParts` → consolidate adjacent `TextBlock`s on `IContent`/`ContentBlock[]` (no `.parts` mutation).
- `_consolidateModelOutput` + `hasTextContent` → block-based (`hasLeadingText`).
- `_recordOutputContent` → filter `ThinkingBlock` by config, keep signature (BR-5); empty placeholder → `IContent{speaker:'ai',blocks:[]}`.
- `getHistory` → **DO NOT flip the return type here (Major 3).** Reimplement the internal consolidation/thought path on blocks, but KEEP the public `getHistory(): Content[]` boundary conversion (`toGeminiContents` G2 at `:412-424`) intact — the return-type flip to `IContent[]` + G2 deletion move to **P21** (atomic with the cross-package `getHistory` callers). Preserve the defensive clone.
- `toIContent` inbound normalization sites become no-ops once contract is neutral (finalized P21).

### `packages/agents/src/core/streamResponseHelpers.ts` (RETYPE §3.2 #22) — `@requirement:REQ-005.3`
- `accumulateChunkMetadata`: accumulate `CanonicalFinishReason` + `ContentBlock[]` from the neutral chunk (no `candidates`/`.parts`). DELETE the `isValidResponse(chunk)` guard at `:109` — replace with a neutral block-presence check on the `ModelStreamChunk`. This removes the LAST caller of `MessageConverter.isValidResponse`.
- After this change, DELETE `MessageConverter.isValidResponse` (`:228`) — the final synthetic-fabricator survivor (deferred from P13). Verify: `grep -rn "isValidResponse" packages/agents/src | grep -v test` ⇒ EMPTY.
- `recordHistoryWithUsage`: record `IContent{speaker:'ai'}` (delete `{role:'model',parts}` builder); usage from `UsageStats` (delete Gemini usage keys); drop runtime `FinishReason`.

### `packages/agents/src/core/clientLlmUtilities.ts` — `@requirement:REQ-005.2`
- `next_speaker` text extraction / fallback → `TextBlock.text` on neutral `IContent[]` (OQ-3s: stateless helpers retyped with the contract, not a bounded adapter).

### `packages/agents/src/core/MessageStreamOrchestrator.ts`, `MessageStreamTerminalHandler.ts` — `@requirement:REQ-005.4`
- pending-tool-call detection → `ToolCallBlock` presence on the neutral last `IContent`.

### `packages/agents/src/core/clientHelpers.ts`, `client.ts` (`stripThoughts`) — `@requirement:REQ-005.5`, `@requirement:REQ-010.2`
- compress-split / thought-strip → `ContentBlock[]` (INTERNAL block reimplementation).
- **DO NOT delete `toGeminiContents` G1 in `client.ts:420-422` here (Major 3).** That deletion + the `getHistory` return-type flip move to **P21** (atomic with the cross-package callers). In P15, `client.getHistory()` KEEPS returning `Content[]` via the G1 boundary conversion; only the internal `stripThoughts`/compress-split logic moves to blocks.
- Remove any `GeminiContent*` imports left in `clientHelpers.ts` (REQ-010.2). `client.ts`'s `Content`/`GeminiContent*`/`toGeminiContents` usage tied to the `getHistory` boundary is removed in P21, not here.

### Required Code Markers
`@plan:PLAN-20260707-AGENTNEUTRAL.P15` on every touched function, plus the per-file `@requirement:` markers above (REQ-005.1..5.5 by owning site; REQ-010.1/.2 on the `toGeminiContents`/`GeminiContent*` deletions), PLUS the SPECIFIC `@pseudocode` line range for each touched function (not only prose):
```typescript
/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P15
 * @requirement:REQ-005.1
 * @pseudocode lines 28-31   // ConversationManager consolidation (stream-processor-neutral.md)
 */
```
- `ConversationManager` `appendTextContentParts`/`_consolidateModelOutput`/`hasTextContent`/`_recordOutputContent` → `@pseudocode lines 28-31` (`stream-processor-neutral.md` consolidation); `@requirement:REQ-005.1`. (`getHistory`'s internal consolidation is annotated here; its return-type flip + G2 deletion are marked in P21, NOT P15 — Major 3.)
- `streamResponseHelpers` `accumulateChunkMetadata`/`recordHistoryWithUsage` → `@pseudocode lines 28-31` (`stream-processor-neutral.md`); `@requirement:REQ-005.3`. The `isValidResponse` deletion follows `messageconverter-neutralization.md` (validators section) — annotate its removal with that file's validator line range.
- `clientLlmUtilities` next_speaker helpers → `@requirement:REQ-005.2` (no dedicated pseudocode function; annotate with the `stream-processor-neutral.md` block-text-extraction range where applicable).
- `MessageStreamOrchestrator`/`MessageStreamTerminalHandler` pending-tool-call detection → `@requirement:REQ-005.4`.
- `clientHelpers` compress-split + `client.stripThoughts` → `@requirement:REQ-005.5`, `@requirement:REQ-010.2`. (client.ts G1 deletion + getHistory flip are marked in P21 — Major 3.)
- NOTE: the prose "consolidation lines 28-31 / validators" bullets in Prerequisites are NOT a substitute — each touched function's marker BLOCK must carry its `@pseudocode lines X-Y`.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/structuralAccess.characterization.test.ts   # green

# ---- P15-OWNED §2A.4-II inventory sites, BY REQUIREMENT (this slice OWNS exactly these) ----
# P15 OWNS: ConversationManager consolidation/thought sites; clientLlmUtilities next_speaker;
# streamResponseHelpers accumulation (+ isValidResponse removal); MessageStreamOrchestrator/TerminalHandler
# pending-tool-call; clientHelpers compress-split; client.stripThoughts. It does NOT own — and MUST NOT
# claim — the sites retired by OTHER phases (TurnProcessor/DirectMessageProcessor/hookToolRestrictions/
# turnLogging/streamChunkWrapper); those are asserted by their owning phases and re-checked by the
# INVENTORY-CLOSURE gate in P33 (see P33 "§2A.4 inventory-closure"). A "strictly lower AST count" does
# NOT substitute for named-site closure.

# REQ-005.1 (ConversationManager consolidation/thought — INTERNAL block reimpl; getHistory RETURN stays Content[] until P21):
#   The INTERNAL merge/thought logic must be block-based (no .parts MUTATION); the ONLY residual Google shape
#   permitted here is the getHistory boundary conversion (G2, deleted P21). Assert no .parts MUTATION/{candidates}:
if grep -nE "\.parts *=|\.parts\.push|\{ *candidates:" packages/agents/src/core/ConversationManager.ts; then echo "FAIL: .parts mutation / {candidates} literal in ConversationManager.ts"; exit 1; fi
#   (A residual `toGeminiContents`/`Content` in getHistory ONLY is expected until P21 — do NOT fail on it here.)
# REQ-005.2 (clientLlmUtilities next_speaker):
if grep -nE "\.parts\b|candidate\.content" packages/agents/src/core/clientLlmUtilities.ts; then echo "FAIL: .parts/candidate.content in clientLlmUtilities.ts"; exit 1; fi
# REQ-005.3 (streamResponseHelpers accumulation + isValidResponse removal):
if grep -nE "\.parts\b|candidates\b|role: *'model'" packages/agents/src/core/streamResponseHelpers.ts; then echo "FAIL: Google-shaped access in streamResponseHelpers.ts"; exit 1; fi
if grep -rn "isValidResponse" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: isValidResponse survivor not deleted"; exit 1; fi
# REQ-005.4 (MessageStreamOrchestrator/TerminalHandler pending-tool-call):
if grep -nE "\.parts\b|functionCall\b" packages/agents/src/core/MessageStreamOrchestrator.ts packages/agents/src/core/MessageStreamTerminalHandler.ts; then echo "FAIL: .parts/functionCall access in orchestrator/terminal handler"; exit 1; fi
# REQ-005.5 (clientHelpers compress-split + client.stripThoughts — INTERNAL block reimpl; client.getHistory RETURN stays Content[] until P21):
if grep -nE "\.parts *=|candidate\.content" packages/agents/src/core/clientHelpers.ts; then echo "FAIL: .parts mutation/candidate.content in clientHelpers.ts"; exit 1; fi
#   client.ts stripThoughts must be block-based; its getHistory G1 boundary conversion stays until P21:
if grep -nE "\.parts *=" packages/agents/src/core/client.ts; then echo "FAIL: .parts mutation in client.ts (stripThoughts must be block-based)"; exit 1; fi
# REQ-010.1 (staging, owned by P21): G1/G2 are NOT expected empty here — they die in P21. Assert NO NEW toGeminiContents beyond the two getHistory boundaries:
tgc=$(grep -rn 'toGeminiContents' packages/agents/src/core/client.ts packages/agents/src/core/ConversationManager.ts | grep -v test | wc -l | tr -d ' ')
if [ "$tgc" -gt 2 ]; then echo "FAIL: more than the two getHistory boundary toGeminiContents remain (found $tgc)"; exit 1; fi
echo "OK: only the two getHistory boundary conversions remain (G1/G2 → deleted P21)"
# REQ-010.2 (no GeminiContent* imports in the FULLY-migrated files — EXCLUDES client.ts/ConversationManager.ts, which finish in P21):
if grep -rnE "GeminiContent(Part)?\b|GeminiFunctionCall\b" packages/agents/src/core/clientHelpers.ts packages/agents/src/core/clientLlmUtilities.ts packages/agents/src/core/streamResponseHelpers.ts packages/agents/src/core/MessageStreamOrchestrator.ts packages/agents/src/core/MessageStreamTerminalHandler.ts; then echo "FAIL: GeminiContent* barrel import in a fully-migrated P15 file"; exit 1; fi

# ---- MAJOR 4: P15-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 baseline artifact, this slice's OWNED structural-hit IDs (file + AST context) must DISAPPEAR.
# The NNa verifier reads the baseline (dev-docs/agents-neutral-gate-baseline.md per-file/per-site listing) and
# asserts EACH P15-owned hit ID is gone from the current --count detail, in ADDITION to the net-count ratchet:
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p15-byfile.txt   # per-file/per-site hit detail (P02 provides --by-file)
# HARD closure assertion (Major 5 — NOT a comment): FAIL if any P15-owned structural hit is still present.
# P15 owns the .parts/candidate.content reads in: clientHelpers.ts, clientLlmUtilities.ts, streamResponseHelpers.ts,
# MessageStreamOrchestrator.ts, MessageStreamTerminalHandler.ts, and ConversationManager consolidation.
# NOTE: client.ts:437-450 stripThoughts is split — the internal .parts mutation closes here, but the getHistory
# G1/G2 boundary hits (client.ts:421, ConversationManager.ts:419) are P21-owned and remain until P21, so this
# closure targets the NON-getHistory P15-owned sites by their specific line contexts.
if grep -nE "clientHelpers\.ts:|clientLlmUtilities\.ts:|streamResponseHelpers\.ts:|MessageStreamOrchestrator\.ts:|MessageStreamTerminalHandler\.ts:" /tmp/p15-byfile.txt; then echo "FAIL: P15-owned structural hit still present in --by-file"; exit 1; fi

# The AUTHORITATIVE net structural count (AST-context-aware) must ALSO strictly decrease vs the prior slice (Major 2 — mechanical):
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than the prior slice (P13) $prev"; exit 1; }
echo "PASS: P15 net --count $cur < prior slice $prev"

npm run typecheck && npm run build   # green cross-package (build-green checkpoint P15)
```

## Success Criteria
- EACH P15-OWNED REQ (005.1/.2/.3/.4/.5, 010.2) has its owning file(s) verified neutral per the inventory grep above (BY REQUIREMENT — P15 owns ONLY its sites; it does NOT claim the TurnProcessor/DirectMessageProcessor/hookToolRestrictions/turnLogging/streamChunkWrapper sites, which the P33 inventory-closure gate maps to their owning phases). `isValidResponse` deleted (last synthetic-fabricator survivor gone); no `GeminiContent*` imports remain in the FULLY-migrated files (excl. client.ts/ConversationManager.ts which finish P21); characterization green; BR-7/BR-5 preserved.
- **Site-specific closure (Major 4):** every P15-OWNED baseline structural-hit ID is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing.
- **getHistory staging (Major 3):** `getHistory` still returns `Content[]` (G1/G2 boundary conversions remain) — the return-type flip + G1/G2 deletion land in P21; build is GREEN at the P15 boundary (no cross-package caller broken).
- AST `--count` strictly decreased vs prior slice; monorepo build green.

## Failure Recovery
1. If P14 characterization goes red: a consolidation/thought/history boundary changed — restore behavior on `ContentBlock[]` (do NOT edit the P14 tests to pass).
2. If a residual `.parts`/`{role,parts}` remains: finish the retype per the §2A.4-II disposition; do NOT re-introduce a Google-shaped shim.
3. `git checkout --` the touched files (ConversationManager.ts, streamResponseHelpers.ts, clientLlmUtilities.ts, clientHelpers.ts, MessageStreamOrchestrator.ts, MessageStreamTerminalHandler.ts, client.ts) and re-apply.
4. Cannot proceed to Phase 16 until P14 green, build green, and the shrink-ratchet count decreased.

## Phase Completion Marker
`project-plans/issue2349/.completed/P15.md`.
