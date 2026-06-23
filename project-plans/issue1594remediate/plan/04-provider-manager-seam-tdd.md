<!-- @plan:PLAN-20260621-COREAPIREMED.P04 @requirement:REQ-005,REQ-001.2 -->
# Phase 04: Providers `providerManager?` Adoption Seam — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P04`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 03a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P03a.md`

## Requirements Implemented (Expanded)

### REQ-005.2 / REQ-001.2 (providers seam behavior)

**Full Text (REQ-005.2)**: The provider runtime reachable from an `Agent` built via `fromConfig`
MUST be backed by the SAME `ProviderManager` already associated with the supplied `Config` — no
second manager is constructed.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a real `ProviderManager` instance `pm`
- WHEN `createIsolatedRuntimeContext({ config, settingsService, messageBus, providerManager: pm })`
  resolves
- THEN `handle.providerManager === pm` (instance identity — the SAME object is adopted)
- AND GIVEN no `providerManager` option, WHEN the context is built, THEN
  `handle.providerManager` is a freshly constructed manager (current behavior preserved) and is
  NOT any previously supplied instance.

## Implementation Tasks

### Files to Create

- `packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts`
  - 8–12 BEHAVIORAL tests, ≥30% property-based (`fast-check`). Use REAL `ProviderManager`,
    `SettingsService`, and a REAL `Config` from the providers/agents test bootstrap (same pattern
    the existing runtime-context tests use). NO mock theater, NO `toHaveBeenCalled`.
  - MUST include marker block `@plan:PLAN-20260621-COREAPIREMED.P04`, `@requirement:REQ-005.2`.

### Required test scenarios (behavioral)

```
T1  given a ProviderManager pm, createIsolatedRuntimeContext({..., providerManager: pm})
      -> handle.providerManager === pm  (instance identity)  [LOAD-BEARING RED: fails vs the P03
         stub, which builds a fresh manager unconditionally — drives P05 adoption]
T2  omitting providerManager -> handle.providerManager is a fresh manager (!== pm) (default path)
      [legitimately GREEN now — current behavior; not a RED driver]
T3  adopting pm still activates correctly: after handle.activate(), the active runtime resolves
      the adopted manager (getProvider/getModel reflect pm's state), not a divergent one
T4  adopting pm does NOT construct a second manager: instrument the providers construction seam
      (real spy on the ProviderManager constructor / createProviderManager) and assert the count
      does not increase when providerManager is supplied
T5  messageBus adoption still works alongside providerManager adoption (both ?? seams independent)
T6  cleanup() introduces NO NEW disposal of the ProviderManager for EITHER path. The real shipped
      buildCleanupClosure (runtimeContextFactory.ts:400-447) resets infrastructure, clears the
      settings runtime context, flushes the auth scope, invokes options.onCleanup({... providerManager
      ...}), and optionally disposeRuntime — it does NOT dispose/tear down the ProviderManager (grep
      for a providerManager-disposal call in that closure is EMPTY). The adopted-manager path MUST
      therefore behave identically: after cleanup(), the adopted manager is NOT force-disposed (the
      caller still owns it), AND the default (factory-built) manager is treated exactly as today (also
      not disposed by the closure). Assert: cleanup() does not call any disposal method on either
      manager, and onCleanup receives the same manager instance that activation used.
PROP for any options object that includes a providerManager, handle.providerManager === that pm
PROP for any options object that omits providerManager, handle.providerManager is fresh (!== a
      caller-held pm) — adoption never leaks across calls
```

### CRIT-1 note (test typing)

These are BEHAVIORAL identity/count tests, not type tests, so they are unaffected by the CRIT-1
type decision. The fixture `pm` is a REAL `ProviderManager` (which structurally satisfies
`RuntimeProviderManager`), so passing it into the now-`RuntimeProviderManager`-typed
`providerManager?` option compiles cleanly with NO assertion. Do NOT add `as RuntimeProviderManager`
or `as ProviderManager` to the test — a real `ProviderManager` instance is directly assignable to
the structural option type.

