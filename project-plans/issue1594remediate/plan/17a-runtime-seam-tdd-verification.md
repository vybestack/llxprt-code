<!-- @plan:PLAN-20260621-COREAPIREMED.P17a @requirement:REQ-005,REQ-001 -->
# Phase 17a: Provider-Runtime Seam TDD Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P17a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 17 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P17.md`

## Verification Goal

Confirm the Phase 17 behavioral tests for `getRuntimeId` + no-second-ProviderManager (REQ-005,
REQ-001.2) are behavioral, RED for the right reason, fraud-free, and assert adoption by identity.

## Verification Commands

```bash
set -e
F=packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts
test -f "$F"
# BLOCKING guards
if grep -n "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
# Tests must not assert a raw getProviderManager at root (it is NOT exposed there); identity is
# proven via config.getProviderManager() on the supplied Config, not an agent-root accessor.
if grep -nE "agent\.getProviderManager|\.providers\.getProviderManager" "$F"; then echo "FAIL: asserts raw manager at root"; exit 1; fi
grep -nE "toBe\(|toEqual\(" "$F" || { echo "FAIL no behavioral asserts"; exit 1; }
# Property ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
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
# RED-state enforcement (BLOCKING): getRuntimeId absent today → tests fail behaviorally before P18.
set +e
npx vitest run "$F" > /tmp/p17a_red.log 2>&1
STATUS=$?
set -e
tail -20 /tmp/p17a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly PASS before P18 (expected RED)."; exit 1; fi
if grep -qiE "Cannot find module|SyntaxError|ReferenceError" /tmp/p17a_red.log; then
  echo "FAIL: RED is a setup/compile error, not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed (expected until P18)."
```

> NOTE on RED reason: because `getRuntimeId` may not exist on the interface yet, a `TypeError: ... is
> not a function` IS the legitimate behavioral RED here (the method genuinely does not exist), so it
> is intentionally NOT in the setup/compile reject list above. `Cannot find module`/`SyntaxError`/
> `ReferenceError` remain rejected as setup errors.

### Semantic Verification Checklist

- [ ] `getRuntimeId` test asserts equality with the runtimeId used to build the runtime context
      (threaded known sessionId/runtimeId), for the fromConfig path.
- [ ] no-second-manager test asserts INSTANCE IDENTITY between the manager reachable post-build and
      the one on the supplied Config (proves adoption, not reconstruction).
- [ ] providers.* reflect adopted runtime (real values).
- [ ] ≥30% property-based; no mock theater; does not assert a raw `getProviderManager` at root.
- [ ] RED for the right reason (getRuntimeId absent today — grep confirmed 0 matches in api/).

## Holistic Functionality Assessment (MANDATORY — into marker)

### What do the tests verify? ### Do they prove adoption by identity (no 2nd manager)? ### Verdict

## Success Criteria

- Tests behavioral, identity-based for adoption, property-inclusive, fraud-free, RED for right reason.

## Failure Recovery

- Return to Phase 17; do not proceed to Phase 18.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P17a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P17a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

