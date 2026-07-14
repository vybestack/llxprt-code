# Phase 17a: Runtime enum/value + googlePartHelpers IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P17a`

## Prerequisites
- Required: Phase 17 completed.

## Requirements Implemented (Expanded)
Verifies **REQ-006.1/.2/.3/.4** (runtime `Type`/`FinishReason`/`ApiError`/`createUserContent` value replacements produce identical tool-schema/finish/error behavior) and **REQ-011.1** (googlePartHelpers neutralized onto `ContentBlock[]` with `ResponseOutcome` still core-owned).

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-006.1/.2/.3/.4 (runtime value replacements)** — **GIVEN:** P17-modified `executor-tool-dispatch.ts`/`subagentRuntimeSetup.ts`/`MessageConverter.ts` etc. + the P16 tests; **WHEN:** the verifier runs the P16 tests, traces the `Type`→literal/`FinishReason`→`CanonicalFinishReason`/`ApiError`→`isProviderApiError`/`createUserContent`→neutral-builder swaps, and runs the scoped ≥80% mutation gate; **THEN:** tool-schema/finish/error/user-content behavior is identical, ZERO runtime Google enum/value bindings remain, mutation ≥80% on changed files; FAIL on any behavior drift or residual runtime Google value.
- **REQ-011.1 (googlePartHelpers neutralized)** — **GIVEN:** the renamed `contentBlockHelpers.ts`; **WHEN:** greps for `Part`/`@google/genai` and the P16 equivalence tests run; **THEN:** helpers operate on `ContentBlock[]` with `ResponseOutcome` still core-owned and outputs equal the legacy parts-helpers; FAIL on any residual `Part[]` currency.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P16 tool-schema + block-helper tests green (were RED against parts-based code).
- [ ] No runtime `Type.`/`FinishReason.`/`new ApiError`/`: ApiError` values in agents prod; schemas produced from neutral literals with identical structure (trace one).
- [ ] Every row of the P17 helper-by-helper table applied: each old symbol replaced by the named core block equivalent at every listed call site (or deleted with its delete-path caller); `ResponseOutcome` NOT re-declared in agents.
- [ ] `googlePartHelpers.ts` RENAMED to the exact new path `packages/agents/src/core/contentBlockHelpers.ts` (Minor 1): OLD path gone (`test ! -f packages/agents/src/core/googlePartHelpers.ts`), NEW path exists, block-based, no `@google/genai`, and `grep -rn "googlePartHelpers" packages/agents/src | grep -v test` ⇒ NONE (all import specifiers updated).
- [ ] No literal `<...>` `@pseudocode` placeholder in P17 (Major 1): the `googlePartHelpers`/`contentBlockHelpers` helpers cite concrete `messageconverter-neutralization.md` lines 23-29; runtime-value swaps carry the `// mechanical value substitution … no pseudocode function` note.
- [ ] OQ-7 confirmed in preflight (no external dependence on Gemini uppercase strings).
- [ ] Mutation gate ≥80% on the changed helper files.
- [ ] Deferred-impl + lint-guard clean; monorepo build green.

## Shrink-ratchet (M4)
- [ ] Structural-hit count is STRICTLY LOWER than the prior slice's. Use the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep). The broad grep in verification-template §9 is ADVISORY only (slice-scoped) and never the pass/fail gate. Update the integer in `dev-docs/agents-neutral-gate-baseline.md`; paste before/after into the marker.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace a tool schema build via neutral literals and one block-helper call producing an identical outcome to the old parts helper. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P17a.md`.
