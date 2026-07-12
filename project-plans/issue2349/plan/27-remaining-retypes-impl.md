# Phase 27: Remaining group — IMPL (ZERO prod @google/genai imports checkpoint)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P27`

## Prerequisites
- Required: Phase 26 completed (safety net green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P26" packages/agents/src`
- Expected files from previous phase: remaining-group characterization tests (compression, agenticLoop cancelled-tool, api session-control, TodoContinuation, chatSession) — PASSING against current code.
- Preflight verification: Phase 0.5 completed.

## Requirements Implemented (Expanded)

### REQ-005.5c: Remaining group retyped to neutral (behavior identical)
**Full Text**: The remaining RETYPE production files are migrated to neutral types with behavior unchanged and zero `@google/genai` imports. After this phase, `grep -rl "@google/genai" packages/agents/src | grep -v test` is EMPTY — satisfying the zero-remaining-prod-imports precondition for REQ-013.1 and the dead-code-removal invariant REQ-INT-004.
**Behavior**:
- GIVEN: each subsystem's public behavior
- WHEN: retyped
- THEN: behavior is identical (P26 tests green) and each file has zero `@google/genai` imports.
**Why This Matters**: reaches the ZERO-prod-imports state that unblocks the enforcement gate (P29-P31) and dependency removal (P32).

## Implementation Tasks — exact per-file site map (MODIFY; P26 tests stay green)

| File | Current genai import | Neutral replacement |
|---|---|---|
| `compression/CompressionHandler.ts` `:9` | `GenerateContentConfig` | `ModelGenerationSettings` |
| `compression/compressionBudgeting.ts` `:9` | `GenerateContentConfig` | `ModelGenerationSettings` |
| `compression/providerContentEnforcement.ts` `:7` | `GenerateContentConfig` | `ModelGenerationSettings` |
| `core/agenticLoop/AgenticLoop.ts` `:36` | `PartListUnion` | `AgentMessageInput` (neutral request DTO) |
| `core/agenticLoop/loopHelpers.ts` `:16` | `Part` | `ContentBlock`; `:110-117` `addHistory({role:'model',parts:functionCalls})` + `{role:'user',parts:[...functionResponses,...otherParts]}` → `IContent{speaker:'ai'|'tool'}` with `ToolCallBlock`/`ToolResponseBlock` |
| `core/agenticLoop/types.ts` `:13` | `PartListUnion` | `AgentMessageInput` |
| `api/agent.ts` `:7` | `Content`/`Part` | `IContent`/`ContentBlock` |
| `api/agentBootstrap.ts` `:18` | `PartListUnion`/`Part` | `AgentMessageInput`/`ContentBlock` |
| `api/control/sessionControl.ts` `:29` | `Content` | `IContent` (inbound `toIContent` becomes no-op once history is neutral) |
| `core/TodoContinuationService.ts` `:7` | `PartListUnion`/`Part` | `AgentMessageInput`/`ContentBlock` |
| `core/chatSession.ts` `:16` | `Content`/`GenerateContentConfig`/`GenerateContentResponse`/`SendMessageParameters`/`Tool`/`PartListUnion` | `IContent`/`ModelGenerationSettings`/`ModelOutput`/neutral request DTO/`ToolDeclaration`/`AgentMessageInput` |
| `core/ChatSessionFactory.ts` `:7` | `Content`/`GenerateContentConfig`/`Tool` | `IContent`/`ModelGenerationSettings`/`ToolDeclaration` (inbound `toIContent:183` no-op once history neutral) |
| `core/clientToolGovernance.ts` `:7` | `FunctionDeclaration` | `ToolDeclaration` |
| `core/streamCleanup.ts` `:7` | `GenerateContentResponse` | generic over `ModelStreamChunk` |
| `core/turnAbortHelpers.ts` `:19` | `SendMessageParameters` | neutral request DTO param |
| `core/MessageStreamOrchestrator.ts`, `MessageStreamTerminalHandler.ts`, `streamRequestHelpers.ts` (residual) | `PartListUnion`/`Part`/`Content` | finish any residual retype from P08/P15/P18 |

- Markers `@plan:PLAN-20260707-AGENTNEUTRAL.P27`, `@requirement:REQ-005.5c` (also satisfies REQ-013.1 precondition + REQ-INT-004).

## Verification Commands
```bash
# ZERO prod @google/genai imports across the WHOLE agents package (the checkpoint):
if grep -rl "@google/genai" packages/agents/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__"; then echo "FAIL: production @google/genai importer remains after P27"; exit 1; fi
# Structural {role}/.parts: the AST gate --count (below/NNa) is the AUTHORITATIVE gate (it allow-lists the G3
# hook adapter). This grep is DIAGNOSTIC to surface any NON-adapter site for the verifier to inspect:
grep -rnE "role: *'(user|model)'|\.parts\b" packages/agents/src --include=*.ts | grep -v test | grep -v "core/streamRequestHelpers\.ts" || echo "(diagnostic: no non-adapter structural site)"
npm test -- packages/agents   # green
npm run typecheck && npm run build   # green cross-package
# ---- MAJOR 4: P27-OWNED structural-hit IDENTITY closure (site-specific, not just net-count) ----
# From the P02/P0.5 frozen --by-file baseline, this slice OWNS exactly the remaining-group structural-hit IDs; assert ABSENT now:
#   loopHelpers.ts:110-117 recordCancelledToolHistory {role:'model'/'user',parts} (F3);
#   ConversationManager.ts:34-40 appendTextContentParts `.parts` mutation (F5), :330-345 _consolidateModelOutput,
#     :272-282 _recordOutputContent thought filter/extract (F5), :306/:310 {role:'model',parts:[]} (F3);
#   client.ts:437-450 setHistory/stripThoughts `.parts` mutation (F5), :667-668 {role:'user',parts} (F3);
#   clientHelpers.ts:42-66 `.parts` reads (F5); clientLlmUtilities.ts:61-92 `.parts` reads (F5);
#   MessageStreamOrchestrator.ts:333 `.parts?.some` (F5), :341-342 {role:'user',parts} (F3);
#   MessageConverter.ts:242-333 isValidContent/extractCuratedHistory/hasTextContent `.parts`/role reads (F5);
#   sessionControl.ts:218/:314 toIContent inbound (retyped); TodoContinuation/chatSession/compression retypes.
# NOTE: the ONLY hits permitted to REMAIN at the floor are the G3 hook-wire adapter (streamRequestHelpers.ts:228,
#   allow-listed IFF OQ-1a) and the api/ boundary telemetry — both ALLOW-LISTED, never open hits.
# HARD closure assertion (Major 5 — NOT a comment): store the per-site listing and FAIL if any P27-owned
# forbidden owned-hit ID (any non-allow-listed structural site in the remaining-group files below) is present.
npx tsx scripts/agents-neutral-gate.ts --count --by-file > /tmp/p27-byfile.txt
# The ONLY files permitted to appear in --by-file at the floor are the allow-listed G3 hook adapter
# (streamRequestHelpers.ts) and the api/ boundary telemetry. A hit in ANY P27-owned remaining-group file FAILS:
if grep -nE "loopHelpers\.ts:|ConversationManager\.ts:|(^|/)client\.ts:|clientHelpers\.ts:|clientLlmUtilities\.ts:|MessageStreamOrchestrator\.ts:|MessageConverter\.ts:|sessionControl\.ts:|TodoContinuationService\.ts:|CompressionHandler\.ts:|compressionBudgeting\.ts:|providerContentEnforcement\.ts:|AgenticLoop\.ts:|turnAbortHelpers\.ts:|streamCleanup\.ts:|clientToolGovernance\.ts:|ChatSessionFactory\.ts:" /tmp/p27-byfile.txt; then echo "FAIL: P27-owned structural hit still present in --by-file"; exit 1; fi
# shrink-ratchet (M4): AUTHORITATIVE AST counter (landed in P02, Major 4/5) — AST-context-aware, allow-list-subtracted:
npx tsx scripts/agents-neutral-gate.ts --count   # reaches target FLOOR (only bounded G3 hook-wire + boundary telemetry remain, both allow-listed); update dev-docs/agents-neutral-gate-baseline.md
# (Optional ADVISORY only, whole-package sanity — never the pass/fail gate; the AST --count above is authoritative:)
grep -rEc "\{ *candidates:|role: *'model'|role: *'user'|\.parts\b|toGeminiContents\(|promptTokenCount|candidatesTokenCount" packages/agents/src --include=*.ts | grep -v -E "\.(test|spec)\.|test-helpers|__tests__" | awk -F: '{s+=$2} END{print s}'
```

## Success Criteria
- ZERO `@google/genai` imports in `packages/agents/src` production; all agents tests green (pre-test-migration); build green; ratchet at target floor.
- **Site-specific closure (Major 4):** every P27-OWNED baseline structural-hit ID (loopHelpers cancelled-tool builders, ConversationManager consolidation/thought/`.parts` mutation, client.ts stripThoughts/`{role,parts}`, clientHelpers/clientLlmUtilities `.parts` reads, MessageStreamOrchestrator, MessageConverter validity/curated/text helpers) is ABSENT in `--by-file` output; the ONLY remaining hits are the centrally allow-listed G3 hook-wire adapter + api/ boundary telemetry; the net `--count` is at the bounded floor.

## Failure Recovery
1. `git checkout --` the touched files in the site map.
2. Re-apply per the site map; do NOT edit P26 tests.
3. Cannot proceed to Phase 28 until zero prod imports, build green, and P26 tests green.

## Phase Completion Marker
`project-plans/issue2349/.completed/P27.md`.
