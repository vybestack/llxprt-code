<!-- @plan:PLAN-20260621-COREAPIREMED.P11 @requirement:REQ-002,REQ-INT-003 -->
# Phase 11: Agent Settings/Config Surface — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P11`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 10a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P10a.md`

## Requirements Implemented (Expanded)

### REQ-002 / REQ-002.1 / REQ-002.2 / REQ-002.3 / REQ-INT-003

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN an agent bound to a real `Config`
- WHEN `setEphemeralSetting('context-limit', 100000)` then `getEphemeralSetting('context-limit')`
- THEN the value round-trips with Config's normalization applied (NOT re-applied by the agent)
- AND `getConfig()` returns the SAME instance (`===`)
- AND `getEphemeralSettings()` equals `config.getEphemeralSettings()` (same normalized map)
- AND setting `streaming` to a non-string PROPAGATES the Config error (not swallowed)
- AND a side-effecting key (e.g. `base-url`) triggers Config's provider-cache clear (observed via
  Config behavior, not via a spy)

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/agent.settings.behavior.test.ts`
  - 12–16 behavioral tests, ≥30% property-based.
  - Build a real `Config` + real agent (via `fromConfig` from P09, or createAgent test bootstrap).
  - NO mocks of Config; assert real values and identities.
  - Markers `@plan:PLAN-20260621-COREAPIREMED.P11`, `@requirement:REQ-002`.

> CRIT-2 NOTE: `getConfig()` was DECLARED on the `Agent` interface in P06 and IMPLEMENTED for real
> at P09 (it returns the bound `this.deps.config`); P11 runs after P09, so T3 below is EXPECTED to be
> GREEN already — it is a coverage/identity assertion against the existing member, NOT the RED driver
> for this phase. The genuine RED drivers here are the EPHEMERAL methods (T3b/T3c/T3d/T3e/T8 + PROPs),
> which are stubs until P12. The suite is RED overall (non-zero exit) because those ephemeral tests
> fail behaviorally.

### Required scenarios

```
T3   getConfig() === bound Config (identity) — already GREEN from P09 (declared P06); coverage assertion, not a driver
T3b  get/set round-trip for several keys returns Config-normalized values
T3c  getEphemeralSettings() deep-equals config.getEphemeralSettings()
T3d  setEphemeralSetting('streaming', 123) throws (propagated from Config), not swallowed
T3e  agent does NOT keep a parallel store: a value set directly on Config is visible via
     agent.getEphemeralSetting (proves delegation, not a local cache)
T8   normalization parity: agent.getEphemeralSetting('context-limit') equals
     config.getEphemeralSetting('context-limit') for representative inputs
PROP for any string key + JSON-serializable value (excluding the throwing streaming case),
     set-then-get via the agent equals set-then-get directly on Config
PROP for any key, agent.getEphemeralSettings()[key] === config.getEphemeralSettings()[key]
```

### Constraints

- Tests MUST NOT ASSERT a NotYetImplemented error (no reverse-testing). A stub-thrown
  NotYetImplemented is an ACCEPTABLE behavioral RED ONLY IF the test actually executed the call and
  no test expects that specific error — i.e., the RED comes from absent behavior, not from a
  compile/module/import failure.
- No mock theater; no structure-only assertions; behavior-driven docblocks required.

## Verification Commands

```bash
set -e
F=packages/agents/src/api/__tests__/agent.settings.behavior.test.ts
test -f "$F"
grep -qE "toBe\(|toEqual\(|toThrow\(" "$F" || { echo "FAIL: no behavioral asserts"; exit 1; }

# Mock theater / reverse testing guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

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

# RED-state enforcement (BLOCKING): tests MUST fail for a BEHAVIORAL reason before P12.
set +e
npx vitest run "$F" > /tmp/p11_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p11_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly PASS before P12 (expected RED)."; exit 1; fi
# Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`) is an
# ACCEPTABLE natural behavioral RED — do NOT reject it (CRIT-3); a stub-thrown `NotYetImplemented`
# reaching the assertion is also acceptable. Reject ONLY genuine module/compile/import failures.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p11_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P12)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Tests assert delegation (values match Config), identity, error propagation — not mocks.
- [ ] ≥30% property-based (computed, enforced).
- [ ] Tests are RED for a BEHAVIORAL reason because impl is a stub.

## Success Criteria

- 12+ behavioral tests; ≥30% property-based; RED for the right reason.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/agent.settings.behavior.test.ts
for F in "packages/agents/src/api/__tests__/agent.settings.behavior.test.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P11.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

