# Phase 10: CLI Session Exact Seam Audit (analysis-only, before characterization)

## Phase ID
`PLAN-20260629-ISSUE2285.P10`

## Prerequisites
- Required: Phase 09a completed.
- Verification: `test -f project-plans/issue2285/.completed/P09a.md`.

## Purpose

Architect finding 2: the prior revision allowed production code extraction
(seam-audit phase with extraction) BEFORE characterization tests,
contradicting REQ-006.2/TDD. This phase is now STRICTLY ANALYSIS-ONLY. It
performs an exact seam audit of `packages/cli/src/cliSessionDispatch.tsx` but
does NOT extract or modify any production code. Characterization tests (P11)
must come before any extraction (P12).

This phase produces a seam audit document that P11 (characterization) and P12
(split) use as their foundation. No production code is touched.

## Requirements Implemented (Expanded)

### REQ-006.1 (analysis-only seam evidence for the split)

**Behavior**:
- GIVEN: `packages/cli/src/cliSessionDispatch.tsx` is a ~610-line quarantine
  module with mixed responsibilities.
- WHEN: an exact seam audit enumerates every exported name, internal helper,
  side effect, and dependency cluster, and classifies each into a candidate
  stable ownership module.
- THEN: the audit produces a documented extraction map. NO production code is
  extracted or modified in this phase.

## Exact Seam Audit Tasks

### 1. Enumerate the exact module surface

Read `packages/cli/src/cliSessionDispatch.tsx` and produce an exact inventory:

- **Exported names** (the six cli.tsx imports):
  `dispatchInteractiveOrNonInteractive`, `formatNonInteractiveError`,
  `initializeOutputListenersAndFlush`, `installNonInteractiveSigintHandler`,
  `setupUnhandledRejectionHandler`, `startInteractiveUI`.
- **Internal helper functions** (every non-exported function): name, line
  range, responsibility.
- **Types/interfaces** defined in the module.
- **Side effects**: `process.on`, `process.exit`, `process.stdout/stderr`
  writes, `enableMouseEvents`/`disableMouseEvents`, Ink `render`,
  `appendFileSync`, stdin reading, terminal protocol writes.
- **Import dependencies**: what the module imports (and from where).
- **Internal call graph**: which helpers call which (to identify leaf vs
  composite functions for extraction ordering).

### 2. Classify into candidate stable ownership modules

Map each enumerated item to a candidate module (per
`analysis/pseudocode/cli-session-split.md`):
- `session/outputListeners.ts` — output listener setup/flush.
- `session/signalHandlers.ts` — SIGINT + unhandled rejection.
- `session/errorReporting.ts` — non-interactive error formatting/reporting.
- `session/terminalCleanup.ts` — mouse/terminal cleanup.
- `session/interactiveUI.ts` — interactive Ink render/bootstrap.
- `session/nonInteractiveSession.ts` — dispatch + runners.

For each candidate module, document:
- Which exported names and helpers move there.
- Which other candidate modules it depends on (intra-split dependency edges).
- Whether the extraction is pure code-motion (no behavior change).

### 3. Seam cleanliness verdict

Based on the audit, classify into one of:

**Verdict A: Clean seams confirmed.** The module has clear responsibility
boundaries; each candidate module has a single responsibility; the extraction
map is pure code-motion. Document the map. P11 characterizes against the
current module; P12 splits along the confirmed seams.

**Verdict B: Entangled seams identified.** One or more candidate seams are
entangled (shared mutable state, unclear boundary, circular helper dependency).
In this case, DOCUMENT the entanglement and flag it for the characterization
tests (P11) to account for. The characterization tests MUST still target the
current monolith. The split (P12) handles the entanglement during extraction.
NO production code extraction happens in this phase — characterization (P11)
MUST precede any extraction per REQ-006.2/TDD (architect finding 2).

**Verdict C: Entanglement requires a forbidden production seam (revision 3 —
architect finding 22 — plan-revision stop condition).** The audit may discover
that the only way to split the module cleanly would require introducing a
production seam that P11/P12 forbid (e.g. a new production seam that the
characterization tests must mock, violating the "no mocking the
session-dispatch module" rule, or a new deep-import that violates the boundary
checker). In this case, this phase STOPS and escalates for a plan revision:
record the specific entanglement, the seam that would be required, and why it
conflicts with P11/P12 constraints. Do NOT proceed to P11/P12 with a split
strategy that depends on a forbidden seam. The coordinator decides among
these three options:

- **(a) Revise the plan to permit the seam** — update P11/P12 to explicitly
  allow the seam with documented justification (e.g. why the seam does not
  violate the no-mock rule or the boundary checker). This requires updating
  the relevant phase files and recording the decision in
  `project-plans/issue2285/.completed/P10a.revised-plan.md`.
- **(b) Accept a smaller-scope split** — split only the seams that are clean
  (Verdict A/B for those seams), and leave the entangled portions in
  `cliSessionDispatch.tsx` with a documented scope reduction. Record the
  accepted smaller scope in `P10a.revised-plan.md`.
- **(c) Defer the remaining entanglement to a follow-up issue** — extract
  what is clean now, and record the remaining entanglement as tracked debt
  in a follow-up GitHub issue, referenced from `P10a.revised-plan.md`.

**Architect review finding 10 (Verdict C downstream sequencing):** if Verdict C
is accepted via `P10a.revised-plan.md`, the downstream phases MUST be
RE-REVIEWED and UPDATED before continuing — the marker does NOT merely bypass
P11/P12/P13. Specifically:
- **P11 (characterization)**: the revised plan MUST document how the
  characterization tests account for the accepted Verdict C decision (e.g. if
  a smaller-scope split was accepted, P11 characterizes only the seams that
  will be extracted; if a seam was permitted, P11 tests account for it). P11's
  prerequisite check MUST verify `P10a.revised-plan.md` exists AND that it
  references the specific P11/P12/P13 changes. P11 does NOT auto-proceed.
- **P12 (split)**: the revised plan MUST document the updated extraction map
  reflecting the Verdict C decision. P12's prerequisite check MUST verify the
  revised plan's extraction map matches what P12 implements.
- **P13/P13a (final verification)**: P13/P13a MUST verify the Verdict C
  decision was implemented as documented in `P10a.revised-plan.md` — e.g. if
  option (c) was chosen (defer to follow-up), P13 verifies a follow-up issue
  was created and referenced; if option (b) was chosen (smaller scope), P13
  verifies the documented scope reduction was implemented and the remaining
  entanglement is explicitly documented (not silently left in place).

The `P10a.revised-plan.md` marker is NOT a bypass — it is a RE-PLANNING
artifact that downstream phases consume. Without it, P10a fails with no
completion marker, blocking the entire chain.

This stop condition prevents the plan from becoming unimplementable
mid-execution.

**IMPORTANT (architect finding 2)**: This phase is ANALYSIS-ONLY. Verdict B
or C in this revision does NOT perform any extraction. It documents the
situation so P11 characterization and P12 split are prepared (Verdict B) or
the plan is revised (Verdict C). The characterization tests (P11) MUST come
before any production extraction.

## Implementation Tasks

### Files to Create
- `project-plans/issue2285/analysis/cli-session-seam-audit.md` — the exact
  seam audit: module surface inventory, candidate module map, intra-split
  dependency edges, seam cleanliness verdict (A or B), and (if B) the
  entanglement documentation.

### Files NOT to Modify
- `packages/cli/src/cliSessionDispatch.tsx` — NOT modified. This phase is
  analysis-only (architect finding 2).
- `packages/cli/src/cli.tsx` — NOT modified.
- No characterization tests yet (those are P11).
- No new session modules (those are P12).

### Marker Discipline (architect finding 5)

The seam audit document is a plan artifact and may carry
`@plan:PLAN-20260629-ISSUE2285.P10` / `@requirement:REQ-006` markers. No
production source is touched in this phase.

## Reachability

The seam audit reads the real `cliSessionDispatch.tsx`. No production code
paths are modified.

## Verification Commands

