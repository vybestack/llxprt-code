# Phase 11a: Core Behavior Harness Verification

## Phase ID

`PLAN-20260617-COREAPI.P11a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 11 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P11" packages/agents/src/api/__tests__/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P11"
# N4: hard-fail on any missing T-row
missing=0
for t in T1 T2 T2b T3 T3b T3c T6 T7 T8 T8b T9 T10 T11 T14 T14b T21 T22; do
  grep -rq "$t\b" packages/agents/src/api/__tests__/core-*.spec.ts || { echo "MISSING $t"; missing=1; }
done
[ "$missing" -eq 0 ] || { echo "FAIL: missing T-rows"; exit 1; }

# B9 property-based report (NON-blocking here; the HARD gate is P29). Computes the
# SAME numerator/denominator P29 uses, but scoped to this layer for visibility.
DENOM=$(grep -rlE "@plan:PLAN-20260617-COREAPI" packages/agents/src/api/__tests__/core-*.spec.ts \
  | xargs grep -hcE "\b(it|test)\s*\(" | paste -sd+ - | bc)
NUMER=$(grep -rlE "@plan:PLAN-20260617-COREAPI" packages/agents/src/api/__tests__/core-*.spec.ts \
  | xargs grep -hcE "fc\.assert|test\.prop|it\.prop" | paste -sd+ - | bc)
echo "layer property-based: $NUMER / $DENOM"

# N4: hard-fail on mock theater / reverse testing
if grep -rn "toHaveBeenCalled\|not\.toThrow\|NotYetImplemented" packages/agents/src/api/__tests__/core-*.spec.ts; then
  echo "FAIL mock/reverse"; exit 1
fi
echo "OK"
```

## Semantic Verification Checklist (MANDATORY)

1. Does each T-row assert real behavior/values (history contents, event sequences)?
2. Is mock theater absent (real Agent/FakeProvider/scheduler/MessageBus)?
3. Is the layer property-based report printed? (The HARD ≥30% gate is GLOBAL in P29,
   computed across the full harness; this layer report is informational — B9.)
4. Do tests fail for the right reason (impl absent), not reverse-test?
5. Are JSONL fixtures used (file-based FakeProvider)?

### Holistic Functionality Assessment (completion marker)

- Confirm this layer is the executable contract for core conversation behavior.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if behavioral, fails naturally, all T-rows present, and the B9 property
  report is emitted (global ≥30% enforced in P29).

## Failure Recovery

- Return to Phase 11.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P11a.md`
