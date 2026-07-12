# Phase 08a: TurnProcessor + Turn IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P08a`

## Prerequisites
- Required: Phase 08 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms REQ-002.2 (TurnProcessor `wrapChunk` yields `ModelStreamChunk` directly; `TurnProcessor.ts`/`turn.ts` STOP importing/calling `streamChunkWrapper` — the FILE is deleted in P25, NOT here, per C2), REQ-002.3 (Turn operates on `ContentBlock[]`/`ToolCallBlock`; `chunkToParts` gone from `turn.ts`), REQ-001.4 (AFC recorded from `afcHistory`, no `toGeminiContents`/`toIContent` round-trip), and REQ-003.1 (stop reason from `chunk.rawStopReason`, #2329). NOTE: `sendMessage` STILL returns `GenerateContentResponse` here — the flip to `ModelOutput` is deferred to P13 (C4) so the build stays green; verify that deferral, not a premature flip.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-002.2/.3** — **GIVEN:** the P08-modified `TurnProcessor.ts`/`turn.ts`; **WHEN:** the verifier greps for `streamChunkWrapper`/`chunkToParts` usage and traces one chunk from `wrapChunk` into `Turn`; **THEN:** `wrapChunk` yields `ModelStreamChunk` directly and `Turn` operates on `ContentBlock[]`/`ToolCallBlock` with ZERO `chunkToParts` calls (the `streamChunkWrapper.ts` FILE still exists — deleted P25); FAIL on any `chunkToParts` call or a re-derived `Part[]` in `turn.ts`.
- **REQ-001.4** — **GIVEN:** an AFC-bearing turn; **WHEN:** AFC recording is traced; **THEN:** AFC rides `ModelOutput.afcHistory`/`IContent[]` with no `toGeminiContents`/`toIContent` round-trip; FAIL on a Gemini round-trip.
- **REQ-003.1** — **GIVEN:** a provider raw stop reason (#2329 refusal); **WHEN:** the finish path is traced; **THEN:** `Finished.stopReason` derives from `chunk.rawStopReason`; FAIL if it depends on the bolted-on `Candidate.providerStopReason`.
- **C4 deferral** — **GIVEN:** `sendMessage` at P08; **WHEN:** its return type is inspected; **THEN:** it STILL returns `GenerateContentResponse` (flip deferred to P13); FAIL on a premature `ModelOutput` flip here (would break un-migrated co-consumers).

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P06 characterization tests green; public `ServerAgentStreamEvent`/`StreamEvent` shapes UNCHANGED (RISK-1) — diff the event-type declarations, expect no change.
- [ ] `TurnProcessor.ts` + `turn.ts` STOP importing/calling `streamChunkWrapper` (no `chunkToParts` / `responseToModelStreamChunk` / `getProviderStopReason` in those two files). The `streamChunkWrapper.ts` FILE still EXISTS (deleted in P25 with its last production consumer — C2): `test -f packages/agents/src/core/streamChunkWrapper.ts` MUST still succeed here; `grep -rnE "chunkToParts|responseToModelStreamChunk" packages/agents/src --include=*.ts | grep -v test` still shows `subagentNonInteractive.ts` (P23) + `executor-stream-processor.ts` (P25). FAIL this phase if the file was prematurely deleted (that breaks the P23/P25 importers).
- [ ] Pseudocode compliance vs `turnprocessor-turn-wrap.md` lines 10-53.
- [ ] **DEFERRAL CHECK (C2):** `TurnProcessor.sendMessage` STILL returns `Promise<GenerateContentResponse>` at the end of P08 — the flip to `ModelOutput` is EXPECTED to be deferred to P13 (the phase that neutralizes the direct path). Trace the return type and CONFIRM it is unchanged here:
      `grep -n "sendMessage" packages/agents/src/core/TurnProcessor.ts | grep -q "GenerateContentResponse" && echo "sendMessage still Google-shaped (EXPECTED until P13)"`.
      FAIL this phase if `sendMessage` was prematurely flipped to `ModelOutput` (that would break the still-Google direct path before P13). The `sendMessage returns ModelOutput` assertion belongs to **P13a only**.
- [ ] AFC recorded from `afcHistory` (no `toGeminiContents`/`toIContent` round-trip) — BR-8.
- [ ] `stopReason` sourced from `chunk.rawStopReason` (#2329, BR-3).
- [ ] `isProviderApiError` replaces `ApiError`.
- [ ] No `@google/genai` in `turn.ts`/`TurnProcessor.ts`; deferred-impl scan clean; lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace chunk → wrapChunk → StreamEvent → Turn.processStreamChunk (blocks) → emitted events. Confirm no Part[] re-derivation. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P08a.md`.
