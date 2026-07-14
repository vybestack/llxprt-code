# Phase 13a: DirectMessageProcessor IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P13a`

## Prerequisites
- Required: Phase 13 completed.

## Prerequisites
- Required: Phase 13 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P13" packages/agents/src`
- Expected files from previous phase: `DirectMessageProcessor.ts`, `TurnProcessor.ts`, `MessageConverter.ts`, `StreamProcessor.ts`, `beforeModelHookDecision.ts`, `streamRequestHelpers.ts` (all neutralized); `beforeModelBlockingCompat.ts` DELETED; `providerStopReason.ts` WRITER removed but FILE STILL PRESENT (deleted P25 with `streamChunkWrapper.ts` — C2).
- Preflight verification: Phase 0.5 completed.

## Requirements Implemented (Expanded)
This phase verifies **REQ-004.1/.2/.3** (direct path returns `ModelOutput` on both paths; block-based text extraction; `sendMessage` returns `ModelOutput`), **REQ-001.4** (direct-path neutral AFC), and the **FINAL** synthetic-fabricator deletion — BOTH the provider-output fabricator (**REQ-002.4**) AND the before-model blocking-hook synthetic path deferred from P07 (C3) — plus the `providerStopReason` WRITER removal (the FILE delete is deferred to P25 with `streamChunkWrapper.ts`, C2) — the C3/C4 fix landing point.

**C1 (verify explicitly):** the TYPE-SURFACE assertions (return type is now `ModelOutput`; no synthetic response fabricated) are proven HERE against the flipped code — NOT in P12 (which characterized observable behavior only). Confirm the P12 characterization tests still pass and now the return type is `ModelOutput`.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-004.1/.2 (direct path → ModelOutput; block-based text)** — **GIVEN:** the P13-flipped `DirectMessageProcessor.ts` + P12 characterization; **WHEN:** the verifier traces the blocking + normal paths and greps for `{candidates}`/`.parts`/`candidate.content`; **THEN:** both paths return neutral `ModelOutput`, text is read via `getResponseTextFromBlocks`, no synthetic `{candidates}` is fabricated, and P12 stays green; FAIL on any synthetic cast/`candidate.content.parts` read.
- **REQ-004.3 (sendMessage → ModelOutput)** — **GIVEN:** `TurnProcessor.sendMessage`; **WHEN:** the type-level API-shape test + `npm run typecheck` run; **THEN:** awaited `sendMessage(...)` is assignable to `ModelOutput` and NOT to `GenerateContentResponse`; FAIL if any residual `GenerateContentResponse` consumer typechecks.
- **REQ-002.4 final (fabricator + before-model synthetic deletion; staged survivors)** — **GIVEN:** the whole agents tree post-P13; **WHEN:** greps for `convertIContentToResponse`/`patchMissingFinishReason`/`.syntheticResponse`/`getModifiedResponse() as GenerateContentResponse`; **THEN:** all are EMPTY in agents production, `AgentExecutionBlockedError` carries neutral `blockedOutput?: ModelOutput`, exactly ONE VALIDATOR `isValidResponse` survives (dies P15), and `providerStopReason.ts`/`streamChunkWrapper.ts` FILES survive to P25 (C2); FAIL if a fabricator/synthetic path remains, or a staged survivor was prematurely deleted.
- **REQ-001.4 (direct-path neutral AFC)** — **GIVEN:** provider AFC on the direct path; **WHEN:** AFC recording is traced; **THEN:** it rides `ModelOutput.afcHistory` with the provider-metadata AFC read deleted; FAIL on a provider-metadata AFC read.

Follow `plan/verification-template.md`. Specifics:

