# Phase 23: Subagent slice — IMPL

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P23`

## Prerequisites
- Required: Phase 22 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P22" packages/agents/src`
- Expected files from previous phase: subagent-slice characterization tests (run, tool-response feed, nudges, non-interactive) — PASSING against current code.
- Preflight verification: Phase 0.5 completed (site map for `subagent*.ts` refreshed against P0.5 evidence, Minor 2).

## Requirements Implemented (Expanded)

### REQ-005.5a: Subagent group retyped to neutral (behavior identical)
**Full Text**: The subagent production files are migrated to neutral types with subagent run behavior unchanged and zero `@google/genai` imports; §2A.4-I(e) subagent `{role:'user',parts}` constructions become `IContent`/`ToolResponseBlock[]`.
**Behavior**:
- GIVEN: a subagent run
- WHEN: retyped
- THEN: behavior is identical (P22 tests green), types are neutral, and each file has zero `@google/genai` imports.
**Why This Matters**: eliminates the subagent structural surface — the first bulk source-swap risk from #2424 — behind a behavioral safety net.

## Implementation Tasks — exact per-file site map (MODIFY; P22 tests stay green)

| File | Current genai import | Sites to modify | Neutral replacement |
|---|---|---|---|
| `core/subagent.ts` | `:17` `Content`/`Part` | `:378-379` `{role:'user',parts:[{text:initialInstruction}]}`; `:686` `[{role:'user',parts:responseParts}]`; `:563` `currentMessages[0]?.parts` read | `IContent{speaker:'human'}` via `iContentFromAgentMessageInput`; `.parts` read → `AgentMessageInput`/`ContentBlock[]` |
| `core/subagentExecution.ts` | `:24` `Content`/`FunctionCall` | `:165`,`:195` `[{role:'user',parts:[{text:nudge}]}]` | `IContent{speaker:'human'}`; `FunctionCall`→`ToolCallBlock`/`ToolCallRequest` |
| `core/subagentNonInteractive.ts` | `:26` `FunctionCall`/`FunctionDeclaration`/`Content`; `:44` `chunkToParts` from `streamChunkWrapper` | `:365` `currentMessages[0]?.parts`; `:517` `initialMessages: Content[]` param; `:148` `getFunctionCallsFromParts`; **`:44`/`:143` `chunkToParts(chunk)` (C2 — STOP using `streamChunkWrapper`)** | `AgentMessageInput`/`ContentBlock[]`; param → `IContent[]` (OQ-12 initialMessages neutral); `getToolCallBlocks`; **`:143` consume `chunk.content.blocks` (`ContentBlock[]`) directly — DELETE the `chunkToParts` import (C2)** |

