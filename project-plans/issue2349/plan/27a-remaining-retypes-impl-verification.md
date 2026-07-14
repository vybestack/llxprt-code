# Phase 27a: Remaining group IMPL — Verification (ZERO-imports checkpoint)

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P27a`

## Prerequisites
- Required: Phase 27 completed.

## Requirements Implemented (Expanded)
Verifies **REQ-005.5c** and the ZERO-prod-imports checkpoint: every remaining RETYPE file is neutral, behavior preserved, and `grep -rl "@google/genai" packages/agents/src | grep -v test` is EMPTY.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-005.5c (remaining group retyped neutral)** — **GIVEN:** the P27-modified remaining files + the P26 safety net; **WHEN:** the verifier runs P26, greps for `@google/genai`, and reads the shrink-ratchet; **THEN:** behavior is identical, ZERO `@google/genai` remains in the group, and `--count` is STRICTLY LOWER with P27-owned baseline hit IDs absent from `--by-file`; FAIL on behavior drift, residual `@google/genai`, or a non-decreasing count.
- **REQ-INT-004 (ZERO production importers checkpoint)** — **GIVEN:** the whole agents tree post-P27; **WHEN:** `grep -rl "@google/genai" packages/agents/src | grep -v test` runs; **THEN:** the result is EMPTY (zero production importers) and the monorepo builds green; FAIL if any production importer remains.

Follow `plan/verification-template.md`. Specifics:

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] P26 characterization tests green.
- [ ] `grep -rl "@google/genai" packages/agents/src | grep -v -E "\.(test|spec)\.|test-helpers|__tests__"` ⇒ EMPTY (ALL 46 prod importers neutralized across P07-P27).
- [ ] No `{role,parts}`/`.parts` in agents prod except the bounded G3 hook adapter (IFF OQ-1a) confined to `streamRequestHelpers.ts`.
- [ ] Each site in the P27 map applied (compression/agenticLoop/api/misc); `loopHelpers.recordCancelledToolHistory` uses `IContent{speaker:'ai'|'tool'}`.
- [ ] Shrink-ratchet at target floor; mutation gate ≥80% on changed files; monorepo build green; all agents tests green.
- [ ] RISK-1 (public event shape) + RISK-2 (hook wire byte-shape) unchanged; deferred-impl + lint-guard clean.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
PLAN.md §7: confirm ZERO prod genai imports and trace two retyped subsystems (compression enforcement + agenticLoop cancelled-tool) with behavior preserved. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P27a.md`.
