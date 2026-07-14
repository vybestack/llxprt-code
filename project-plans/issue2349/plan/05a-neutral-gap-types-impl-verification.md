# Phase 05a: Neutral gap types IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P05a`

## Prerequisites
- Required: Phase 05 completed.

Follow `plan/verification-template.md`. IMPL-phase specifics:

## Requirements Implemented (Expanded)

### Verifies REQ-001.1..001.5 are GREEN and pseudocode-faithful (verification GWT — Major 1)
**Full Text**: Confirms REQ-001.1/.2/.3/.4/.5 are now GREEN (impl makes the P04 tests pass): AgentMessageInput/legacy converters are lossless, `sendParamsToRequest` returns a neutral `ModelGenerationRequest`, `ModelOutput.afcHistory` round-trips, and `toModelStreamChunk` copies `responseId` + response-level `providerMetadata` (closing the OQ-16 gap) — with block-level metadata preserved by reference.
**Behavior (verification gate):**
- GIVEN: P05's implemented `agentMessageInput.ts` + extended `modelEnvelope.ts` and the P04 test suite.
- WHEN: the verifier runs the P04 tests, traces `iContentFromLegacyInput`/`toModelStreamChunk` against `neutral-gap-types.md` (lines 21-66), runs the scoped ≥80% mutation gate, and applies the deferred-impl / `as`-cast / lint-guard detectors.
- THEN: all P04 tests pass; every numbered pseudocode step is traceable in order; mutation score ≥80% on the changed llm-types files; ZERO `as` casts (type predicates only); monorepo build is green — otherwise the phase FAILS with the specific finding.
**Why This Matters**: proves the neutral gap types are genuinely implemented (not stubbed) and safe for every downstream slice that consumes them.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] All P04 tests pass (run, paste tail).
- [ ] Pseudocode compliance: trace `iContentFromLegacyInput`/`mapLegacyParts`/`toModelStreamChunk` against `neutral-gap-types.md` lines 21-66; every numbered step present, order preserved.
- [ ] Deferred-impl scan clean (no TODO/HACK/`in a real`/empty returns in impl).
- [ ] No `@google/genai` import; structural checks on `unknown`.
- [ ] **Type predicates, NOT `as` casts (Additional Risk 3 / RULES.md):** `grep -nE "\bas\b (unknown|[A-Z])" packages/core/src/llm-types/agentMessageInput.ts` ⇒ EMPTY; confirm every legacy-shape branch is gated by a `(x: unknown): x is T` predicate (read the code, not just grep).
- [ ] BR-5: thoughtSignature preserved (trace the ThinkingBlock path). REQ-001.5: providerMetadata preserved (trace lines 61-66).
- [ ] Build-green checkpoint: `npm run build` green across monorepo.
- [ ] RULES.md/lint-guard clean.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: what was implemented, how it satisfies REQ-001.*, one traced path (legacy `{thought,thoughtSignature}` → ThinkingBlock → survives). Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P05a.md`.
