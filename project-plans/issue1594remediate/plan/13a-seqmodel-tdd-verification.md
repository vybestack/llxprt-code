<!-- @plan:PLAN-20260621-COREAPIREMED.P13a @requirement:REQ-003 -->
# Phase 13a: getCurrentSequenceModel TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P13a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 13 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P13.md`

## Verification Goal

Confirm the Phase 13 behavioral tests for `getCurrentSequenceModel` (REQ-003) are correct, behavioral,
RED for the right reason, and free of fraud patterns.

## Verification Commands

```bash
set -e
shopt -s nullglob
SEQ=(packages/agents/src/api/__tests__/*seq*)
if [ ${#SEQ[@]} -eq 0 ]; then echo "FAIL: no seqmodel test file"; exit 1; fi
echo "test file(s): ${SEQ[*]}"
# No reverse testing / no mock theater / no structure-only (BLOCKING)
if grep -rnE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "${SEQ[@]}"; then echo "FAIL: reverse test"; exit 1; fi
if grep -rnE "toHaveBeenCalled" "${SEQ[@]}"; then echo "FAIL: mock theater"; exit 1; fi
# Behavioral assertions present
grep -rnE "toBe\(|toEqual\(|toBeNull\(\)" "${SEQ[@]}" || { echo "FAIL no behavioral asserts"; exit 1; }
# Property ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
TOTAL=$(grep -rcE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "${SEQ[@]}" | awk -F: '{s+=$2} END{print s+0}')
PROP_CASE_FORMS=$(grep -rcE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "${SEQ[@]}" | awk -F: '{s+=$2} END{print s+0}')
CLASSIC_PROP_BLOCKS=$(awk '
  FNR==1 { blk=0; delete counted }
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "${SEQ[@]}")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests found"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi
# RED-state enforcement (BLOCKING): tests must FAIL for a behavioral reason (stub returns null).
set +e
npx vitest run "${SEQ[@]}" > /tmp/p13a_red.log 2>&1
STATUS=$?
set -e
tail -20 /tmp/p13a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly PASS before P14 (expected RED)."; exit 1; fi
# Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`) is an
# ACCEPTABLE natural behavioral RED — do NOT reject it (CRIT-3); a stub return (null) reaching the
# assertion is also acceptable. Reject ONLY genuine module/compile/import/transpile failures.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p13a_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P14)."
```

### Semantic Verification Checklist

- [ ] Tests assert delegation to the bound client's current sequence model (real value), not null.
- [ ] A rebind scenario asserts the value reflects the NEW client after `resolveClient()`.
- [ ] `null` is asserted for the genuine no-active-model case (not as reverse-testing a stub).
- [ ] ≥30% property-based; no mock theater; no reverse testing; behavioral assertions present.
- [ ] RED for the right reason against the current stub (`agentImpl.ts:668 return null`).

## Holistic Functionality Assessment (MANDATORY — into marker)

### What do the tests verify? ### Would they fail if the stub remained? ### Verdict (PASS/FAIL)

## Success Criteria

- Tests are behavioral, property-inclusive, fraud-free, and RED for the right reason.

## Failure Recovery

- Return to Phase 13; do not proceed to Phase 14.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P13a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P13a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

