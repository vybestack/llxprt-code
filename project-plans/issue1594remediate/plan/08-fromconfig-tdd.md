<!-- @plan:PLAN-20260621-COREAPIREMED.P08 @requirement:REQ-001,REQ-INT-001 -->
# Phase 08: Config-Injection Seam — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P08`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 07a completed (PASS) — the early integration-first turn-parity RED slice (P07) is
  authored and confirmed RED, so this TDD phase and the subsequent impl (P09) are driven by it.
- Verification: `test -f project-plans/issue1594remediate/.completed/P07a.md`

## Requirements Implemented (Expanded)

### REQ-001 / REQ-001.1 / REQ-001.2 / REQ-001.3 / REQ-INT-001

**Full Text (REQ-001)**: Provide `fromConfig(options)` that builds an `Agent` from an existing
`Config` without re-constructing `Config`, without breaking `createAgent`.
- **REQ-001.1**: The returned agent's `getConfig()` returns the SAME `Config` instance.
- **REQ-001.2**: The agent's provider runtime (provider/model/runtimeId) is reachable and backed
  by the SAME `SettingsService`/`ProviderManager` (no second manager).
- **REQ-001.3**: A `Config` supplied via `fromConfig` is caller-owned and MUST NOT be disposed by
  `Agent.dispose()`; a `Config` created by `createAgent` IS agent-owned and IS disposed.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a caller-built, initialized `Config` with a known `SettingsService`
- WHEN `fromConfig({ config })` resolves
- THEN `agent.getConfig() === config` AND `agent.getConfig().getSettingsService() === ss`
- AND a turn driven through the agent streams events (smoke), proving the runtime is live
- AND after `agent.dispose()` the supplied `config` is NOT disposed (caller-owned)

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/fromConfig.behavior.test.ts`
  - 12–16 BEHAVIORAL tests, ≥30% property-based (`fast-check`).
  - Use a REAL `Config` built via the existing test bootstrap + a REAL `FakeProvider` JSONL fixture
    (same pattern as #1594 harness). NO mock theater, NO `toHaveBeenCalled`.
  - MUST include marker block `@plan:PLAN-20260621-COREAPIREMED.P08`, `@requirement:REQ-001`.

### Required test scenarios (behavioral)

# CRIT-2: `getConfig()` is DECLARED on the Agent interface from P06 (interface member; its body is a
# NotYetImplemented STUB until P09), so these specs COMPILE. They are RED here for a BEHAVIORAL reason:
# `fromConfig` is a P06 STUB that throws `NotYetImplemented` BEFORE returning an agent, so T1/T1b never
# reach a live agent; even if reached, the `getConfig` stub itself throws `NotYetImplemented` until P09.
# The RED is behavioral (stub-thrown), not a missing-symbol/compile error.
```
T1  given external Config, fromConfig returns Agent whose getConfig() === that Config (identity)
T1b agent.getConfig().getSettingsService() === caller's SettingsService (REQ-INT-001 identity)
T1c fromConfig adopts provider/model already set on the Config (getProvider/getModel reflect it)
T1d fromConfig({} without config) rejects with a clear error (validation)
T1e fromConfig with sessionId sets runtimeId deterministically; without sessionId derives/generates
T6  no second ProviderManager (CRIT-1): when config.getProviderManager() returns a manager, the
    runtime reachable post-build is THAT SAME manager instance (adopted via the providers seam),
    and a provider switch through agent resolves the adopted runtime
T6b providerManager fallback: given a Config with NO manager (getProviderManager() === undefined),
    fromConfig still builds a working runtime with exactly ONE manager (value parity, no crash)
T6c caller MessageBus adoption (CRIT-2): given fromConfig({ config, messageBus }), the bus the
    runtime/OAuth path uses IS the caller-supplied bus instance (identity), NOT a second bus
T6d no Config.getMessageBus: when fromConfig({ config }) is called WITHOUT messageBus, it builds
    exactly one bus from config.getPolicyEngine() and never attempts to read a bus off the Config
