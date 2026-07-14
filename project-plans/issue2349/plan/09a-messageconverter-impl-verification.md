# Phase 09a: MessageConverter IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P09a`

## Prerequisites
- Required: Phase 09 completed.

## Requirements Implemented (Expanded)
This phase verifies **REQ-002.4 (partial — retype survivors)** and **REQ-006.4 (`createUserContent` replaced)**: the surviving MessageConverter conversion is neutral (blocks/speaker) while the synthetic fabricators are intentionally quarantined (not yet deleted) so the still-Google direct path keeps compiling. Deletion of the fabricators is verified in P13a; `isValidResponse` deletion in P15a.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-002.4 (partial — survivors retyped)** — **GIVEN:** the P09-modified `MessageConverter.ts`; **WHEN:** the verifier traces the surviving IContent↔block conversion and greps the fabricator chain; **THEN:** the surviving conversion is neutral (speaker/`ContentBlock[]`), and the synthetic fabricators (`convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`) are QUARANTINED (still present, tagged owner=P13 in the baseline) so the direct path compiles; FAIL if a survivor still traffics Google `Part[]`, or if a fabricator was prematurely deleted here (breaks the un-migrated direct path).
- **REQ-006.4 (`createUserContent` replaced)** — **GIVEN:** the input-normalization path; **WHEN:** greps for `createUserContent`; **THEN:** it is replaced by the neutral builder with no `@google/genai` `createUserContent` import remaining in the retyped surface; FAIL if `createUserContent` survives.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P06 characterization tests green.
- [ ] Surviving conversion helpers are block/speaker-based; no NEW `{role,parts}`/`.parts`/`.role` in the retyped survivors.
- [ ] `createUserContent` (value) import gone; replaced by the neutral `createUserContentFromInput` builder (REQ-006.4).
- [ ] Build-order invariant respected: `convertIContentToResponse`/`applyResponseMetadata`/`applyFinishReasonMapping`/`isValidResponse` STILL PRESENT (they are deleted in P13/P15) — confirm they compile and are only reached by the not-yet-migrated direct path/facade/streaming accumulator (`grep -rn "convertIContentToResponse" packages/agents/src | grep -v test`).
- [ ] `providerStopReason.ts` NOT deleted here; its WRITER `MessageConverter.ts:588` still exists (removed P13) and its READER `streamChunkWrapper.ts:112` still exists (removed P25 with the `streamChunkWrapper.ts` file delete — C2). The FILE is deleted in P25.
- [ ] Monorepo `npm run typecheck && npm run build` green.
- [ ] Pseudocode compliance vs `messageconverter-neutralization.md`; deferred-impl + lint-guard clean.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: confirm the surviving conversion is neutral AND that the staged (deferred) deletion keeps the build green. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P09a.md`.