- Retype imports: `Content`→`IContent`, `Part`→`ContentBlock`, `FunctionCall`→`ToolCallBlock`/`ToolCallRequest`, `FunctionDeclaration`→`ToolDeclaration`.
- **C2 — remove the `streamChunkWrapper` consumer in `subagentNonInteractive.ts`:** replace `const parts = chunkToParts(chunk)` (`:143`) with block-based consumption of `chunk.content.blocks`, and DELETE the `import { chunkToParts } from './streamChunkWrapper.js'` (`:44`). After P23, `streamChunkWrapper.ts`'s ONLY remaining production importer is `executor-stream-processor.ts` (migrated + file DELETED in P25). Do NOT delete `streamChunkWrapper.ts` here — its executor consumer still exists.
- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P23`, `@requirement:REQ-005.5a`, `@requirement:REQ-002.3` (streamChunkWrapper consumer removal).

## Verification Commands
```bash
if grep -rn "@google/genai" packages/agents/src/core/subagent.ts packages/agents/src/core/subagentExecution.ts packages/agents/src/core/subagentNonInteractive.ts packages/agents/src/core/subagentToolProcessing.ts; then echo "FAIL: residual @google/genai in a P23 subagent file"; exit 1; fi
if grep -rnE "role: *'(user|model)'|\.parts\b" packages/agents/src/core/subagent*.ts | grep -v test; then echo "FAIL: Google-shaped {role}/.parts access in subagent group"; exit 1; fi
# C2 — subagentNonInteractive.ts no longer imports/calls streamChunkWrapper; executor-stream-processor.ts is now the LAST prod consumer (deleted in P25):
if grep -n "streamChunkWrapper\|chunkToParts" packages/agents/src/core/subagentNonInteractive.ts; then echo "FAIL: subagentNonInteractive.ts still uses streamChunkWrapper/chunkToParts"; exit 1; fi
# ONLY executor-stream-processor.ts may still reference these until P25:
scw=$(grep -rnE "chunkToParts|responseToModelStreamChunk" packages/agents/src --include=*.ts | grep -v test | grep -v "agents/executor-stream-processor\.ts")
if [ -n "$scw" ]; then echo "FAIL: chunkToParts/responseToModelStreamChunk outside executor-stream-processor.ts:"; echo "$scw"; exit 1; fi
test -f packages/agents/src/core/streamChunkWrapper.ts   # STILL PRESENT (deleted in P25 with its last consumer)
npm test -- packages/agents/src/core/__tests__/subagentRun.characterization.test.ts   # green
npm run typecheck && npm run build   # green cross-package
# ---- MAJOR 4: P23-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly the subagent-group structural-hit IDs; assert ABSENT now:
#   subagentExecution.ts:165/:195 {role:'user',parts} (F3); subagentToolProcessing.ts:484/:514 {role:'user',parts} (F3);
#   subagent.ts:378-379/:686 {role:'user',parts} (F3) + subagent.ts:563 currentMessages[0]?.parts (F5);
#   subagentNonInteractive.ts:365 currentMessages[0]?.parts (F5).
npx tsx scripts/agents-neutral-gate.ts --count --by-file   # per-site detail; assert EACH P23-owned baseline hit ID ABSENT, then remove from the baseline listing
# shrink-ratchet (M4 + Major 2 mechanical): AUTHORITATIVE AST counter (landed in P02) — AST-context-aware, allow-list-subtracted; net --count MUST be STRICTLY LOWER than the prior slice:
prev=$(grep -oE 'count=[0-9]+' dev-docs/agents-neutral-gate-baseline.md | tail -1 | cut -d= -f2)
cur=$(npx tsx scripts/agents-neutral-gate.ts --count)
test -n "$prev" || { echo "FAIL: no prior baseline count recorded"; exit 1; }
test "$cur" -lt "$prev" || { echo "FAIL(Major 2): net --count $cur not strictly lower than the prior slice $prev"; exit 1; }
echo "PASS: P23 net --count $cur < prior slice $prev"   # then update dev-docs/agents-neutral-gate-baseline.md to $cur
# (Optional ADVISORY only, scoped to THIS slice's files — never the pass/fail gate; the AST --count above is authoritative:)
grep -rEc "\{ *candidates:|role: *'model'|role: *'user'|\.parts\b|toGeminiContents\(|promptTokenCount|candidatesTokenCount" packages/agents/src/core/subagent*.ts | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | awk -F: '{s+=$2} END{print s}'
```

## Success Criteria
- Subagent group has zero `@google/genai`; no `{role,parts}`/`.parts`; P22 tests green; build green; structural-hit count strictly decreased vs. pre-slice (shrink-ratchet).
- **Site-specific closure (Major 4):** every P23-OWNED baseline structural-hit ID (the subagent*.ts `{role:'user',parts}` builders + `currentMessages[0]?.parts` reads) is ABSENT in `--by-file` output, in ADDITION to the net `--count` strictly decreasing; those IDs are removed from the baseline listing.

## Failure Recovery
If this phase fails (P22 red, build breaks, or ratchet not decreased):
1. `git checkout -- packages/agents/src/core/subagent.ts packages/agents/src/core/subagentExecution.ts packages/agents/src/core/subagentNonInteractive.ts packages/agents/src/core/subagentToolProcessing.ts`
2. Re-apply per the site map; do NOT edit P22 tests.
3. Cannot proceed to Phase 24 until P22 green, build green, and the ratchet decreased.

## Phase Completion Marker
`project-plans/issue2349/.completed/P23.md`.
