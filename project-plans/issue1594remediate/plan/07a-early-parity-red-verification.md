<!-- @plan:PLAN-20260621-COREAPIREMED.P07a @requirement:REQ-INT-001,REQ-INT-002 -->
# Phase 07a: Early CLI Turn-Parity RED Slice — Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P07a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 07 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P07.md`

## Purpose

Confirm the early integration-first turn-parity slice is a GENUINE driver: it is RED NOW for a
BEHAVIORAL reason (the public `fromConfig` path is still a stub), it is authored against ONLY the
public surface, and it mirrors the CLI's real object-form `AgenticLoop` drive. If the slice
unexpectedly PASSES before the implementation phases (P09 fromConfig, P18 runtime) land, this phase
FAILS — that would prove the test is not driving anything (an after-the-fact check, the PLAN.md red
flag).

## Verification Tasks

```bash
set -e
SPEC=packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts
HELP=packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts
test -f "$SPEC"
test -f "$HELP"
ls packages/agents/src/api/__tests__/fixtures/parity-toolcall.jsonl >/dev/null

# Mock theater / reverse / structure-only guards (BLOCKING)
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue" "$SPEC"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$SPEC"; then echo "FAIL: reverse test"; exit 1; fi

# Public-surface boundary (BLOCKING): no deep imports on either path.
if grep -nE "from '[^']*(/src/|core/src|providers/src)" "$SPEC" "$HELP"; then echo "FAIL: deep import in early parity slice"; exit 1; fi
grep -n "from '@vybestack/llxprt-code-agents'" "$SPEC" || { echo "FAIL: slice does not import the public root"; exit 1; }

# Reference Path B object-form (BLOCKING): real constructor is constructor(options: AgenticLoopOptions)
grep -nE "new AgenticLoop\(\s*\{" "$SPEC" || { echo "FAIL: no object-form reference AgenticLoop drive"; exit 1; }
if grep -nE "new AgenticLoop\(\s*[A-Za-z_]" "$SPEC"; then echo "FAIL: positional AgenticLoop — must be object-form options"; exit 1; fi
grep -nE "agentClient\s*:" "$SPEC" || { echo "FAIL: reference options missing agentClient"; exit 1; }

# Property ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2)
TOTAL=$(grep -rhcE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$SPEC" | awk '{s+=$1} END{print s+0}')
PROP_CASE_FORMS=$(grep -rhcE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$SPEC" | awk '{s+=$1} END{print s+0}')
CLASSIC_PROP_BLOCKS=$(awk '
  FNR==1 { blk=0; delete counted }
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' "$SPEC")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi

# RED-BEFORE-GREEN ENFORCEMENT (BLOCKING): the slice MUST FAIL now (fromConfig is a P06 stub). A
# PASS here means the test is not integration-first/driving anything — FAIL the phase.
set +e
npx vitest run "$SPEC" > /tmp/p07a_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p07a_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: early parity slice PASSED before fromConfig/runtime impl — not a driver (expected RED)."; exit 1; fi
# Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`) is an
# ACCEPTABLE natural behavioral RED — do NOT categorically reject it (CRIT-3). The P06 stub
# `fromConfig` throws `NotYetImplemented` (surfaces as an Error reaching the assertion; never
# reverse-asserted). Reject ONLY genuine module/compile/import/transpile failures (test never ran).
if grep -qiE "Cannot find module|SyntaxError|ReferenceError|Failed to resolve import" /tmp/p07a_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not behavioral."; exit 1
fi
echo "PASS: early parity slice is RED for a behavioral reason and is a genuine integration-first driver."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Slice executes (no setup/compile/import error) and FAILS for a behavioral reason.
- [ ] PASS-before-impl is rejected (RED-before-green enforced).
- [ ] Path A imports only the public root; Path B reference drive is object-form, public-root
      `AgenticLoop`, no deep imports.
- [ ] ≥30% property-based; real FakeProvider fixture; no mock theater/reverse.

## Holistic Assessment (MANDATORY)

Would this slice go GREEN ONLY when `fromConfig` genuinely adopts the Config and `agent.stream`
reaches turn-drive parity with the reference `AgenticLoop`? Could it pass against the current P06
stub? Verdict PASS/FAIL.

## Success Criteria

- All checks pass; the slice is a genuine RED integration-first driver for #1595 adequacy.

## Failure Recovery

- Return to Phase 07; do not proceed to Phase 08.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P07a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P07a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