**Line-number freshness FIRST (Minor 2):** BEFORE running any check below, compare EVERY line range cited in P13 / this phase (`DirectMessageProcessor.ts`, `chatSession.ts` `AgentExecutionBlockedError` `:96-118`, `TurnProcessor.ts:273-283` reader, `beforeModelHookDecision.ts:38-77`, `StreamProcessor.ts:711-726`/`:378-383`, `streamRequestHelpers.ts:162-169`, `MessageConverter.ts:518-543`/`:550`/`:634`, `directmessageprocessor-neutral.md` ranges) against `.completed/P0.5.md`; FAIL this phase immediately if the P0.5 marker is absent OR any cited range drifted without a corresponding phase-file update (per verification-template §2).

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P12 characterization tests green (blocking + normal paths; OQ-14 reasoningTokens; BR-8 AFC).
- [ ] BOTH direct fabricators deleted (`_buildBlockingSyntheticResponse`, after-model `convertIContentToResponse`); no `{candidates}`/`.parts`/`candidate.content` in `DirectMessageProcessor.ts`.
- [ ] **C4:** `TurnProcessor.sendMessage` now returns `Promise<ModelOutput>` (trace the type); `_commitSendResult` consumes neutral output; no `GenerateContentResponse` leaves `TurnProcessor`.
- [ ] **C3 final (provider-output fabricator):** `convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping` DELETED with ZERO remaining callers (`grep -rn "convertIContentToResponse" packages/agents/src | grep -v test` ⇒ EMPTY). `chatSession.convertIContentToResponse` facade (`:560-561`) + `client.ts:781` neutralized.
- [ ] **C3 final (before-model blocking-hook synthetic path, deferred from P07):** `_patchMissingFinishReason` (StreamProcessor) + `streamRequestHelpers.patchMissingFinishReason` DELETED (`grep -rn "patchMissingFinishReason" packages/agents/src | grep -v test` ⇒ EMPTY); `enforceBeforeModelHookDecision` retyped (no `PatchFinishReasonFn`/`GenerateContentResponse`); `StreamProcessor.ts` now has ZERO `GenerateContentResponse`/`FinishReason` (`grep -n "GenerateContentResponse\|FinishReason" packages/agents/src/core/StreamProcessor.ts` ⇒ EMPTY). Blocking behavior preserved (P10 side-channel + P12 direct characterization green).
- [ ] **C3 final (shared `AgentExecutionBlockedError` transport retype + AfterModel BLOCK branch, deferred from P07):**
  - Field retyped: `grep -nE "syntheticResponse\s*\??:\s*GenerateContentResponse" packages/agents/src/core/chatSession.ts` ⇒ EMPTY; `grep -nE "blockedOutput\s*\??:\s*ModelOutput" packages/agents/src/core/chatSession.ts` ⇒ PRESENT. `AgentExecutionStoppedError` unchanged (no payload).
  - No `.syntheticResponse` anywhere in agents production: `grep -rnE "\.syntheticResponse" packages/agents/src --include=*.ts | grep -v test` ⇒ EMPTY (all three BLOCK writers — streaming AfterModel, before-model, direct — pass the neutral `blockedOutput`).
  - No `getModifiedResponse() as GenerateContentResponse` anywhere in agents production: `grep -rnE "getModifiedResponse\(\) *as *GenerateContentResponse|getSyntheticResponse\(\) *as *GenerateContentResponse" packages/agents/src --include=*.ts | grep -v test` ⇒ EMPTY (the AfterModel BLOCK-branch cast deferred from P07 is now gone).
  - Reader updated: `grep -nE "error\.syntheticResponse" packages/agents/src/core/TurnProcessor.ts` ⇒ EMPTY; the `TurnProcessor.ts:273-283` catch consumes `error.blockedOutput` and yields a neutral chunk (no `wrapChunk(GenerateContentResponse)`).
  - Adapter export added HERE (not P07): `grep -nE "afterModelBlockingToModelOutput" packages/agents/src/core/hookWireAdapter.ts` ⇒ PRESENT; the streaming BLOCK branch routes through it.
- [ ] **C4/Major 6:** `beforeModelBlockingCompat.ts` DELETED (`test ! -f packages/agents/src/core/beforeModelBlockingCompat.ts`); its `dev-docs/agents-neutral-gate-allowlist.md` entry removed (`grep -nE "beforeModelBlockingCompat" dev-docs/agents-neutral-gate-allowlist.md` ⇒ EMPTY) AND absent from `--by-file` (`npx tsx scripts/agents-neutral-gate.ts --count --by-file | grep beforeModelBlockingCompat` ⇒ EMPTY). The reintroduction guard is MECHANICALLY tied to the deletion: P13 RAN the named `scripts/__tests__/fixtures/reintroduced-blocking-compat.ts` fixture against the real gate via `--files` AFTER the entry was removed and it exited NON-ZERO (freed slot cannot exempt a same-shape helper) — confirm the pasted P13 evidence shows the `PASS(Major 6)` line, not merely that a fixture file exists.
- [ ] **C2:** `providerStopReason` WRITER removed (`grep -rn "setProviderStopReason" packages/agents/src | grep -v test` ⇒ EMPTY) but the FILE STILL EXISTS (`test -f packages/agents/src/core/providerStopReason.ts` succeeds) — the READER `getProviderStopReason` at `streamChunkWrapper.ts:112` survives until the co-located P25 file delete; `grep -rn "providerStopReason" packages/agents/src | grep -v test` ⇒ ONLY `streamChunkWrapper.ts:112` + the file. CONFIRM it was NOT prematurely deleted (that would dangle the reader import).
- [ ] `isValidResponse` STILL PRESENT (deleted in P15 with its last caller `streamResponseHelpers.ts:109`) — `grep -rn "isValidResponse" packages/agents/src | grep -v test` ⇒ definition + that one caller only.
- [ ] `isProviderApiError` replaces `ApiError`; no `@google/genai` in `DirectMessageProcessor.ts`.
- [ ] Monorepo `npm run typecheck && npm run build` green (build-green checkpoint P13).
- [ ] Pseudocode compliance vs `directmessageprocessor-neutral.md`; deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace blocking path → `buildBlockingModelOutput` → returned `ModelOutput`; confirm the synthetic-response FABRICATION is now GONE from both the streaming (provider-output path neutralized P07/P08) and direct (here) paths — no `{candidates}` envelope is fabricated anywhere — and that the shared `AgentExecutionBlockedError` transport is now neutral (`blockedOutput?: ModelOutput`) with ALL THREE BLOCK writers (streaming AfterModel deferred from P07, before-model, direct) + the `TurnProcessor` reader flipped in THIS commit, so ZERO `.syntheticResponse` / `getModifiedResponse() as GenerateContentResponse` remain in agents; and that no reintroduction path passes the gate (the freed `beforeModelBlockingCompat` allow-list slot cannot smuggle a new Google-shaped helper — Major 6: the named `reintroduced-blocking-compat.ts` fixture is RUN against the real gate here and FAILS it; `beforeModelBlockingCompat` is absent from the allow-list AND `--by-file`). (The dead `streamChunkWrapper.ts` + `providerStopReason.ts` FILES are physically removed later in P25 with the last `chunkToParts` consumer — C2; here their fabrication/writer sources are gone.) Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P13a.md`.
