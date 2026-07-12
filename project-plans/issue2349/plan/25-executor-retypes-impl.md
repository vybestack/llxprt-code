# Phase 25: Executor slice — IMPL (incl. executor-prompt-builder OQ-12)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P25`

## Prerequisites
- Required: Phase 24 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P24" packages/agents/src`
- Expected files from previous phase: executor-slice characterization tests (initial msg, template application, tool feed, recovery) — PASSING against current code.
- Preflight verification: Phase 0.5 completed (site map for `executor*.ts` incl. `executor-prompt-builder.ts:47-58` refreshed against P0.5 evidence, Minor 2).

## Requirements Implemented (Expanded)

### REQ-005.5b: Executor group retyped to neutral (behavior identical); executor-prompt-builder OQ-12
**Full Text**: The executor production files are migrated to neutral types with executor behavior unchanged and zero `@google/genai` imports; the raw-import-free `.parts` mutator `executor-prompt-builder.ts:47-58` is retyped onto `IContent`/`ContentBlock[]`, and `PromptConfig.initialMessages?: Content[]` (`agents/types.ts:95`) + `applyTemplateToInitialMessages(initialMessages: Content[])` (`executor.ts:894-898`) migrate to neutral `IContent[]` (OQ-12 committed; no legacy adapter, no allow-list entry).
**Behavior**:
- GIVEN: an executor run + template application
- WHEN: retyped
- THEN: behavior is identical (P24 tests green), types are neutral, and each file has zero `@google/genai` imports (or, for `executor-prompt-builder.ts` which had none, zero structural `.parts` currency).
**Why This Matters**: eliminates the executor structural surface INCLUDING the raw-import-free bypass that grep-only gating misses.

