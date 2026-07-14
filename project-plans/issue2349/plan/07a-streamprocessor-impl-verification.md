# Phase 07a: StreamProcessor IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P07a`

## Prerequisites
- Required: Phase 07 completed.
- Verification: `grep -rn "@plan:PLAN-20260707-AGENTNEUTRAL.P07" packages/agents/src`
- Expected files from previous phase: `packages/agents/src/core/StreamProcessor.ts` (provider-output path neutralized), `dev-docs/agents-neutral-gate-baseline.md` (integer updated).
- Preflight verification: Phase 0.5 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
_Verification phase — the requirement blocks below are expressed as gate-level GIVEN/WHEN/THEN that VERIFY the sibling impl phase (full GIVEN/WHEN/THEN, Major 1)._

### REQ-002.1: provider-output path consumes the neutral chunk directly
- **GIVEN:** the P07-modified `packages/agents/src/core/StreamProcessor.ts` (provider-output path) + the P06 characterization suite.
- **WHEN:** `grep -n "convertIContentToResponse" packages/agents/src/core/StreamProcessor.ts` runs and the per-chunk conversion is traced against `stream-processor-neutral.md` lines 13-43.
- **THEN:** the provider-output path calls `toModelStreamChunk(iContent)` with ZERO `convertIContentToResponse` calls and NO `{candidates}` literal on that path; PASS iff the grep is EMPTY and P06 stays green. FAIL if any provider-output `convertIContentToResponse` call/`{candidates}` literal remains. (`convertIContentToResponse` REMAINS DEFINED in MessageConverter — deleted in P13 — so the direct path still typechecks; that definition surviving is EXPECTED here.)

### REQ-005.3: neutral accumulation + single history commit
- **GIVEN:** the neutralized StreamProcessor finalize path.
- **WHEN:** the accumulation + `_finalizeStreamProcessing` commit is traced (BR-1 single commit, BR-6 usage + absent fallback, BR-5 thought filter keeps signature, BR-7 text consolidation).
- **THEN:** exactly ONE history commit occurs with neutral `ContentBlock[]`/`CanonicalFinishReason`; PASS iff the traced path shows the single neutral commit and P06 stays green; FAIL on a duplicated commit or a Google-shaped accumulator.

### REQ-INT-001: interim shrink-ratchet baseline strictly decreased
- **GIVEN:** the P02/P0.5 frozen `--count`/`--by-file` baseline in `dev-docs/agents-neutral-gate-baseline.md`.
- **WHEN:** `npx tsx scripts/agents-neutral-gate.ts --count` (and `--by-file`) runs after P07.
- **THEN:** the net `--count` is STRICTLY LOWER than the pre-P07 value AND every P07-owned baseline hit ID is ABSENT from `--by-file`; PASS iff both hold and the baseline integer is updated; FAIL if the count is equal/higher or any owned hit ID survives.

**Line-number freshness FIRST (Minor 2):** BEFORE running any check below, compare EVERY line range cited in P07 / this phase (`StreamProcessor.ts` build-order boundary lines, the before-model helper lines, `stream-processor-neutral.md` ranges) against `.completed/P0.5.md`; FAIL this phase immediately if the P0.5 marker is absent OR any cited range drifted without a corresponding phase-file update (per verification-template §2).

**C3 build-order (verify explicitly):** TWO Google-shaped elements are DELIBERATELY RETAINED after P07 and die in P13, NOT here: (i) the BEFORE-MODEL blocking-hook synthetic path (`_patchMissingFinishReason` + `enforceBeforeModelHookDecision`); and (ii) the AFTER-MODEL BLOCK branch's shared error transport — the `getModifiedResponse() as GenerateContentResponse` cast on the BLOCK branch + `AgentExecutionBlockedError(reason, syntheticResponse, ...)` (its `syntheticResponse: GenerateContentResponse` field is shared with the still-Google-shaped before-model/direct writers and the `wrapChunk` reader until P13). The verifier confirms P07 neutralized ONLY the provider-output round-trip AND the AfterModel MODIFY + STOP branches, and did NOT (a) prematurely delete the before-model-hook synthetic path, NOR (b) prematurely retype `AgentExecutionBlockedError`/the AfterModel BLOCK branch (either would break the build at the un-migrated co-writers/reader). After P07 there is EXACTLY ONE surviving `getModifiedResponse() as GenerateContentResponse` cast — the AfterModel BLOCK branch — plus the before-model path's `GenerateContentResponse`/`FinishReason` uses.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P06 characterization tests STILL green (behavior preserved) — paste output.
- [ ] Pseudocode compliance vs `stream-processor-neutral.md` lines 13-43; trace the per-chunk conversion + finalize commit.
- [ ] Provider-output path neutral: `grep -n "convertIContentToResponse" packages/agents/src/core/StreamProcessor.ts` ⇒ EMPTY (the CALL is gone); no `{ candidates: ... }` LITERAL constructed on the provider-output path; no `.usageMetadata.promptTokenCount` read.
- [ ] **C3 build-order (BLOCK branch + before-model path retained until P13):**
  - `grep -nE "getModifiedResponse\(\) *as *GenerateContentResponse" packages/agents/src/core/StreamProcessor.ts` ⇒ EXACTLY ONE hit (the AfterModel BLOCK branch); the MODIFY-branch cast is GONE. FAIL if zero (BLOCK branch prematurely retyped — breaks the shared `AgentExecutionBlockedError` transport) or if more than one (MODIFY-branch cast not removed).
  - `grep -n "GenerateContentResponse\|FinishReason" packages/agents/src/core/StreamProcessor.ts` shows these ONLY inside (a) `_patchMissingFinishReason` / the `enforceBeforeModelHookDecision` call (before-model blocking-hook path) AND (b) the AfterModel BLOCK branch's `AgentExecutionBlockedError(reason, syntheticResponse, ...)` transport — BOTH retained until P13. FAIL if the before-model synthetic path was prematurely deleted (breaks `enforceBeforeModelHookDecision`/`AgentExecutionBlockedError`) OR if `AgentExecutionBlockedError`/the BLOCK branch was prematurely retyped (breaks the un-migrated before-model/direct co-writers + the `wrapChunk` reader).
  - `grep -nE "afterModelBlockingToModelOutput" packages/agents/src/core/hookWireAdapter.ts` ⇒ NONE yet (that export is added in P13, not P07 — C3).
- [ ] BR-1 (single commit), BR-6 (usage + absent fallback), BR-5 (thought filter keeps signature), BR-7 (text consolidation) traced.
- [ ] No WeakMap writes on the StreamProcessor provider-output/stream path (side-channel retired here for the stream path; the before-model hook restriction attach via `attachHookRestrictedAllowedTools` remains until P11/P13 per its own slice).
- [ ] Monorepo `npm run typecheck && npm run build` green (build-green checkpoint P07).
- [ ] Deferred-impl scan clean; RULES.md/lint-guard clean.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace provider IContent → toModelStreamChunk → accumulate → single history commit. Confirm NO synthetic response is fabricated on the PROVIDER-OUTPUT path and the AfterModel MODIFY + STOP branches are neutral; the AfterModel BLOCK branch's `syntheticResponse: GenerateContentResponse` transport + the before-model blocking-hook synthetic path are the ONLY remaining Google-shaped elements (both deferred to P13, C3) — their presence here is EXPECTED, not a failure. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P07a.md`.
