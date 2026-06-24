<!-- @plan:PLAN-20260621-COREAPIREMED.P19a @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 19a: CLI-Parity Integration Characterization — Parity-Expansion + Verification Gate Verification

> FILENAME NOTE: this file deliberately RETAINS the `-tdd` suffix (`19a-parity-harness-tdd-verification.md`)
> for cross-reference stability; the suffix is historical and does NOT make this a RED TDD phase.
> See the phase-type NOTE immediately below.

> NOTE: P19 is an INTEGRATION CHARACTERIZATION / PARITY-EXPANSION + VERIFICATION gate, NOT a RED
> "TDD" phase. The integration-first RED TDD driver is the early P07 slice (green at P09). This
> verifier therefore does NOT require the suite to be RED; a PASSING suite is the expected success
> condition because the characterized seams (P09 fromConfig, P12 settings, P14 seqmodel, P18
> runtime/getRuntimeId) are already implemented. It still enforces public-surface-only imports, real
> fixtures, projection-only comparison, ≥30% property ratio, no mock theater, and the content-hash
> frozen-test integrity guard.

## Phase ID

`PLAN-20260621-COREAPIREMED.P19a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 19 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P19.md`
- Pseudocode: `analysis/pseudocode/cli-integration-adapter.md` (lines 10–84)

## Verification Goal

Confirm the Phase 19 parity harness is a TRUE integration characterization / parity-EXPANSION
executable contract: it imports ONLY the public surface, drives a REAL FakeProvider, compares public
projections (not internals), exercises genuine settings normalization, and is ≥30% property-based —
with no mock theater and no deep imports. This is a VERIFICATION/EXPANSION gate, NOT a RED TDD phase:
a PASSING suite is the success condition (the seams it characterizes are already implemented). Do NOT
require RED here; the integration-first RED driver is P07.

## Verification Commands

```bash
set -e
DIR=packages/agents/src/api/__tests__
for F in cli-turn-parity.spec.ts config-injection.spec.ts settings-surface.spec.ts; do test -f $DIR/$F; done
test -f $DIR/helpers/buildCliStyleConfig.ts
ls $DIR/fixtures/*.jsonl
# Boundary scan: no deep imports in ANY parity file or helper
grep -rnE "from '[^']*(/src/|core/src|providers/src)" $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts $DIR/helpers/buildCliStyleConfig.ts && { echo "FAIL deep import"; exit 1; } || true
# Mock theater
grep -rnE "mockResolvedValue|mockReturnValue|toHaveBeenCalled" $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts && { echo "FAIL mock theater"; exit 1; } || true
# Reference drive mirrors useAgenticLoop.ts:254 — OBJECT-FORM options (not positional). The real
# constructor is `constructor(options: AgenticLoopOptions)` (AgenticLoop.ts:182), so the reference
# MUST pass a single options object. Require the object-form call and reject the positional form.
grep -nE "new AgenticLoop\(\s*\{" $DIR/cli-turn-parity.spec.ts || { echo "FAIL: no object-form reference AgenticLoop drive (expected new AgenticLoop({ ... }))"; exit 1; }
if grep -nE "new AgenticLoop\(\s*[A-Za-z_]" $DIR/cli-turn-parity.spec.ts; then echo "FAIL: positional AgenticLoop construction — must be object-form options"; exit 1; fi
# The reference object MUST carry the agentClient + config fields (the AgenticLoopOptions seam).
grep -nE "agentClient\s*:" $DIR/cli-turn-parity.spec.ts || { echo "FAIL: reference options missing agentClient"; exit 1; }
grep -n "from '@vybestack/llxprt-code-agents'" $DIR/cli-turn-parity.spec.ts || { echo "FAIL: AgenticLoop not from public root"; exit 1; }
# projectToComparable must NOT compare internal fields. Ignore EXPLANATORY COMMENTS (which may
# legitimately NAME the projected-away fields, exactly as the blessed frozen early slice does at
# cli-turn-parity.early.spec.ts); only a NON-comment code reference to these fields is a real defect.
if grep -nE "prompt_id|traceId" $DIR/cli-turn-parity.spec.ts | grep -vE ":[[:space:]]*(//|\*)"; then echo "FAIL: compares internal fields"; exit 1; fi
# Property ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions; MIN-2).
# Numerator and denominator MUST scan the SAME spec set (all three harness specs) — config-injection
# carries genuine fast-check property cases too, so excluding it from the numerator while counting it
# in TOTAL would understate the ratio. This mirrors the P19 authoring gate's SPECS list exactly.
TOTAL=$(grep -rcE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts | awk -F: '{s+=$2} END{print s+0}')
PROP_CASE_FORMS=$(grep -rcE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts | awk -F: '{s+=$2} END{print s+0}')
CLASSIC_PROP_BLOCKS=$(awk '
  FNR==1 { blk=0; delete counted }
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts)
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests found"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi
# EXECUTION enforcement (BLOCKING): this is a VERIFICATION/EXPANSION gate, NOT a RED phase. The
# harness MUST EXECUTE (not error out at setup). A PASSING suite is the EXPECTED success condition
# (the characterized seams are already implemented). If some behavioral assertions FAIL, that is a
# REAL adequacy gap deferred to P20 (fixed in production code, never by weakening tests) — also
# acceptable here. The ONLY hard failure is a setup/collection/import error (the harness must run).
# Do NOT fail merely because the suite passes.
set +e
npx vitest run $DIR/cli-turn-parity.spec.ts $DIR/config-injection.spec.ts $DIR/settings-surface.spec.ts > /tmp/p19a_run.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p19a_run.log
if grep -qiE "Cannot find module|SyntaxError|ReferenceError|No test files found|0 passed" /tmp/p19a_run.log; then
  echo "FAIL: harness did not execute (setup/collection/import error)."; exit 1
fi
if [ "$STATUS" -eq 0 ]; then
  echo "Harness executes and PASSES — expected success condition (seams already implemented)."
else
  echo "Harness executes; some assertions fail — REAL adequacy gap to fix in P20 (not a test weakness)."
fi

# FROZEN-TEST INTEGRITY GUARD (content-hash, NOT git): confirm the P19 frozen-hash snapshot exists so
# P20 can prove the parity tests were not weakened.
test -f project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt || { echo "FAIL: missing P19 frozen-test hash snapshot"; exit 1; }

# MACHINE-READABLE HAND-OFF GUARD (CRIT-3): confirm P19 emitted the parity-status hand-off that P20
# consumes, that it carries a recognizable harness_result, and that the recorded result is CONSISTENT
# with this verifier's own re-run (no silent drift between P19's emission and P20's consumption).
PSTATUS=project-plans/issue1594remediate/.completed/P19-parity-status.txt
test -f "$PSTATUS" || { echo "FAIL: missing P19 machine-readable parity-status hand-off ($PSTATUS)"; exit 1; }
RECORDED=$(grep -E "^harness_result:" "$PSTATUS" | awk '{print $2}')
case "$RECORDED" in
  pass|fail) : ;;
  *) echo "FAIL: P19 parity-status hand-off lacks a recognizable harness_result (pass|fail)"; exit 1 ;;
esac
if [ "$STATUS" -eq 0 ]; then RERUN=pass; else RERUN=fail; fi
if [ "$RECORDED" != "$RERUN" ]; then
  echo "FAIL: P19 recorded harness_result=$RECORDED but this verifier's re-run was $RERUN (hand-off is stale/inconsistent)"; exit 1
fi
echo "P19 machine-readable hand-off present and consistent (harness_result=$RECORDED)."
```

