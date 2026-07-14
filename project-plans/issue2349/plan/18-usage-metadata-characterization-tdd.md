# Phase 18: Usage-metadata characterization — TDD (OQ-2v FIRST)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P18`

## Prerequisites
- Required: Phase 17 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P17" packages/agents/src`
- Expected files from previous phase: `executor-tool-dispatch.ts`/`subagentRuntimeSetup.ts` (`Type` enum → JSON-schema string literals), `MessageConverter.ts`/`streamRequestHelpers.ts`/`streamResponseHelpers.ts` (`FinishReason` → `CanonicalFinishReason`), `googlePartHelpers.ts` neutralized AND RENAMED to `core/contentBlockHelpers.ts` (Minor 1).
- Preflight verification: Phase 0.5 completed.
- Pseudocode: `usage-metadata-boundary.md` lines 10-15.

## Purpose
This phase CHARACTERIZES what consumers currently see on `done.finished.usageMetadata` at runtime and RECORDS it as EVIDENCE. **It is NOT a decision-gate: OQ-2u is committed UNCONDITIONALLY to option (C)** (see domain-model.md OQ-2u, Critical 1 round 7 — option (B) is REJECTED for #2349 because it is a public breaking change that would break the CLI consumers `agentEventDispatcher.ts:406` / `zedIntegration.ts:614-615` with no owning migration phase). The recorded runtime key set DOCUMENTS the declared-Gemini-named-type-vs-verbatim-forwarded-neutral-runtime-value disagreement that MOTIVATES the option-(C) mapper — it does NOT select any branch. P19 implements option (C) regardless of the observed keys.

## Requirements Implemented (Expanded)

### REQ-007.1: Public usage-metadata characterization (OQ-2v — RECORDED EVIDENCE, not a branch selector)
**Full Text**: A characterization check establishes what consumers currently see on `done.finished.usageMetadata` at runtime (neutral `promptTokens` vs Gemini `promptTokenCount`), because the declared API type and emitted runtime value disagree. This is RECORDED as evidence documenting why the option-(C) mapper is needed; OQ-2u is committed unconditionally to (C) and this finding does NOT select a branch.
**Behavior**:
- GIVEN: a real agent turn that emits usage on the `Finished` event, observed through the API adapter's `done.finished.usageMetadata` payload (emission path per `eventAdapter.ts:229-235` `makeDone` spread + `:317-323` `Finished` dispatch).
- WHEN: `packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts` runs against the CURRENT (pre-migration) code and inspects the actual key names present on `done.finished.usageMetadata`, and separately asserts the internal `Finished` event carries neutral `UsageStats` (turn.ts:293-310 / :399-406).
- THEN: the test PASSES against current code, records the EXACT observed key set (neutral `promptTokens/completionTokens/totalTokens` vs Gemini `promptTokenCount/…`) into `.completed/P18.md` as documentation evidence, and asserts the internal event is neutral `UsageStats`; the recorded key set is NOT used to branch — P19 implements option (C) unconditionally.

## Implementation Tasks (test-writing; behavioral)
- `packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P18`, `@requirement:REQ-007.1`
- Assert the ACTUAL runtime keys on `done.finished.usageMetadata`. Evidence for the emission path (refresh at P0.5): the `Finished`-case dispatch stores `state.lastFinished` and calls `makeDone` (`eventAdapter.ts:317-323`), and the usage is spread into the public done payload inside `makeDone` (`eventAdapter.ts:229-235`) — so the assertion observes the KEYS produced by `makeDone`'s spread, which forwards the internal neutral `UsageStats` verbatim today.
- Assert internal `Finished` event carries neutral `UsageStats` (turn.ts:293-310 / :399-406).
- Record the observed key set in the phase completion marker as DOCUMENTATION EVIDENCE (it justifies the option-(C) mapper; it is NOT a branch selector — OQ-2u is committed to (C) unconditionally, Critical 1 round 7).

## Verification Commands
```bash
npm test -- packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/api/__tests__/usageMetadata.characterization.spec.ts   # aggregate >=30%
```

## Success Criteria
- The characterization records the ACTUAL runtime key set on `done.finished.usageMetadata` (OQ-2v evidence) and confirms the internal `Finished` event carries neutral `UsageStats`.
- The recorded finding is DOCUMENTATION evidence for the option-(C) mapper; it does NOT select a branch (OQ-2u is committed to option (C) unconditionally, Critical 1 round 7).
- Tests PASS against current code.

## Failure Recovery
1. If the runtime key set cannot be observed via `done.finished`: trace `makeDone`'s spread (`eventAdapter.ts:229-235`) and the `Finished`-case dispatch (`eventAdapter.ts:317-323`) plus `turn.ts:293-310` to find the real emission point and assert there.
2. **No replanning is required and there is NO branch to select.** RECORD the observed key set in the marker as evidence. P19 always implements option (C) (the `usageStatsToPublicUsageMetadata` boundary mapper; declared public type UNCHANGED) regardless of the observed keys — option (B) is rejected for #2349 (Critical 1 round 7). Do NOT stop-and-replan and do NOT edit `domain-model.md`/`P19` to reintroduce a branch.
3. `git checkout --` and re-author only if the test itself is wrong. Cannot proceed to Phase 19 until the observed key set is recorded in the marker.

## Phase Completion Marker
`project-plans/issue2349/.completed/P18.md` — MUST record the observed key set (OQ-2v evidence; documentation only, not a branch selector).
