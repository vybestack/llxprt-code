<!-- @plan:PLAN-20260621-COREAPIREMED.P08a @requirement:REQ-001,REQ-INT-001 -->
# Phase 08a: fromConfig TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P08a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 08 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P08.md`

## Verification Tasks

```bash
set -e
F=packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
test -f "$F"
# No mock theater / reverse testing (BLOCKING — a found violation exits non-zero)
if grep -n "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
# Structure-only assertions are not permitted as the SOLE assertion of a test (BLOCKING)
if grep -nE "toHaveProperty\([^,]+\)\s*;" "$F"; then echo "FAIL: structure-only assertion — assert values"; exit 1; fi

# Property-based ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi

# RED-state confirmation (BLOCKING): tests fail for a BEHAVIORAL reason pre-impl.
set +e
npx vitest run "$F" > /tmp/p08a_red.log 2>&1
STATUS=$?
set -e
tail -25 /tmp/p08a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly green pre-impl (no RED)"; exit 1; fi
# ACCEPTABLE behavioral RED for THIS phase: the P06 `fromConfig` stub throws `NotYetImplemented`, so
# the call REACHES the stub and the test's assertion on the real adopted Config/turn cannot be met.
# That is a legitimate behavioral RED (the test does NOT reverse-assert the error — reverse tests are
# already rejected above). UNACCEPTABLE RED is a setup/compile/missing-symbol error (the test never
# ran). Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`)
# is an ACCEPTABLE natural behavioral RED — do NOT reject it (CRIT-3); a thrown `NotYetImplemented`
# (surfacing as an Error reaching the assertion) is also acceptable. Reject ONLY genuine
# module/compile/import/transpile failures where the test never ran.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p08a_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not behavioral"; exit 1
fi
echo "PASS: RED confirmed for behavioral reasons (incl. acceptable stub-thrown NotYetImplemented / missing-method; never reverse-asserted)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Tests assert real identities/values (Config identity, SettingsService identity, ownership,
      single `done`), not mock invocations.
- [ ] ≥30% property-based (computed, enforced).
- [ ] Tests FAIL for a BEHAVIORAL reason (stub not implemented), not via reverse assertions.
- [ ] Tests use a real Config + real FakeProvider fixture (no mocked engine).
- [ ] Each test has a behavior-driven docblock.

## Holistic Assessment (MANDATORY)

Would these tests PASS only when fromConfig genuinely adopts the Config and drives a real turn?
Could any test pass against an empty implementation? Verdict PASS/FAIL.

## Success Criteria

- All checks pass; tests are genuinely behavioral and RED.

## Failure Recovery

- Return to Phase 08; do not proceed to Phase 09.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P08a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P08a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

