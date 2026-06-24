<!-- @plan:PLAN-20260621-COREAPIREMED.P17 @requirement:REQ-005,REQ-001 -->
# Phase 17: Provider-Runtime Reachability Seam — Behavioral TDD

## Phase ID

`PLAN-20260621-COREAPIREMED.P17`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 16a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P16a.md`

## PREFLIGHT FACT (do NOT re-add the bus seam)

`IsolatedRuntimeContextOptions.messageBus?: MessageBus` ALREADY EXISTS at
`packages/providers/src/runtime/runtimeContextFactory.ts` (added by #1594 P19,
`@plan:PLAN-20260617-COREAPI.P20`). This remediation REUSES it — it does NOT add it. The earlier
"P19 carryover" to add this field is already resolved upstream.

## Requirements Implemented (Expanded)

### REQ-005: Provider runtime reachable through the public API

**Full Text**: The provider runtime assembled behind the public API MUST be reachable via the public
`Agent` surface: `Agent.getRuntimeId(): string` returns the bound runtime-context runtimeId, and the
existing DIRECT provider/model methods (`agent.getProvider()`/`agent.getModel()`/`agent.getProviderStatus()`)
reflect the adopted/active runtime. No raw `ProviderManager` is exposed at the public root.
- **REQ-005.1**: `getRuntimeId()` equals the runtimeId passed to `createIsolatedRuntimeContext`.
- **REQ-005.2**: building an agent via `fromConfig` adopts the supplied Config's runtime and does
  NOT construct a second `ProviderManager` (ties to REQ-001.2).

### REQ-001 (cross-cut: single ProviderManager)

No second provider manager is created on the `fromConfig` adopt path.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN `fromConfig({ config })` builds an agent with runtime-context runtimeId `R`
- WHEN `agent.getRuntimeId()` is called
- THEN it returns `R`
- AND `agent.getProvider()/getModel()` reflect the adopted Config's active provider/model
- AND the number of `ProviderManager` instances reachable from the agent equals the one already on
  the supplied Config (no second manager)

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts`
  - T6a: build via `fromConfig({config})`; assert `agent.getRuntimeId()` equals the runtimeId used
    to build the context (thread a known sessionId/runtimeId in).
  - T6b: assert `agent.getProvider()`/`getModel()` reflect the adopted Config's active
    provider/model (set them on the real Config before build).
  - T6c (no-2nd-manager): assert the manager reachable post-build is the SAME instance as the one on
    the supplied Config (identity), proving adoption — observe via the real providers seam, NOT a
    spy on a mock. (May reuse the P08 T6 assertion helper.)
  - PROP: for any valid runtimeId string `R`, `fromConfig` with that runtimeId yields
    `agent.getRuntimeId() === R`.
  - Markers `@plan:PLAN-20260621-COREAPIREMED.P17`, `@requirement:REQ-005,REQ-001`.

### Constraints

- Real Config + FakeProvider; assert identity/values, not calls.
- ≥30% property-based.
- RED for the right reason (getRuntimeId does not exist yet → compile/runtime failure).
- Do NOT assert a raw `getProviderManager()` exists at the root (anti-pattern).

## Verification Commands

```bash
set -e
F=packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts
test -f "$F"

# Mock theater guard (BLOCKING)
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
# Root surface must NOT expose/assert the raw ProviderManager (BLOCKING).
# The anti-pattern is asserting a raw manager accessor on the AGENT's public
# root surface (e.g. `agent.getProviderManager()`). Calling
# `config.getProviderManager()` on the SUPPLIED Config is REQUIRED for the
# no-2nd-manager identity check (T6c) and is exactly what the sibling P08 suite
# does (fromConfig.behavior.test.ts T6) — so the guard targets the agent
# accessor specifically, NOT the bare substring (which would false-positive on
# the legitimate Config call and push authors toward obfuscation).
if grep -nE "\bagent[A-Za-z0-9_]*\.getProviderManager\b|\)\.getProviderManager\b" "$F"; then
  echo "FAIL: must not assert raw manager on the agent root surface"; exit 1; fi
# Belt-and-suspenders: the ONLY permitted getProviderManager call is on a
# `config`-named receiver; flag any other receiver.
if grep -nE "\.getProviderManager\b" "$F" | grep -vE "\bconfig[A-Za-z0-9_]*\.getProviderManager\b"; then
  echo "FAIL: getProviderManager called on a non-config receiver (only config.getProviderManager() is allowed)"; exit 1; fi

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

# RED-state enforcement (BLOCKING): getRuntimeId is absent → tests MUST fail for a behavioral reason.
set +e
npx vitest run "$F" > /tmp/p17_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p17_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: tests unexpectedly PASS before P18 (expected RED)."; exit 1; fi
# CRIT-5 exception: getRuntimeId is GENUINELY ABSENT until P18, so a
# "TypeError: ... getRuntimeId is not a function" IS the legitimate behavioral RED reason for the
# interface gap and is NOT treated as a setup error here. Only true setup/compile errors are rejected.
if grep -qiE "Cannot find module|SyntaxError|ReferenceError" /tmp/p17_red.log; then
  echo "FAIL: RED is a setup/compile error, not a behavioral assertion failure."; exit 1
fi
# Guard against UNRELATED 'is not a function' errors (anything other than the expected getRuntimeId gap).
if grep -E "TypeError: .* is not a function" /tmp/p17_red.log | grep -vi "getRuntimeId"; then
  echo "FAIL: unexpected 'is not a function' error unrelated to the getRuntimeId gap."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P18)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] getRuntimeId test fails now (method absent) for a behavioral reason.
- [ ] no-2nd-manager test asserts instance identity with the adopted Config's manager.
- [ ] providers.* reflect adopted runtime.
- [ ] ≥30% property-based (computed, enforced); no mock theater.

## Success Criteria

- Behavioral runtime-seam tests authored; RED for right reason; ≥30% property-based.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts
for F in "packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P17.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P17
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
