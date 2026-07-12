# Phase 28a: Test migration — Verification

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P28a`

## Prerequisites
- Required: Phase 28 completed.

Follow `plan/verification-template.md`. Specifics:

## Requirements Implemented (Expanded)
Confirms REQ-INT-005.1 (agent-loop tests assert OBSERVABLE outputs — events/history/retry/finish — not `{candidates}`/`.parts`; purely-structural tests deleted or rewritten) and REQ-012.3 (only the named characterization allow-list retains Gemini structural assertions, using LOCAL fixtures — no `@google/genai` import in `packages/agents` tests) — so the suite cannot pass with a reintroduced synthetic response.

### Verification GWT (Major 1 — gate-level GIVEN/WHEN/THEN)
- **REQ-INT-005.1 (tests assert observable outputs)** — **GIVEN:** the P28-migrated agents test suite; **WHEN:** the verifier greps migrated tests for `{candidates}`/`.parts` and runs the suite; **THEN:** agent-loop tests assert OBSERVABLE outputs (events/history/retry/finish), purely-structural tests are deleted or rewritten, and the suite cannot pass with a reintroduced synthetic response; FAIL on any surviving structural assertion outside the named characterization allow-list.
- **REQ-012.3 (characterization allow-list uses local fixtures)** — **GIVEN:** the named characterization allow-list; **WHEN:** greps for `@google/genai` in `packages/agents` tests; **THEN:** only allow-listed characterization files retain Gemini STRUCTURAL assertions and they use LOCAL fixtures with ZERO `@google/genai` import; FAIL on any `@google/genai` import in agents tests.
- **Behavior-coverage preservation (Major 5 — SEMANTIC audit is the PRIMARY proof, round 8)** — **GIVEN:** the semantic per-file disposition audit `.completed/P28-disposition-audit.md` AND the frozen per-behavior-area baseline in `.completed/P0.5.md`; **WHEN:** the verifier reads the audit and re-runs the identical P28 behavior-area probe commands; **THEN:** every RB file has an audit row naming OLD behavior + NEW observable assertions + a concrete implementation-break the rewritten test would catch (behavior-not-structure), AND each post-migration behavior-area count is ≥ its recorded baseline (SMOKE cross-check); FAIL if the audit is missing/vacuous (no why-break clause), the baseline block is missing, or any count dropped.

## Implementation Tasks
This is a verification phase: its "tasks" are to execute the semantic verification below (read the sibling impl/TDD code, trace one data path input→output, run the commands, apply the shared `verification-template.md` fraud/lint-guard/mutation/shrink-ratchet detectors) and record evidence in the completion marker. No production code is written here.

## Verification Commands
- [ ] SEMANTIC audit present + non-vacuous (PRIMARY proof, Major 5): `test -f project-plans/issue2349/.completed/P28-disposition-audit.md` and every RB file has a row with a concrete why-break clause (`grep -qiE "would fail|fails if|breaking .* fails|regress" project-plans/issue2349/.completed/P28-disposition-audit.md`).
- [ ] Only allow-listed characterization tests still import `@google/genai` or use `{candidates}` fixtures; every other agents test is neutral + behavioral.
- [ ] The CHAR allow-list is EXACTLY the FIVE named files (Additional Risk 3 — exact CHAR filenames, no wildcard/dir-level): `test "$(grep -rlE 'boundaryRecovery\.test|chatSession\.thinking-toolcalls\.repro\.test|switch-context\.spec|chatSession\.hook-control\.test|chatSession\.issue1749\.test' packages/agents/src | sort -u | wc -l)" -eq 5`.
- [ ] Rewritten tests assert observable outputs (events/history), NOT `{candidates}`/`.parts`; no mock theater/reverse testing; ≥30% property-based where rewritten.
- [ ] The characterization allow-list membership matches §3.3-A + OQ-1a/OQ-1d decisions.
- [ ] Behavior-area keyword/file counts ≥ frozen `.completed/P0.5.md` baseline (SMOKE cross-check).
- [ ] All agents tests green.

## Success Criteria
- Every check/command above passes with pasted evidence; the traced data path proves the REQ behavior (not marker-counting).
- No mock theater / reverse testing / structure-only assertions; no `eslint-disable`/`ts-ignore`/`ts-expect-error`/`ts-nocheck`; no lint/complexity loosening (`npm run lint:eslint-guard`).
- Cited line references match the refreshed P0.5 preflight evidence (Minor 2).

## Failure Recovery
FAIL → route the specific finding to a remediation subagent with the exact evidence; re-verify. NEVER proceed on FAIL; NEVER skip a phase number.

## Holistic Assessment
Confirm the test suite now proves NEUTRAL behavior and cannot pass with a reintroduced synthetic response. Verdict PASS/FAIL.

## Phase Completion Marker
`project-plans/issue2349/.completed/P28a.md`.
