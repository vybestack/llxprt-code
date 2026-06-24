<!-- @plan:PLAN-20260621-COREAPIREMED.P13 @requirement:REQ-003 -->
# Phase 13: getCurrentSequenceModel — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P13`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 12a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P12a.md`

## Requirements Implemented (Expanded)

### REQ-003: Real getCurrentSequenceModel

**Full Text**: `Agent.getCurrentSequenceModel()` MUST return the bound client's current
load-balancer sequence model (or `null` when none), by delegating to the bound
`AgentClientContract.getCurrentSequenceModel()`. It MUST NOT return a hardcoded `null` stub.
- **REQ-003.1**: returns `null` (no throw) when there is no bound client yet.
- **REQ-003.2**: after a provider/model switch + rebuild, reflects the NEW client's value
  (never a cached client — R-CLIENT).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN an agent whose bound client has sticky sequence model `"gpt-4o"`
- WHEN `agent.getCurrentSequenceModel()` is called
- THEN it returns `"gpt-4o"`
- GIVEN no bound client (pre-ready) → returns `null`
- GIVEN a switch to a new client reporting `"claude-x"` → returns `"claude-x"`

**Note**: The existing stub causes this to ALWAYS return null today, which is why
`getCurrentSequenceModel() ?? getModel()` consumers silently fall back. This test proves the
real value flows through.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts`
  - Use the existing `__tests__/helpers/rebuildLoopProbe.ts` pattern to inject a `resolveClient`
    returning a controllable fake `AgentClientContract` whose `getCurrentSequenceModel()` returns
    a configured value — OR construct a real agent and set the client's sequence model via the
    real path. Prefer a REAL client where feasible; the probe is acceptable since `resolveClient`
    is the documented dependency seam (NOT mock theater — it is the injected dependency).
  - Markers `@plan:PLAN-20260621-COREAPIREMED.P13`, `@requirement:REQ-003`.

### Required scenarios

```
T9a  client reports "gpt-4o" → agent returns "gpt-4o"
T9b  client reports null     → agent returns null
T9c  no client (resolveClient returns undefined/throws-not) → agent returns null (no throw)
T9d  after rebind, resolveClient returns a new client reporting "claude-x" → agent returns
     "claude-x" (proves no caching; calls resolveClient fresh each time)
PROP for any model string s, when the client reports s, the agent returns s (round-trip)
PROP for the consumer pattern, (agent.getCurrentSequenceModel() ?? agent.getModel()) equals
     the client's sequence model when present, else getModel()
```

### Constraints

- Assert real return VALUES, not that resolveClient was called.
- ≥30% property-based.
- RED for the right reason (stub returns null) — but do NOT write a reverse test asserting null
  as the stub behavior; the null cases (T9b/T9c) are genuine contract cases, distinguished from
  the positive cases (T9a/T9d) which FAIL against the stub.

## Verification Commands

```bash
set -e
F=packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts
test -f "$F"

# Mock theater / reverse testing guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions, so a
# single property block with several `fc.assert`/`fc.property` calls is NOT over-counted; MIN-2).
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

# RED-state enforcement (BLOCKING): the POSITIVE delegation cases (T9a/T9d) MUST fail against the
# stub for a BEHAVIORAL reason. (Null-return cases are genuine contract cases and may already pass;
# this is why we require the overall run to be RED AND require the positive cases to be present.)
grep -qE "T9a|T9d" "$F" || { echo "FAIL: positive delegation cases (T9a/T9d) missing"; exit 1; }
set +e
npx vitest run "$F" > /tmp/p13_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p13_red.log
if [ "$STATUS" -eq 0 ]; then
  echo "FAIL: suite unexpectedly all-green before P14 — positive delegation cases must be RED."; exit 1
fi
# Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`) is an
# ACCEPTABLE natural behavioral RED — do NOT reject it (CRIT-3); a stub return/throw reaching the
# assertion is also acceptable. Reject ONLY genuine module/compile/import/transpile failures.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p13_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons on positive delegation cases (expected until P14)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Positive cases (T9a/T9d) FAIL against the stub for a BEHAVIORAL reason (real delegation needed).
- [ ] Null cases are genuine contract cases, not reverse-tests of the stub.
- [ ] ≥30% property-based (computed, enforced).
- [ ] No mock theater.

## Success Criteria

- Behavioral tests authored; positive cases RED; ≥30% property-based.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts
for F in "packages/agents/src/api/__tests__/agent.sequenceModel.behavior.test.ts"; do
  test -f "$F" || continue
  # No deferred-implementation placeholder language in the new test/helper file.
  if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then
    echo "FAIL: deferred-implementation marker in $F"; exit 1
  fi
  # Reverse-test ban (scoped): no test that asserts the FAILURE/absence as the desired end state.
  if grep -niE "expect\\(.*\\)\\.(not)\\.toBeDefined|toThrow\\(.*NotYetImplemented|should (not )?be implemented|reverse test|negative test \\(expected\\)" "$F"; then
    echo "FAIL: reverse/weakened-test pattern in $F"; exit 1
  fi
  # No test.skip/it.skip/xit/xdescribe smuggling a deferred test past RED.
  if grep -nE "\\b(it|test|describe)\\.skip\\b|\\bxit\\b|\\bxdescribe\\b" "$F"; then
    echo "FAIL: skipped/disabled test in $F (would mask a deferred behavior)"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers / reverse tests in the new spec/helper file(s)."
```

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P13.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P13
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

