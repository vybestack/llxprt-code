<!-- @plan:PLAN-20260621-COREAPIREMED.P04a @requirement:REQ-005,REQ-001.2 -->
# Phase 04a: Providers `providerManager?` Adoption Seam — TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P04a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 04 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P04.md`

## Verification Commands

```bash
set -e
T=packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts
test -f "$T" || { echo "FAIL: missing test file"; exit 1; }

# Behavioral assertions present
grep -qE "toBe\(|toEqual\(|toThrow\(" "$T" || { echo "FAIL: no behavioral asserts"; exit 1; }

# Mock theater / reverse-test guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$T"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$T"; then echo "FAIL: reverse test"; exit 1; fi

# Identity-vs-freshness coverage present
grep -qE "providerManager === |toBe\(pm\)" "$T" || { echo "FAIL: no instance-identity assertion"; exit 1; }

# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "$T")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi

# RED-state confirmation (BLOCKING): the adoption tests fail for behavioral reasons. The IDENTITY
# test (T1) is the load-bearing RED — the P03 stub keeps construction unconditional, so the suite
# MUST be RED here (CRIT-2). If the suite is GREEN, P03 wrongly wrote the `??` adoption early.
set +e
npx vitest run "$T" > /tmp/p04a_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p04a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly green pre-impl — adoption identity (T1) must be RED vs the P03 stub (CRIT-2: stub must NOT contain the '??' adoption)"; exit 1; fi
# Per dev-docs/PLAN.md:733-737 a `TypeError: ... is not a function` (missing method/stub) is an
# ACCEPTABLE natural RED — do NOT reject it. Reject ONLY genuine module/compile/import failures.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p04a_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not behavioral"; exit 1
fi
echo "PASS: RED confirmed for behavioral reasons (adoption absent until P05)."
```

## Semantic Verification Checklist (BLOCKS progression)

- [ ] Tests are behavioral (identity, freshness, active-runtime resolution, construction count,
      cleanup), not mock theater.
- [ ] ≥30% property-based (computed, enforced).
- [ ] The adoption IDENTITY test (T1) is RED against the P03 stub (which must NOT contain the `??`
      adoption); RED is behavioral, not a module/compile/import error.
- [ ] No reverse testing.

## Verdict

Record PASS/FAIL with pasted evidence for every command. PASS only if ALL commands exit 0 and ALL
checklist items hold.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P04a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P04a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

