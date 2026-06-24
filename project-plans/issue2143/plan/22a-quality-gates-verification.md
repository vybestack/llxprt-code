<!-- @plan:PLAN-20260622-COREAPIGAP.P22a @requirement:REQ-001,REQ-002,REQ-003,REQ-004,REQ-005,REQ-006,REQ-007,REQ-008,REQ-009,REQ-010,REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004,REQ-INT-005 -->
# Phase 22a: Quality Gates — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P22a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 22 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P22.md`

## Purpose

Independently re-confirm the full suite is green and the mutation gate genuinely cleared ≥80% over
the new/changed API surface — and that the mutation pass is non-vacuous (the new controls actually
have killed mutants, not zero-mutant files). Confirm no deferred work / prose comments slipped into
production.

## Verification Commands

```bash
set -o pipefail
set -e

# 1. Re-run the deterministic core gates (fast, non-flaky).
npm run typecheck 2>&1 | tail -12
npm run lint 2>&1 | tail -20
npm run build 2>&1 | tail -15

# 2. Agents API test surface green in isolation (avoids root-orchestrator contention).
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p22a_api.log 2>&1 || { echo "FAIL: agents api suite"; tail -80 /tmp/p22a_api.log; exit 1; }
echo "agents api suite green"

# 3. Mutation evidence exists and is ≥80% AND non-vacuous for the NEW controls.
M=packages/agents/reports/mutation/mutation.json
test -f "$M" || { echo "FAIL: no mutation report (P22 must run Stryker)"; exit 1; }
OVERALL=$(jq -r '.. | objects | .mutationScore? // empty' "$M" | tail -1)
echo "overall api mutation: $OVERALL"
awk -v s="$OVERALL" 'BEGIN{ if (s+0 < 80) { print "FAIL: overall < 80%"; exit 1 } }'
# Non-vacuity: each new control file must have a NON-ZERO mutant count and per-file score >=80.
for C in policyControl tasksControl toolKeysControl; do
  KEY="src/api/control/$C.ts"
  FSCORE=$(jq -r --arg k "$KEY" '.files | to_entries[] | select(.key|endswith($k)) | .value.mutationScore' "$M" 2>/dev/null | head -1)
  MUTS=$(jq -r --arg k "$KEY" '.files | to_entries[] | select(.key|endswith($k)) | (.value.mutants|length)' "$M" 2>/dev/null | head -1)
  echo "$C: score=$FSCORE mutants=$MUTS"
  [ -n "$MUTS" ] && [ "$MUTS" -gt 0 ] || { echo "FAIL: $C has zero mutants (vacuous)"; exit 1; }
  awk -v s="$FSCORE" -v c="$C" 'BEGIN{ if (s+0 < 80) { print "FAIL: "c" per-file mutation < 80%"; exit 1 } }'
done
echo "per-file mutation non-vacuous and >=80%"

# 4. No deferred work / non-marker prose comments in new production code.
if grep -rnE "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|not yet implemented|placeholder|for now)" packages/agents/src/api --include="*.ts" | grep -vE "/__tests__/"; then
  echo "FAIL: deferred marker in production"; exit 1; fi
for C in policyControl tasksControl toolKeysControl; do
  P="packages/agents/src/api/control/$C.ts"
  if grep -nE "^\s*//" "$P" | grep -vE "@plan:|@requirement:|@pseudocode"; then echo "FAIL: prose comment in $P"; exit 1; fi
done
echo "PASS: P22a quality gates verified."
```

> NOTE on `npm run test` flakes: if P22's marker documents a root-orchestrator flake that passed in
> isolation, re-run that SAME file in isolation here to confirm. Do NOT accept a "flaky, ignored"
> claim without an isolated-green reproduction.

## Holistic Assessment (MANDATORY — into marker)

- **Suite**: deterministic gates (typecheck/lint/build) green; agents API suite green in isolation.
- **Mutation**: overall ≥80% AND each new control non-vacuous (non-zero mutants) and individually
  ≥80% — cite the per-file scores. The smoke haiku printed (cite from P22 marker).
- **Hygiene**: no deferred work / non-marker comments in new production code.
- **Verdict**: PASS/FAIL with evidence.

## Success Criteria

- All gates re-confirmed; mutation ≥80% and non-vacuous on new controls; verdict PASS.

## Failure Recovery

- Reopen the owning component phase to strengthen behavioral tests for mutation survivors; never
  relax the threshold or weaken a test.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P22a.md` (paste per-file mutation scores + verdict).

```markdown
Phase: P22a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only)
Verification: [paste actual output incl. per-file mutation scores]
Holistic Assessment: [PASS/FAIL; mutation non-vacuity evidence; suite-green confirmation]
```