### Constraints

- Tests expect REAL adoption behavior. The P03 stub ONLY declares the optional field and KEEPS the
  construction site UNCONDITIONAL (the `??` adoption is withheld to P05), so the IDENTITY test (T1:
  `handle.providerManager === pm`) FAILS RED against the P03 stub — the factory still builds a fresh
  manager that is NOT `pm`. This identity RED is the load-bearing driver for P05 (CRIT-2). T3
  (active-runtime resolution through the adopted manager) and T4 (no-second-construction count) are
  ALSO RED until P05. T6 asserts the cleanup CONTRACT (no NEW disposal of either manager + onCleanup
  receives the manager activation used): its no-disposal half is already true today (the shipped
  closure never disposes a manager), but its "onCleanup receives the ADOPTED manager" half is RED
  until P05 makes adoption real. T2/PROP-default (freshness when the option is omitted) legitimately
  stays GREEN (it is current behavior) — but the suite as a whole MUST be RED because the adoption
  tests fail. See RED-state rule below.
  - DO NOT assert any "default-path manager IS torn down" behavior — the real cleanup closure does
    NOT dispose the ProviderManager for either path (verified: runtimeContextFactory.ts:400-447 has no
    providerManager-disposal call). Asserting teardown that does not exist would be testing fiction.
- NO reverse testing (`toThrow('NotYetImplemented')`, `not.toThrow()`).
- NO structure-only assertions; assert identities, counts, and resolved values.
- Each test carries a behavior-driven docblock (@requirement/@scenario/@given/@when/@then).

## Verification Commands

```bash
set -e
T=packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts
test -f "$T" || { echo "MISSING test file"; exit 1; }

# Behavioral assertions present
grep -qE "toBe\(|toEqual\(|toThrow\(" "$T" || { echo "FAIL: no behavioral asserts"; exit 1; }

# Mock theater / reverse testing guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$T"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$T"; then echo "FAIL: reverse test"; exit 1; fi

# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions, so a
# single property block with several `fc.assert`/`fc.property` calls is NOT over-counted; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "$T")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests found"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi

# RED-state enforcement (BLOCKING): the new behavioral tests MUST fail for a behavioral reason now.
# The IDENTITY test (T1) is the load-bearing RED (CRIT-2): the P03 stub keeps construction
# unconditional, so handle.providerManager is a FRESH manager, NOT the supplied pm.
set +e
npx vitest run "$T" > /tmp/p04_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p04_red.log
if [ "$STATUS" -eq 0 ]; then
  echo "FAIL: tests unexpectedly PASS before P05 implementation — adoption identity test (T1) must be RED against the P03 stub (CRIT-2)."; exit 1
fi
# RED reason must be a behavioral failure or a stub/missing-method behavior — NOT a module/compile/
# import error. Per dev-docs/PLAN.md:733-737 a `TypeError: ... is not a function` (missing method/
# stub) is an ACCEPTABLE natural RED, so it is NOT rejected here; reject ONLY genuine import/compile/
# transpile/setup failures (the test never ran).
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p04_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (adoption absent until P05)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Tests assert instance identity (adopt), freshness (default), active-runtime resolution,
      no-second-construction count, cleanup contract — not mocks.
- [ ] ≥30% property-based (computed, enforced).
- [ ] The adoption IDENTITY test (T1) currently FAILS (RED) against the P03 stub (construction is
      unconditional), alongside T3/T4/T6 — RED for behavioral reasons, not import/compile errors.
- [ ] No reverse testing, no mock theater, no structure-only assertions.

## Success Criteria

- 8+ behavioral tests authored; ≥30% property-based; RED for the right (behavioral) reason.

## Failure Recovery

- `git checkout -- packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts
for F in "packages/providers/src/runtime/__tests__/providerManagerAdoption.behavior.test.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P04.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