T7  ownership: dispose() does NOT dispose a fromConfig-supplied Config (REQ-001.3)
T7b ownership: createAgent-created Config IS disposed by dispose() (contrast, proves the flag)
T7c ownership: a caller-supplied messageBus/ProviderManager is caller-owned and not force-disposed
T10 smoke: a single turn via agent.stream() over FakeProvider yields exactly one `done`
PROP fromConfig is idempotent in identity: for any valid sessionId string, getConfig() identity holds
PROP for any subset of optional handlers provided, getConfig() identity + no-second-manager hold
```

> NOTE: T6c MUST assert the caller-supplied `MessageBus` INSTANCE identity is reused (CRIT-2).
> T6 MUST assert the adopted `ProviderManager` INSTANCE identity when the Config exposes one
> (CRIT-1). These are real behavioral assertions, not structure checks.

### Constraints

- Tests MUST NOT ASSERT a NotYetImplemented error (no reverse-testing). A stub-thrown
  NotYetImplemented is an ACCEPTABLE behavioral RED ONLY IF the test actually executed the call and
  no test expects that specific error — i.e., the RED comes from absent behavior, not from a
  compile/module/import failure.
- NO reverse testing (`toThrow('NotYetImplemented')`, `not.toThrow()`).
- NO structure-only assertions (`toHaveProperty` without value); assert identities and values.
- Each test carries a behavior-driven docblock (@requirement/@scenario/@given/@when/@then).

## Verification Commands

```bash
set -e
T=packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
test -f "$T" || { echo MISSING; exit 1; }
# Behavioral assertions present
grep -qE "toBe\(|toEqual\(|toThrow\(" "$T" || { echo "no behavioral asserts"; exit 1; }

# Mock theater / reverse testing guards (BLOCKING — a found violation exits non-zero)
if grep -nE "toHaveBeenCalled" "$T"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$T"; then echo "FAIL: reverse test"; exit 1; fi

# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions, so a
# single property block with several `fc.assert`/`fc.property` calls is NOT over-counted; MIN-2).
# TOTAL = every test case declaration (it(/test( plus the property-case forms it.prop(/test.prop().
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
# PROP CASES = the per-case property forms (each it.prop(/test.prop( is exactly ONE property case)
# PLUS classic it(/test( blocks that drive a property (counted once per block via the fc.assert/
# fc.property INSIDE that block). We count the per-case forms directly, and add classic blocks that
# contain a property primitive by counting the BLOCKS (not the primitives): each such block is the
# nearest preceding it(/test( for an fc.assert/fc.property occurrence.
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$T" || true)
# Classic property blocks: number of distinct it(/test( blocks whose body uses fc.assert/fc.property.
# Use awk to attribute each fc.assert/fc.property to its enclosing it(/test( and dedupe per block.
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

# RED-state enforcement (BLOCKING): new behavioral tests MUST fail for a BEHAVIORAL reason now.
set +e
npx vitest run "$T" > /tmp/p08_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p08_red.log
if [ "$STATUS" -eq 0 ]; then
  echo "FAIL: tests unexpectedly PASS before P09 implementation (expected RED)."; exit 1
fi
# RED reason must be behavioral. Per dev-docs/PLAN.md:733-737, a missing-method/stub RED
# (`TypeError: ... is not a function`) is an ACCEPTABLE natural RED — do NOT reject it (CRIT-3); a
# stub-thrown `NotYetImplemented` reaching the assertion is also acceptable (never reverse-asserted).
# Reject ONLY genuine module/compile/import/transpile failures where the test never ran.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p08_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P09)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Tests assert Config identity, SettingsService identity, ownership, single `done` — not mocks.
- [ ] ≥30% property-based tests using fast-check.
- [ ] Tests currently FAIL (RED) because fromConfig is a stub.
- [ ] No reverse testing, no mock theater, no structure-only assertions.

## Success Criteria

- 12+ behavioral tests authored; ≥30% property-based; all RED for the right reason.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/fromConfig.behavior.test.ts`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
for F in "packages/agents/src/api/__tests__/fromConfig.behavior.test.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P08.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```

