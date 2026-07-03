# Phase 10a: CLI Session Exact Seam Audit Verification

## Phase ID
`PLAN-20260629-ISSUE2285.P10a`

## Prerequisites
- Required: Phase 10 completed.
- Verification: `test -f project-plans/issue2285/.completed/P10.md`.

## Verification Tasks

The deepthinker verifier confirms:

1. **Seam audit document exists** with real content.
2. **Module surface inventory complete**: all six exported names, all internal
   helpers, all types/interfaces, all side effects, all import dependencies,
   and the internal call graph.
3. **Candidate module map present**: each item mapped to a candidate stable
   ownership module with intra-split dependency edges.
4. **Seam cleanliness verdict present** (A, B, or C) with justification.
   **Revision 3 finding 22 + architect review finding 4 (Verdict C cannot be
   bypassed):** if the verdict is C (entanglement requires a forbidden
   production seam), P10a MUST FAIL — it does NOT create a completion marker
   (`.completed/P10a.md` is NOT written). Without the P10a completion marker,
   P11's prerequisite (`test -f .../P10a.md`) fails, blocking the entire
   downstream chain (P11 → P12 → P13 → P13a). The ONLY way to proceed past a
   Verdict C is for a human coordinator to revise the plan (producing a
   `.revised-plan` marker file at
   `project-plans/issue2285/.completed/P10a.revised-plan.md`) that documents
   the accepted scope reduction, permitted seam, or deferred-to-follow-up
   debt. P10a checks for this marker: if Verdict C AND no revised-plan marker
   exists, P10a exits nonzero with NO completion marker. This makes the stop
   condition mechanically unbypassable — the coordinator cannot accidentally
   create P10a.md and proceed, because the verification logic rejects Verdict C
   explicitly.
5. **NO production code modified** (architect finding 2 — analysis-only).
   Confirm `git diff` shows no changes to `cliSessionDispatch.tsx`, `cli.tsx`,
   or any `session/` module.
6. **No executable/source artifacts produced (revision 6 finding 9 + architect
   review finding 6):** P10 is an analysis-only phase — it produces a `.md`
   planning document. The checklist does NOT scan planning `.md` for deferred
   vocabulary (TODO/FIXME/placeholder/etc.) because those words legitimately
   appear in planning prose describing what to detect. Instead, require:
   (a) the seam audit document has substantive content (real module surface
   inventory, not a stub), and (b) NO executable or source artifacts were
   produced by this phase (no `.ts`, `.tsx`, `.mjs`, `.js` files created or
   modified under `packages/`). This aligns the checklist with the commands
   (which check for substantive content and no production diffs, not
   vocabulary in `.md`).
7. **No lint loosening / suppression directives**.

## Verification Commands