```bash
# Seam audit exists with real content — fail-closed
test -s project-plans/issue2285/analysis/cli-session-seam-audit.md || { echo "FAIL: seam audit missing or empty"; exit 1; }

# All six exported names enumerated in the audit — fail-closed
# Architect review finding 9: do NOT use a keyword-count grep that can pass
# on prose. Require CONCRETE structural content: each exported name must
# appear in a table/list entry or heading (not just mentioned in prose).
AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
for NAME in dispatchInteractiveOrNonInteractive formatNonInteractiveError initializeOutputListenersAndFlush installNonInteractiveSigintHandler setupUnhandledRejectionHandler startInteractiveUI; do
  # Require the name to appear in a markdown list/table/heading context (line
  # starts with - | or # or contains backtick-quoted name).
  grep -qE "^\s*(-|\||#|.*\`.*${NAME})" "$AUDIT" || { echo "FAIL: exported name '$NAME' not in a structural entry (list/table/heading/code) — finding 9"; exit 1; }
done
echo "OK: all six exported names in structural entries"

# Verdict present — fail-closed (must be an explicit "Verdict X:" heading or
# labeled line, not just the word appearing in prose — finding 9)
grep -qE "Verdict [ABC]:" "$AUDIT" || { echo "FAIL: no explicit 'Verdict X:' verdict in seam audit (finding 9 — require labeled verdict, not keyword hit)"; exit 1; }

# validateDnsResolutionOrder NOT in session modules (not moved) — fail-closed
grep -qn "validateDnsResolutionOrder" packages/cli/src/cliBootstrap.tsx || { echo "FAIL: validateDnsResolutionOrder not in cliBootstrap"; exit 1; }
SESSION_DNS="$(grep -rn "validateDnsResolutionOrder" packages/cli/src/session/ 2>/dev/null || true)"
test -z "$SESSION_DNS" || { echo "FAIL: validateDnsResolutionOrder moved to session/"; exit 1; }

# No production code modified by this phase (analysis-only — finding 2) — fail-closed
git diff --name-only HEAD -- packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx packages/cli/src/session/ | grep -q . && { echo "FAIL: production code modified by P10 (analysis-only phase)"; exit 1; } || echo "OK: no production changes by P10"
```

## Deferred Implementation Detection (revision 6 finding 9: scoped to executable artifacts)

```bash
# Revision 6 architect finding 9: plan/analysis .md artifacts legitimately
# contain words like "placeholder" or "for now" when describing what to detect.
# Do NOT scan .md analysis docs for forbidden implementation words. P10 is an
# analysis-only phase — it produces no executable code. The only check is that
# the seam audit document exists and has substantive content (not that it
# avoids planning vocabulary).
test -s project-plans/issue2285/analysis/cli-session-seam-audit.md || { echo "FAIL: seam audit document missing or empty"; exit 1; }
echo "OK: no executable artifacts to scan (analysis-only phase)"

## Success Criteria
- Exact seam audit document created with: module surface inventory, candidate
  module map, intra-split dependency edges, seam cleanliness verdict.
- NO production code modified (analysis-only — architect finding 2).
- Verdict (A, B, or C) documented. If B, the entanglement is flagged for
  P11/P12 but NO extraction happens in this phase. If C (revision 3 finding
  22 + architect review finding 4), the phase STOPS: P10a will fail with no
  completion marker unless the coordinator revises the plan (producing
  `P10a.revised-plan.md`) — it does NOT proceed to P11/P12 with a
  forbidden-seam-dependent strategy.
- **Architect review finding 6**: the deferred-language check does NOT scan
  `.md` planning docs (they legitimately contain planning vocabulary).
  Instead: the seam audit document has substantive content, and no
  executable/source artifacts were produced by this phase.
- No lint loosening.

## Failure Recovery

This phase does NOT use `git checkout` rollback. Instead:
- If the seam audit reveals deep entanglement (Verdict B): document it and
  flag it for P11/P12. Do NOT extract anything (finding 2).
- If the audit reveals the module has NO clean seams (Verdict B): document
  this and escalate to the coordinator — the split strategy (P12) may need
  revision.
- If the audit reveals the entanglement requires a forbidden production seam
  (Verdict C — revision 3 finding 22): STOP and escalate for plan revision.
  Record the specific seam and the P11/P12 constraint it violates.
- Report any blocking issue.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P10.md`.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