### Line-by-Line Compliance (cli-integration-adapter.md)

| Pseudocode lines | Verified in | Matches? |
|---|---|---|
| 10–16 adopt + one done | config-injection.spec.ts | [ ] |
| 20–25 runtime reuse (identity) | config-injection.spec.ts | [ ] |
| 30–34 ownership contrast | config-injection.spec.ts | [ ] |
| 40–51 turn-drive parity (Path A vs B) | cli-turn-parity.spec.ts | [ ] |
| 60–68 settings normalization parity | settings-surface.spec.ts | [ ] |
| 70–77 property round-trip + seqmodel mirror | parity + settings | [ ] |
| 80–84 boundary scan as a test | cli-turn-parity.spec.ts | [ ] |

### Semantic Verification Checklist

- [ ] `buildCliStyleConfig` builds a REAL Config (provider runtime + FakeProvider JSONL), no mocks.
- [ ] Path A (`agent.stream`) and Path B (reference `AgenticLoop`) compared on PUBLIC projection only.
- [ ] Settings parity asserts numeric normalization (e.g. context-limit→1000), streaming 'enabled',
      and invalid `streaming` (numeric) throws — matching Config rules.
- [ ] Boundary scan is itself an executed test (REQ-INT-004), not just a grep in this verifier.
- [ ] ≥30% property-based; behavioral assertions only; no `events.length`-only assertions.
- [ ] Suite EXECUTES (no setup/collection/import error). A passing suite is the success condition;
      any behavioral failure is a REAL adequacy gap (deferred to P20), NOT a test weakness.
- [ ] P19 frozen-test hash snapshot present (content-hash integrity guard for P20).
- [ ] P19 machine-readable parity-status hand-off (`P19-parity-status.txt`) present, carries a
      recognizable `harness_result: pass|fail`, and is consistent with this verifier's re-run (CRIT-3).

## Holistic Functionality Assessment (MANDATORY — into marker)

### Could this harness have been written WITHOUT the new seams (fromConfig/settings/getRuntimeId/
contract)? (If yes — the harness is not proving adequacy; FAIL.) ### Does it drive a real turn end to
end through the public API? ### Verdict (PASS/FAIL)

## Success Criteria

- Harness is integration-first, public-surface-only, real-fixture-driven, property-inclusive, and
  fraud-free; compliance table complete.

## Failure Recovery

- Return to Phase 19; do not proceed to Phase 20.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P19a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P19a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