```bash
# Seam audit exists — fail-closed
test -s project-plans/issue2285/analysis/cli-session-seam-audit.md || { echo "FAIL: seam audit missing or empty"; exit 1; }

# All six exported names enumerated — fail-closed
# Architect review finding 9: require concrete structural entries, not keyword hits.
AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
for NAME in dispatchInteractiveOrNonInteractive formatNonInteractiveError initializeOutputListenersAndFlush installNonInteractiveSigintHandler setupUnhandledRejectionHandler startInteractiveUI; do
  grep -qE "^\s*(-|\||#|.*\`.*${NAME})" "$AUDIT" || { echo "FAIL: exported name '$NAME' not in a structural entry (finding 9)"; exit 1; }
done
echo "OK: all six exported names in structural entries"

# Verdict present — fail-closed (explicit labeled verdict, not keyword — finding 9)
grep -qE "Verdict [ABC]:" "$AUDIT" || { echo "FAIL: no explicit 'Verdict X:' verdict (finding 9)"; exit 1; }

# Architect review finding 4: Verdict C stop condition is mechanically unbypassable.
# If the verdict is C, P10a FAILS (no completion marker) UNLESS a revised-plan
# marker exists. This prevents P11's prerequisite from being satisfied via a
# Verdict-C P10a completion.
SEAM_AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
REVISED_PLAN_MARKER="project-plans/issue2285/.completed/P10a.revised-plan.md"
if grep -iq "Verdict C" "$SEAM_AUDIT" 2>/dev/null; then
  echo "Verdict C detected in seam audit — checking for revised-plan marker..."
  if [ ! -f "$REVISED_PLAN_MARKER" ]; then
    echo "FAIL: seam audit verdict is C (forbidden-seam entanglement) and no revised-plan marker exists at $REVISED_PLAN_MARKER"
    echo "P10a cannot complete. The coordinator must either:"
    echo "  (a) revise the plan to permit the seam with explicit justification,"
    echo "  (b) accept a smaller-scope split that avoids the forbidden seam, or"
    echo "  (c) defer the remaining entanglement to a follow-up issue with recorded debt."
    echo "After revision, create $REVISED_PLAN_MARKER documenting the decision."
    # Do NOT create the P10a completion marker — this blocks P11/P12/P13/P13a.
    exit 1
  else
    # Architect review finding 10: the revised-plan marker is NOT a bypass.
    # It MUST document how P11/P12/P13 are re-reviewed/updated. Verify it
    # references the downstream phases it affects.
    echo "OK: Verdict C and revised-plan marker exists — verifying downstream sequencing..."
    grep -qE "P11|characterization" "$REVISED_PLAN_MARKER" || { echo "FAIL: revised-plan marker does not reference P11 (characterization) changes — architect review finding 10"; exit 1; }
    grep -qE "P12|split" "$REVISED_PLAN_MARKER" || { echo "FAIL: revised-plan marker does not reference P12 (split) changes — architect review finding 10"; exit 1; }
    grep -qE "P13|verification" "$REVISED_PLAN_MARKER" || { echo "FAIL: revised-plan marker does not reference P13 (final verification) changes — architect review finding 10"; exit 1; }
    echo "OK: revised-plan marker documents P11/P12/P13 downstream sequencing (architect review finding 10)"
  fi
else
  echo "OK: verdict is A or B — no stop condition"
fi

# Side effects enumerated — fail-closed (finding 9: require a structural
# "Side Effects" section, not just keyword hits in prose)
AUDIT="project-plans/issue2285/analysis/cli-session-seam-audit.md"
grep -qE "^#+.*[Ss]ide [Ee]ffect" "$AUDIT" || { echo "FAIL: no 'Side Effects' heading in seam audit (finding 9)"; exit 1; }
# Within that section, at least 3 distinct side-effect types must be listed.
SIDE_EFFECT_HITS="$(grep -cE "process\.on|process\.exit|stdout|stderr|render|appendFileSync|enableMouseEvents|stdin" "$AUDIT" || true)"
test "$SIDE_EFFECT_HITS" -ge 3 || { echo "FAIL: side effects section has fewer than 3 enumerated types (found $SIDE_EFFECT_HITS, finding 9)"; exit 1; }

# NO production code modified (analysis-only — finding 2) — fail-closed
git diff --name-only HEAD -- packages/cli/src/cliSessionDispatch.tsx packages/cli/src/cli.tsx packages/cli/src/session/ | grep -q . && { echo "FAIL: production code modified by P10 (analysis-only phase)"; exit 1; } || echo "OK: no production changes by P10"

# validateDnsResolutionOrder stays in cliBootstrap — fail-closed
grep -qn "validateDnsResolutionOrder" packages/cli/src/cliBootstrap.tsx || { echo "FAIL: validateDnsResolutionOrder not in cliBootstrap"; exit 1; }
SESSION_DNS="$(grep -rn "validateDnsResolutionOrder" packages/cli/src/session/ 2>/dev/null || true)"
test -z "$SESSION_DNS" || { echo "FAIL: validateDnsResolutionOrder moved to session/"; exit 1; }

# Revision 6 architect finding 9: do NOT scan .md analysis docs for forbidden
# implementation words — they legitimately contain planning vocabulary like
# "placeholder" when describing what to detect. P10 is analysis-only; confirm
# the document exists with substantive content instead.
test -s project-plans/issue2285/analysis/cli-session-seam-audit.md || { echo "FAIL: seam audit document missing or empty"; exit 1; }
echo "OK: seam audit document present (analysis-only phase, no executable artifacts to scan)"

# eslint-guard (fail-closed)
npm run lint:eslint-guard
test $? -eq 0 || { echo "FAIL: eslint-guard"; exit 1; }
```

## Semantic Verification Checklist

- [ ] I read the seam audit: the module surface inventory is complete and
      accurate (matches the actual source).
- [ ] The candidate module map covers all responsibilities with clear
      ownership; intra-split dependencies are documented.
- [ ] The verdict (A, B, or C — architect finding 4) is justified by the audit
      evidence. If C, the phase STOPPED: P10a fails with no completion marker
      unless a revised-plan marker (`P10a.revised-plan.md`) exists (architect
      review finding 4 — Verdict C cannot be bypassed). **Architect review
      finding 10:** if the revised-plan marker exists, it MUST document how
      P11/P12/P13 are re-reviewed/updated — the marker is a RE-PLANNING
      artifact consumed by downstream phases, NOT a bypass.
- [ ] **NO production code was modified** in this phase (finding 2). This
      phase is analysis-only. Characterization (P11) must precede extraction
      (P12).
- [ ] The audit gives P11 (characterization) and P12 (split) a grounded seam
      foundation.

## Success Criteria
- PASS: exact seam audit complete with verdict, module surface inventory,
  candidate map. NO production code modified (analysis-only — finding 2).
  P11/P12 have a proven seam foundation.

## Phase Completion Marker
Create `project-plans/issue2285/.completed/P10a.md` — **ONLY if the verdict
is A or B, OR if the verdict is C AND a revised-plan marker
(`P10a.revised-plan.md`) exists** (architect review finding 4). If the verdict
is C and no revised-plan marker exists, P10a exits nonzero and does NOT create
`P10a.md` — this blocks P11/P12/P13/P13a.


The marker MUST contain structured diff evidence per the Standard Completion
Marker Template in `overview.md` (architect finding 8): files changed
(`git diff --name-only` of phase-owned files), diff stats (`git diff --stat`),
command outputs (exit status + key output), and tracker evidence (gate items
satisfied + verifier evidence).
