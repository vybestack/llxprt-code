# Phase 23a: Subagent slice IMPL — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P23a`

## Prerequisites
- Required: Phase 23 completed.

## Requirements Implemented (Expanded)
Verifies **REQ-005.5a** — subagent group retyped to neutral with identical run behavior, zero `@google/genai`, and a strictly-decreased structural-hit count (shrink-ratchet).

**Line-number freshness FIRST (Minor 2):** BEFORE any check below, compare every line range cited in P23 / this phase (the subagent `{role:'user',parts}` / `.parts` sites in `subagent.ts`/`subagentExecution.ts`/`subagentToolProcessing.ts`/`subagentNonInteractive.ts`) against `.completed/P0.5.md`; FAIL immediately if the P0.5 marker is absent or any cited range drifted without a phase-file update.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.5a (subagent group retyped neutral)** — **GIVEN:** the P23-modified subagent files (`subagent.ts`/`subagentExecution.ts`/`subagentToolProcessing.ts`/`subagentNonInteractive.ts`) + the P22 safety net; **WHEN:** the verifier runs P22, greps for `@google/genai`, and reads the shrink-ratchet; **THEN:** run behavior is identical, ZERO `@google/genai` remains in the group, and the structural-hit `--count` is STRICTLY LOWER than the prior slice with the P23-owned baseline hit IDs absent from `--by-file`; FAIL on behavior drift, residual `@google/genai`, or a non-decreasing count.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P22 characterization tests green.
- [ ] `subagent.ts`/`subagentExecution.ts`/`subagentNonInteractive.ts`/`subagentToolProcessing.ts` have zero `@google/genai`; each site in the P23 map applied (no `{role,parts}`/`.parts`).
- [ ] `getFunctionCallsFromParts` residual → `getToolCallBlocks`.
- [ ] Shrink-ratchet: structural-hit count STRICTLY LOWER than the prior slice's, using the AUTHORITATIVE AST counter landed in P02 (Major 4/5): `npx tsx scripts/agents-neutral-gate.ts --count` (AST-context-aware, allow-list-subtracted — NOT broad grep; the broad grep in verification-template §9 is advisory only). `dev-docs/agents-neutral-gate-baseline.md` updated; before/after pasted.
- [ ] Mutation gate ≥80% on changed files; monorepo build green.
- [ ] Deferred-impl + lint-guard clean.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: trace a subagent tool-response feed on neutral `IContent`/`ToolResponseBlock[]`. Confirm behavior preserved. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P23a.md`.
