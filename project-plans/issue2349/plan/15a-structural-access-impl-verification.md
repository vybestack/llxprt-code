# Phase 15a: Structural-access IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P15a`

## Prerequisites
- Required: Phase 15 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
This phase verifies the FULL §2A.4-II inventory BY REQUIREMENT: **REQ-005.1** (ConversationManager consolidation BR-7 + thought-filter BR-5 + getHistory clone), **REQ-005.2** (clientLlmUtilities next_speaker on blocks, OQ-3s), **REQ-005.3** (streamResponseHelpers accumulation on blocks + `isValidResponse` deletion), **REQ-005.4** (MessageStreamOrchestrator/TerminalHandler pending-tool-call on `ToolCallBlock`), **REQ-005.5** (clientHelpers compress-split + client.stripThoughts on blocks), **REQ-010.1** (toGeminiContents G1/G2 deleted), **REQ-010.2** (no `GeminiContent*` imports in migrated files) — plus the deletion of the FINAL synthetic-fabricator survivor `isValidResponse` (deferred from P13). The verifier checks each REQ's owning file(s) with the P15 inventory-by-requirement greps, NOT a single grouped grep over three files.

**Line-number freshness FIRST (Minor 2):** BEFORE any check below, compare every line range cited in P15 / this phase (the §2A.4-II reader/mutator sites in `ConversationManager.ts`/`clientHelpers.ts`/`clientLlmUtilities.ts`/`client.ts`/`MessageStreamOrchestrator.ts`/`streamResponseHelpers.ts` and `streamResponseHelpers.ts:109`'s `isValidResponse` caller) against `.completed/P0.5.md`; FAIL immediately if the P0.5 marker is absent or any cited range drifted without a phase-file update.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.1** — **GIVEN:** the P15-modified `ConversationManager.ts`; **WHEN:** consolidation/thought-filter/getHistory are traced against BR-7/BR-5; **THEN:** adjacent `TextBlock`s merge at the same boundaries, `ThinkingBlock` filtering preserves behavior, and `getHistory` returns a clone of neutral `IContent[]` (no `.parts` mutation); FAIL on any `.parts` mutation or a live-reference return.
- **REQ-005.2/.5** — **GIVEN:** `clientLlmUtilities.ts`/`clientHelpers.ts`/`client.ts`; **WHEN:** next_speaker text-extraction, compress-split, and `stripThoughts` are traced; **THEN:** all operate on `ContentBlock[]`/`TextBlock`/`ThinkingBlock` (no `content.parts` read/mutate); FAIL on any `.parts` access.
- **REQ-005.3 (+ isValidResponse deletion)** — **GIVEN:** `streamResponseHelpers.ts`; **WHEN:** accumulation is traced and `isValidResponse` is grepped; **THEN:** accumulation is block/`CanonicalFinishReason`-based and `isValidResponse` is GONE with its last caller (`grep` EMPTY); FAIL if `isValidResponse` survives.
- **REQ-005.4** — **GIVEN:** `MessageStreamOrchestrator.ts`/`MessageStreamTerminalHandler.ts`; **WHEN:** pending-tool-call detection is traced; **THEN:** it keys on `ToolCallBlock` presence on the neutral last `IContent`; FAIL on a `.parts.some('functionCall' in p)` read.
- **REQ-010.1/.2** — **GIVEN:** the migrated files; **WHEN:** greps for `toGeminiContents`/`GeminiContent*`; **THEN:** G1/G2 `toGeminiContents` are deleted and no `GeminiContent*` import remains; FAIL on any residual.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P14 characterization tests green (BR-7 consolidation + BR-5 thought-filter preserved).
- [ ] **Inventory BY REQUIREMENT (Major 2):** run EACH of the P15 §2A.4-II per-requirement greps (REQ-005.1 ConversationManager; REQ-005.2 clientLlmUtilities; REQ-005.3 streamResponseHelpers; REQ-005.4 MessageStreamOrchestrator/TerminalHandler; REQ-005.5 clientHelpers/client.stripThoughts) — each returns none. Do NOT accept a single grouped grep over three files.
- [ ] **REQ-010.1 (Major 3 — G1/G2 DEFERRED to P21, do NOT assert "gone" here):** `client.ts`/`ConversationManager.ts` MAY still contain the single `getHistory`-boundary `toGeminiContents` call (G1 at `client.ts:420-422`, G2 at `ConversationManager.ts:412-424`) — these are deleted in P21 with the return-type flip and cross-package callers. Assert only that NO OTHER `toGeminiContents` call was added on this slice's fully-migrated files, and that `getHistory` STILL returns `Content[]` here (the flip is P21). The G1/G2 deletion is verified in **P21a**, not here.
- [ ] REQ-010.2: no `GeminiContent*` imports in this slice's FULLY-migrated files (`clientLlmUtilities.ts`, `streamResponseHelpers.ts`, `MessageStreamOrchestrator.ts`, `MessageStreamTerminalHandler.ts`, `clientHelpers.ts`). `client.ts`/`ConversationManager.ts` retain their `getHistory`-boundary `Content`/`GeminiContent*`/`toGeminiContents` usage until P21 — their import removal is asserted in P21a (Major 3), not here.
- [ ] Each touched function carries `@requirement:` its owning REQ (005.1..5.5 / 010.2): `grep -rnE "@requirement:REQ-(005\.[1-5]|010\.2)" packages/agents/src/core/{ConversationManager,clientLlmUtilities,streamResponseHelpers,MessageStreamOrchestrator,MessageStreamTerminalHandler,clientHelpers,client}.ts`. (REQ-010.1/G1/G2 markers land in P21, not P15.)
- [ ] `client.getHistory` still awaits idle + returns a clone (behavior preserved) AND still returns `Content[]` (internal consolidation/thought reimplemented on blocks; public return-type flip is P21 — Major 3).
- [ ] Stateless helpers retyped neutral (OQ-3s), not shimmed.
- [ ] `MessageConverter.isValidResponse` DELETED — `grep -rn "isValidResponse" packages/agents/src | grep -v test` ⇒ EMPTY (last synthetic-fabricator survivor gone; its `streamResponseHelpers.ts:109` caller replaced by a neutral block-presence check).
- [ ] Monorepo `npm run typecheck && npm run build` green.
- [ ] Deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace adjacent-text consolidation on ContentBlock[]. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P15a.md`.
