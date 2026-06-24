<!-- @plan:PLAN-20260621-COREAPIREMED.P11a @requirement:REQ-002,REQ-INT-003 -->
# Phase 11a: Settings Surface TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P11a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 11 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P11.md`

## Verification Tasks

```bash
set -e
F=packages/agents/src/api/__tests__/agent.settings.behavior.test.ts
test -f "$F"
# Mock theater / reverse testing guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests found"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi
# RED-state enforcement (BLOCKING): tests must FAIL for a behavioral reason before P12 impl.
set +e
npx vitest run "$F" > /tmp/p11a_red.log 2>&1
STATUS=$?
set -e
tail -25 /tmp/p11a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly PASS before P12 (expected RED)."; exit 1; fi
# CRIT-2: the getConfig identity test (T3) is ALREADY GREEN (getConfig was declared on the Agent
# interface in P06 and implemented for real at P09; P11 runs after P09). The suite is RED OVERALL
# (non-zero exit) because the EPHEMERAL tests (T3b/T3c/T3d/T3e/T8 +
# PROPs) hit the P10 stubs. Do NOT treat a green T3 as a failure of the RED expectation; the
# non-zero suite exit is what is required here.
# ACCEPTABLE behavioral RED for THIS phase: the settings-surface stub (P10) throws
# `NotYetImplemented`, so a delegation/value-parity assertion REACHES the stub and fails on the real
# value. That is legitimate behavioral RED (the test must NOT reverse-assert the error — reverse
# tests are already rejected above). UNACCEPTABLE RED is a setup/compile/missing-symbol error (the
# test never ran). Per dev-docs/PLAN.md:733-737, a missing-method/stub RED
# (`TypeError: ... is not a function`) is an ACCEPTABLE natural behavioral RED — do NOT reject it
# (CRIT-3); a thrown `NotYetImplemented` reaching the assertion is also acceptable. Reject ONLY
# genuine module/compile/import/transpile failures where the test never ran.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p11a_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P12; incl. acceptable stub-thrown NotYetImplemented / missing-method, never reverse-asserted)."
```

### Semantic Verification Checklist

- [ ] Tests prove delegation against a REAL Config (value parity, identity, error propagation).
- [ ] T3e specifically proves NO parallel store (Config-direct write visible via agent).
- [ ] ≥30% property-based.
- [ ] RED for the right reason; no mock theater/reverse/structure-only.

## Holistic Assessment (MANDATORY)

Could any test pass if the agent kept its own Map instead of delegating? If yes, tests are
insufficient — FAIL. Verdict PASS/FAIL.

## Success Criteria

- All checks pass.

## Failure Recovery

- Return to Phase 11.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P11a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P11a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