### REQ-002.2 / REQ-003.1 (FILE deletes — C2): streamChunkWrapper.ts + providerStopReason.ts removed
**Full Text**: `streamChunkWrapper.ts` (whole file, §3.2 #1) and `providerStopReason.ts` (whole file) are DELETED in THIS phase — the last phase that removes their final references. `streamChunkWrapper.ts`'s last production consumer (`executor-stream-processor.ts` `chunkToParts`) is migrated above; `providerStopReason.ts`'s last reference (the `getProviderStopReason` READER inside `streamChunkWrapper.ts:112`) vanishes with the `streamChunkWrapper.ts` delete.
**Behavior**:
- GIVEN: all `streamChunkWrapper`/`chunkToParts` consumers migrated (turn/TurnProcessor P08, subagentNonInteractive P23, executor-stream-processor P25) and the `providerStopReason` WRITER removed (P13)
- WHEN: this phase deletes both files
- THEN: `test ! -f` succeeds for both, zero references remain (prod + test), and `npm run typecheck && npm run build` are green — proving neither delete dangles an import
**Why This Matters**: real dead-code removal (REQ-INT-004) staged to the last-consumer phase so no earlier phase leaves a red build (C2).

## Implementation Tasks — exact per-file site map (MODIFY; P24 tests stay green)

| File | Current genai import | Sites to modify | Neutral replacement |
|---|---|---|---|
| `agents/executor.ts` | `:19` (`Content`/`FunctionCall`/`GenerateContentConfig`/`FunctionDeclaration`) | `:224-225` `{role:'user',parts:[{text:query}]}`; `:894-898` `applyTemplateToInitialMessages(initialMessages: Content[])`; `:709-716` initialMessages usage | `IContent{speaker:'human'}`; param → `IContent[]`; config → `ModelGenerationSettings`; `FunctionDeclaration`→`ToolDeclaration` |
| `agents/types.ts` | `:11` `Content`/`FunctionDeclaration` | `:95` `initialMessages?: Content[]` (public schema) | `initialMessages?: IContent[]` (OQ-12, breaking-change note in JSDoc); `FunctionDeclaration`→`ToolDeclaration` |
| `agents/executor-prompt-builder.ts` | NONE (raw-import-free structural mutator) | `:47-58` `applyTemplateToInitialMessages<T extends {parts?}>` generic `.parts` mutation returning `{...content, parts:newParts}` | operate on `IContent`/`ContentBlock[]` — substitute template placeholders inside `TextBlock.text`; return new `IContent` (no `.parts`) |
| `agents/executor-stream-processor.ts` | `:13` (`Content`/`Part`/`FunctionCall`/`FunctionDeclaration`); `:21` `chunkToParts` from `streamChunkWrapper` | `:74` `message.parts` read; `:206` `getFunctionCallsFromParts`; **`:21`/`:191` `chunkToParts(chunk)` (C2 — STOP using `streamChunkWrapper`; this is its LAST production consumer)** | `AgentMessageInput`/`ContentBlock[]`; `getToolCallBlocks`; **`:191` consume `chunk.content.blocks` (`ContentBlock[]`) directly — DELETE the `chunkToParts` import (C2)** |
| `agents/recovery.ts` | `:21` `Content`/`FunctionCall` | `:117-120` `{role:'user',parts:[{text:prefix+suffix}]}` | `IContent{speaker:'human'}`; `FunctionCall`→`ToolCallBlock` |
| `agents/executor-tool-dispatch.ts` | `:20`/`:23` residual type-only (`Type` value swapped in P17) | `:513` `nextMessage:{role:'user',parts:toolResponseParts}` | `IContent{speaker:'tool'}`/`ToolResponseBlock[]`; `Schema`/`FunctionDeclaration`→`JsonSchema`/`ToolDeclaration` |

### DELETE `streamChunkWrapper.ts` (C2 — this is the LAST phase removing its final production consumer)
- After the `executor-stream-processor.ts` `chunkToParts` removal above, `packages/agents/src/core/streamChunkWrapper.ts` has ZERO production importers. DELETE the whole file (all exports `responseToIContent`/`responseToModelStreamChunk`/`chunkToParts`/`usageMetadataToUsageStats` — §3.2 #1). This is the deletion deferred from P08 (C2 build-order): the file could not be deleted earlier because `subagentNonInteractive.ts` (P23) and `executor-stream-processor.ts` (P25) still imported it.
- BEFORE deleting, ENUMERATE and prove zero remaining importers. Production importers (must ALL be migrated by now): `core/turn.ts` (P08), `core/TurnProcessor.ts` (P08), `core/subagentNonInteractive.ts` (P23), `agents/executor-stream-processor.ts` (P25, above). Test-helper importers that also reference it — `agents/executor-test-helpers.ts`, `core/subagent-test-helpers.ts`, `core/turn-test-helpers.ts` (comment only), `core/turn.tool-restrictions.test.ts` — MUST be migrated to `toModelStreamChunk`/neutral fixtures in the SAME phase (or already in P28) so the file delete leaves zero dangling imports; migrate any that remain here.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P25`, `@requirement:REQ-005.5b`, `@requirement:REQ-002.2` (streamChunkWrapper file deletion), `@requirement:REQ-INT-004` (real dead-code removal).

### DELETE `providerStopReason.ts` (C2 — co-located with the streamChunkWrapper.ts delete)
- `packages/agents/src/core/providerStopReason.ts`'s WRITER (`setProviderStopReason`) was removed in P13 (with `applyFinishReasonMapping`); its ONLY remaining reference is the READER `getProviderStopReason` at `streamChunkWrapper.ts:112`. Deleting `streamChunkWrapper.ts` above removes that last reader, so `providerStopReason.ts` now has ZERO references. DELETE the whole file HERE, in the SAME phase — this is the deletion deferred from P13 (C2 build-order): the file could not be deleted at P13 because `streamChunkWrapper.ts:112` still imported it.
- BEFORE deleting, prove zero remaining references: `grep -rn "providerStopReason\|getProviderStopReason\|setProviderStopReason" packages/agents/src --include=*.ts | grep -v test` ⇒ EMPTY (writer gone P13; reader gone with the streamChunkWrapper.ts delete above). Any test-file references migrate in P28 (or here if a test helper still imports it).
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P25`, `@requirement:REQ-003.1` (providerStopReason retired — FILE delete), `@requirement:REQ-INT-004` (real dead-code removal).

## Verification Commands
```bash
if grep -rl "@google/genai" packages/agents/src/agents/executor.ts packages/agents/src/agents/types.ts packages/agents/src/agents/executor-stream-processor.ts packages/agents/src/agents/recovery.ts packages/agents/src/agents/executor-tool-dispatch.ts; then echo "FAIL: residual @google/genai in a P25 executor file"; exit 1; fi
if grep -rnE "role: *'(user|model)'|\.parts\b" packages/agents/src/agents --include=*.ts | grep -v test; then echo "FAIL: Google-shaped {role}/.parts access in executor group (incl. executor-prompt-builder)"; exit 1; fi
grep -n "initialMessages?: IContent\[\]" packages/agents/src/agents/types.ts   # migrated to neutral (OQ-12) — diagnostic; typecheck authoritative
# C2 — streamChunkWrapper.ts DELETED here (last production consumer gone); prove ZERO importers (prod AND test) before/after:
if grep -rnE "chunkToParts|responseToModelStreamChunk|responseToIContent|from '\.?\.?/?.*streamChunkWrapper" packages/agents/src --include=*.ts; then echo "FAIL: streamChunkWrapper still referenced anywhere in agents"; exit 1; fi
test ! -f packages/agents/src/core/streamChunkWrapper.ts   # DELETED (C2 — deferred from P08 until its final consumer migrated)
# C2 — providerStopReason.ts DELETED here too (its last reader was streamChunkWrapper.ts:112, removed by the delete above):
if grep -rnE "providerStopReason|getProviderStopReason|setProviderStopReason" packages/agents/src --include=*.ts | grep -v test; then echo "FAIL: providerStopReason still referenced after P25 delete"; exit 1; fi
test ! -f packages/agents/src/core/providerStopReason.ts   # DELETED (C2 — deferred from P13 until its last reader inside streamChunkWrapper.ts was removed)
npm test -- packages/agents/src/agents/__tests__/executorRun.characterization.test.ts   # green
npm run typecheck && npm run build   # green cross-package (proves the deletion broke nothing — the C2 guarantee)
# ---- MAJOR 4: P25-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly the executor-group structural-hit IDs; assert ABSENT now:
#   executor.ts:224-225 {role:'user',parts} (F3); recovery.ts:117-120 {role:'user',parts} (F3);
#   executor-tool-dispatch.ts:513 {role:'user',parts} tool-response feed (F3);
#   executor-prompt-builder.ts:47-58 generic `content.parts` mutator — THE raw-import-free #2424 case (F5, OQ-12);
#   executor-stream-processor.ts:74 message.parts read (F5).
npx tsx scripts/agents-neutral-gate.ts --count --by-file   # per-site detail; assert EACH P25-owned baseline hit ID (esp. executor-prompt-builder.ts:47-58) ABSENT, then remove from the baseline listing
# shrink-ratchet (M4 + Major 2 mechanical): AUTHORITATIVE AST counter (landed in P02) — AST-context-aware, allow-list-subtracted; net --count MUST be STRICTLY LOWER than the prior slice:
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than the prior slice $prev"; exit 1; }
echo "PASS: P25 net --count $cur < prior slice $prev"   # then update dev-docs/agents-neutral-gate-baseline.md to $cur
# (Optional ADVISORY only, scoped to THIS slice's files — never the pass/fail gate:)
grep -rEc "\{ *candidates:|role: *'model'|role: *'user'|\.parts\b|toGeminiContents\(|promptTokenCount|candidatesTokenCount" packages/agents/src/agents --include=*.ts | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | awk -F: '{s+=$2} END{print s}'
```

## Success Criteria
- Executor group zero `@google/genai`; `executor-prompt-builder` operates on blocks (no `.parts`); `PromptConfig.initialMessages` neutral `IContent[]`; P24 tests green; build green; ratchet decreased.
- **C2 — `streamChunkWrapper.ts` DELETED** (deferred from P08): every production importer (`turn.ts`/`TurnProcessor.ts` P08, `subagentNonInteractive.ts` P23, `executor-stream-processor.ts` P25) and every test-helper importer is migrated, zero references remain, the file is gone, and `npm run typecheck && npm run build` are green — the concrete proof that the deletion was correctly deferred to the last-consumer phase.
- **C2 — `providerStopReason.ts` DELETED** (deferred from P13): its WRITER was removed in P13 and its last READER lived inside `streamChunkWrapper.ts:112`; deleting `streamChunkWrapper.ts` here removes that reader, so `providerStopReason.ts` now has zero references and is deleted in the SAME phase. Build green proves no dangling import.
- **Site-specific closure (Major 4):** every P25-OWNED baseline structural-hit ID (executor.ts / recovery.ts / executor-tool-dispatch.ts `{role:'user',parts}`, the raw-import-free `executor-prompt-builder.ts:47-58` `.parts` mutator, executor-stream-processor.ts `message.parts`, AND the `streamChunkWrapper.responseToIContent` `.parts`/`candidate.content` hit closed by the file DELETE) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing; those IDs are removed from the baseline listing.

## Failure Recovery
1. `git checkout -- packages/agents/src/agents/executor.ts packages/agents/src/agents/types.ts packages/agents/src/agents/executor-prompt-builder.ts packages/agents/src/agents/executor-stream-processor.ts packages/agents/src/agents/recovery.ts packages/agents/src/agents/executor-tool-dispatch.ts`
2. If the `streamChunkWrapper.ts` deletion caused a build break: a production or test importer was NOT migrated first — `git checkout -- packages/agents/src/core/streamChunkWrapper.ts` to restore it, migrate the remaining importer, THEN re-delete. Do NOT delete the file while any importer remains (that is the exact C2 build-break).
3. If the `providerStopReason.ts` deletion caused a build break: a reference still remained (the `streamChunkWrapper.ts:112` reader was not removed, or a test helper still imports it) — `git checkout -- packages/agents/src/core/providerStopReason.ts`, remove the remaining reference, THEN re-delete. `providerStopReason.ts` MUST be deleted only after `streamChunkWrapper.ts` (its last reader) is gone.
4. Re-apply per the site map; do NOT edit P24 tests.
5. Cannot proceed to Phase 26 until P24 green, build green, ratchet decreased, and BOTH `streamChunkWrapper.ts` + `providerStopReason.ts` deleted with zero dangling importers.

## Phase Completion Marker
`project-plans/issue2349/.completed/P25.md`.
