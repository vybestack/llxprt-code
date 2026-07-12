# Phase 25a: Executor slice IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P25a`

## Prerequisites
- Required: Phase 25 completed.

## Requirements Implemented (Expanded)
Verifies **REQ-005.5b** — executor group retyped to neutral with identical behavior, `executor-prompt-builder.ts` operating on blocks (no `.parts`), `PromptConfig.initialMessages` migrated to `IContent[]` (OQ-12), zero `@google/genai`, and a decreased structural-hit count — AND the **C2 FILE deletes REQ-002.2 / REQ-003.1 / REQ-INT-004**: `streamChunkWrapper.ts` (last consumer `executor-stream-processor.ts` migrated here) and `providerStopReason.ts` (last reader inside `streamChunkWrapper.ts:112` removed by that delete) are both physically gone with a green build.

**Line-number freshness FIRST (Minor 2):** BEFORE any check below, compare every line range cited in P25 / this phase (notably `streamChunkWrapper.ts:112` and the executor `.parts`-mutator sites) against `.completed/P0.5.md`; FAIL immediately if the P0.5 marker is absent or any cited range drifted without a phase-file update.

### Verification GWT — REQ-005.5b (Major 1)
- **GIVEN:** the P25-modified executor group (`executor.ts`/`executor-stream-processor.ts`/`executor-tool-dispatch.ts`/`recovery.ts`/`executor-prompt-builder.ts`/`agents/types.ts`) + the P24 safety net.
- **WHEN:** the verifier runs P24, greps for `@google/genai`/`.parts` in `executor-prompt-builder.ts`, checks `initialMessages?: IContent[]` (OQ-12), and reads the shrink-ratchet.
- **THEN:** run behavior is identical, `executor-prompt-builder.ts` operates on `IContent`/`ContentBlock[]` (no `.parts`, raw-import-free bypass eliminated), `PromptConfig.initialMessages` is `IContent[]` with NO legacy adapter/allow-list entry, ZERO `@google/genai` remains, and `--count` is STRICTLY LOWER with P25-owned baseline hit IDs absent from `--by-file`; FAIL on any residual `.parts`/`@google/genai` or a non-decreasing count.

**GWT (C2 file deletes):**
- GIVEN: all `streamChunkWrapper`/`chunkToParts` consumers migrated (P08/P23/P25) and the `providerStopReason` WRITER removed (P13)
- WHEN: this verification runs after P25 deletes both files
- THEN: `test ! -f` succeeds for BOTH `streamChunkWrapper.ts` and `providerStopReason.ts`; `grep -rnE "chunkToParts|responseToModelStreamChunk|responseToIContent|providerStopReason|getProviderStopReason|setProviderStopReason" packages/agents/src --include=*.ts` (incl. tests) ⇒ EMPTY; `npm run typecheck && npm run build` green (no dangling import) — else FAIL.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P24 characterization tests green.
- [ ] Executor group zero `@google/genai`; each site in the P25 map applied.
- [ ] `executor-prompt-builder.ts` has NO `.parts` currency — operates on `IContent`/`ContentBlock[]` (the raw-import-free bypass is eliminated).
- [ ] `agents/types.ts` `initialMessages?: IContent[]` (OQ-12) with breaking-change JSDoc note; NO legacy `Content[]` adapter and NO allow-list entry for it.
- [ ] **C2 FILE deletes:** `test ! -f packages/agents/src/core/streamChunkWrapper.ts` AND `test ! -f packages/agents/src/core/providerStopReason.ts`; `grep -rnE "chunkToParts|responseToModelStreamChunk|responseToIContent|providerStopReason|getProviderStopReason|setProviderStopReason" packages/agents/src --include=*.ts` (INCLUDING tests) ⇒ EMPTY; build green proves neither delete dangles an import.
- [ ] Shrink-ratchet strictly lower than pre-slice; mutation gate ≥80% on changed files; build green.
- [ ] Deferred-impl + lint-guard clean.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace template application on neutral blocks producing identical substituted text. Confirm the raw-import-free structural mutator is gone. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P25a.md`.
