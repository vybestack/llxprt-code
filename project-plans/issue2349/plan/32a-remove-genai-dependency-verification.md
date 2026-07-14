# Phase 32a: Remove genai dependency — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P32a`

## Prerequisites
- Required: Phase 32 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Verifies **REQ-013.1** (dependency fully removed from ALL dependency keys) and **REQ-013.2** (allow-listed tests use local structural fixtures, not SDK imports).

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-013.1 (`@google/genai` dependency removed)** — **GIVEN:** `packages/agents/package.json` post-P32; **WHEN:** the verifier greps ALL dependency keys (`dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`) and runs `npm run build`; **THEN:** `@google/genai` is absent from every dependency key and the package builds without it; FAIL if the dependency remains in any key.
- **REQ-013.2 (allow-listed tests use local fixtures)** — **GIVEN:** the allow-listed characterization tests; **WHEN:** greps for `@google/genai` imports in `packages/agents` tests; **THEN:** they import LOCAL structural fixtures only, with ZERO SDK imports; FAIL on any residual SDK import.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] Zero `@google/genai` imports under `packages/agents/src` — PROD **AND** TESTS (`grep -rl "@google/genai" packages/agents/src` ⇒ EMPTY).
- [ ] `@google/genai` removed from `packages/agents/package.json` under EVERY key — `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`. NO dev-only escape hatch is permitted. (`grep -n "@google/genai" packages/agents/package.json` ⇒ no output.)
- [ ] Any allow-listed characterization test that needs a Gemini-shaped fixture uses a LOCAL structural object typed locally/`unknown` (REQ-013.2), not an SDK import; SDK-typed tests relocated to the provider package.
- [ ] `dev-docs/genai-import-baseline.md` agents owner = 0.
- [ ] typecheck/build/agents-tests green; both neutral gates exit 0.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the package no longer depends on `@google/genai` for ANY purpose (prod or dev) and that no test forces a residual dependency. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P32a.md`.
