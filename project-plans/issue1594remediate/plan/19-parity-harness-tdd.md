<!-- @plan:PLAN-20260621-COREAPIREMED.P19 @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 19: CLI-Parity Integration Characterization — Parity-Expansion + Verification Gate (Executable Contract for #1595)

> FILENAME NOTE: this file deliberately RETAINS the `-tdd` suffix (`19-parity-harness-tdd.md`) for
> cross-reference stability across the tracker/overview/sibling phases; the suffix is historical and
> does NOT make this a RED TDD phase. See the phase-type NOTE immediately below.

> NOTE: This phase is an INTEGRATION CHARACTERIZATION / PARITY-EXPANSION + VERIFICATION gate, NOT a
> RED "TDD" phase. The integration-first RED TDD DRIVER is the early P07 slice (authored before any
> implementation phase, made GREEN at P09). THIS phase EXTENDS parity coverage to the remaining seams
> (settings / seqmodel / boundary / the full REQ-INT-001..004 surface). Because the implementations
> it characterizes already exist (P09 fromConfig, P12 settings, P14 seqmodel, P18 runtime/getRuntimeId),
> a PASSING suite is the success condition — do NOT pretend a passing suite is a failure, and do NOT
> author reverse/weakened tests. Any genuine adequacy gap surfaces as a REAL failure fixed in P20
> WITHOUT weakening tests. The content-hash frozen-test integrity guard still applies.

## Phase ID

`PLAN-20260621-COREAPIREMED.P19`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 18a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P18a.md`
- Pseudocode: `analysis/pseudocode/cli-integration-adapter.md` (lines 10–84)

## Purpose

This is the BROADER executable contract that proves the remediated public surface is ADEQUATE for
issue #1595 (CLI-as-thin-UI) across the FULL surface. The INTEGRATION-FIRST turn-parity DRIVER was
authored EARLY at P07 (RED, before the implementation phases) and made GREEN at P09 — satisfying
`dev-docs/PLAN.md`'s integration-first requirement. THIS phase extends that contract to the remaining
seams: it exercises the SAME public entry points #1595 will use (`fromConfig`, `agent.stream`,
`agent.getEphemeralSetting`/`setEphemeralSetting`, `agent.getConfig`, `agent.getRuntimeId`,
`agent.getCurrentSequenceModel`, `AgentClientContract`) against a REAL CLI-style `Config` + a REAL
`FakeProvider` JSONL fixture, and compares turn-drive parity against the CLI's actual reference
`AgenticLoop` drive (REUSING the canonical P07 helper + fixture). If the surface were inadequate,
this harness could NOT be written without deep imports — which is precisely what it guards against
(PLAN.md biggest red flag).

## Requirements Implemented (Expanded)

### REQ-INT-001: fromConfig adopts an external (CLI-style) Config

GIVEN a real Config built the way `loadCliConfig` builds it; WHEN `fromConfig({config})`; THEN
`agent.getConfig() === config`, `agent.getRuntimeId()` non-empty, and `agent.stream('hello')` ends
with exactly one `done`.

### REQ-INT-002: turn-drive parity with the CLI's reference AgenticLoop drive

GIVEN a FakeProvider fixture (toolCall + finalAnswer); WHEN driving Path A `agent.stream(...)` vs
Path B `new AgenticLoop({ agentClient: config.getAgentClient(), config, messageBus: messageBus ?? new MessageBus(), interactiveMode: false, approvalHandler, displayCallbacks: {} })` (object-form
options, EXACTLY as `useAgenticLoop.ts:254` does today — the `AgenticLoop` constructor is
`constructor(options: AgenticLoopOptions)` at `AgenticLoop.ts:182`); THEN the PUBLIC projections are
equivalent (same tool name, same isError, same single terminal `done` reason) — internal fields
(`prompt_id`, `traceId`) are NOT compared (projected away by #1594 R-PROJECT).

### REQ-INT-003: settings round-trip + normalization parity

GIVEN an agent over a real Config; WHEN setting ephemeral values through the agent; THEN
get-through-agent === get-through-Config, numeric/streaming normalization matches Config rules, and
invalid `streaming` throws (Config rule propagates).

### REQ-INT-004: harness imports ONLY public surface (Path A vs Path B; no deep imports)

A boundary scan asserts the test-only-vs-production distinction. Path A — the PUBLIC-AGENT path
under test (`createAgent`/`fromConfig`/`agent.stream()`/`AgentClientContract`) and the model for the
eventual #1595 production CLI — imports the curated public ROOT `@vybestack/llxprt-code-agents`
(plus documented NON-internals subpaths like `/app-service.js`) ONLY: NEVER `./internals.js`, NEVER
a deep `/src/` path. Path B — the TEST-ONLY reference drive (the comparison `AgenticLoop`) — MAY
import the reference `AgenticLoop` from the curated root or the documented `./internals.js` subpath
SOLELY to build the current baseline (the reference drive is the ONLY permitted `./internals.js`
consumer). Deep `/src/`, `core/src`, or `providers/src` imports are forbidden EVERYWHERE.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/cli-turn-parity.spec.ts` — scenarios from pseudocode lines
  40–51 + 80–84 (T10 parity, T11 boundary scan) + property tests (lines 70–77).
- `packages/agents/src/api/__tests__/config-injection.spec.ts` — scenarios lines 10–34 (T1 adopt,
  T6 runtime reuse, T7 ownership contrast).
- `packages/agents/src/api/__tests__/settings-surface.spec.ts` — scenarios lines 60–73 (T8 + property
  round-trip).
- REUSE (do NOT recreate) the CANONICAL shared helper created in P07:
  `packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts`. If additional builder variants
  are needed for the broader suite, EXTEND that file; do NOT fork a parallel helper.
- REUSE (do NOT recreate) the CANONICAL fixture created in P07:
  `packages/agents/src/api/__tests__/fixtures/parity-toolcall.jsonl`. Add NEW fixtures only for
  scenarios the early slice does not cover (e.g. settings/normalization variants).
- All markers `@plan:PLAN-20260621-COREAPIREMED.P19`, `@requirement:REQ-INT-001..004`.

### Constraints

- REAL FakeProvider JSONL fixtures; NO mock theater (no `.mockResolvedValue`, no `toHaveBeenCalled`).
- Reference Path B MUST construct `AgenticLoop` exactly as `useAgenticLoop.ts:254` does today —
  OBJECT-FORM options (`new AgenticLoop({ agentClient: config.getAgentClient(), config, messageBus:
  messageBus ?? new MessageBus(), interactiveMode: false, approvalHandler, displayCallbacks })`),
  matching `AgenticLoopOptions` (`packages/agents/src/core/agenticLoop/types.ts`: `agentClient`,
  `config`, `messageBus`, `approvalHandler?`, `interactiveMode?`, `displayCallbacks?`). Import
  `AgenticLoop` from the PUBLIC root (`@vybestack/llxprt-code-agents`), as the CLI does. NEVER the
  positional form — it does not match the real constructor and will not compile.
- `projectToComparable` compares ONLY public projection fields (type, tool name, isError, done
  reason) — never internal fields.
- ≥30% property-based across the harness (lines 70–77 + key round-trip).
- Behavioral assertions only (specific tool name, isError, single terminal done) — never
  `events.length > 0` alone.
- This is the BROADER parity suite (settings/seqmodel/boundary + the full REQ-INT-001..004 surface),
  and it is a VERIFICATION / PARITY-EXPANSION gate — NOT a RED TDD phase. The integration-first
  turn-parity RED TDD DRIVER was already authored early at P07 (before the impls) and made green at
  P09; THIS phase EXTENDS coverage to the remaining seams. By the time this phase runs, the seams it
  characterizes are implemented — fromConfig (P09), settings (P12), seqmodel (P14), runtime/getRuntimeId
  (P18) — so the broad suite is EXPECTED to PASS, and a passing suite is the SUCCESS CONDITION. This
  phase does NOT enforce RED and does NOT fail if the suite passes. Any genuine adequacy gap surfaces
  as a REAL failure to fix in P20, NEVER by weakening the test. Authoring reverse/weakened tests is
  forbidden. (The boundary scan T11 is an always-on guard, not a RED driver.)

## Verification Commands

```bash
set -e
SPECS="packages/agents/src/api/__tests__/cli-turn-parity.spec.ts packages/agents/src/api/__tests__/config-injection.spec.ts packages/agents/src/api/__tests__/settings-surface.spec.ts"
for F in cli-turn-parity.spec.ts config-injection.spec.ts settings-surface.spec.ts; do
  test -f packages/agents/src/api/__tests__/$F || { echo "FAIL: missing $F"; exit 1; }
done
test -f packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts || { echo "FAIL: missing buildCliStyleConfig helper"; exit 1; }
ls packages/agents/src/api/__tests__/fixtures/*.jsonl >/dev/null || { echo "FAIL: missing JSONL fixtures"; exit 1; }

# Mock-theater / deep-import guards (BLOCKING — a found violation exits non-zero)
if grep -rnE "mockResolvedValue|toHaveBeenCalled" $SPECS; then echo "FAIL: mock theater in parity harness"; exit 1; fi
if grep -rnE "from '[^']*(/src/|core/src|providers/src)" $SPECS; then echo "FAIL: deep import in parity harness"; exit 1; fi

# Property ratio >= 30% (BLOCKING — count DISTINCT property test CASES, not raw fc. mentions, so a
# single property block with several `fc.assert`/`fc.property` calls is NOT over-counted; MIN-2).
# Multi-file aware: the block counter resets per file (FNR==1).
TOTAL=$(grep -rhcE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" $SPECS | awk '{s+=$1} END{print s+0}')
PROP_CASE_FORMS=$(grep -rhcE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" $SPECS | awk '{s+=$1} END{print s+0}')
CLASSIC_PROP_BLOCKS=$(awk '
  FNR==1 { blk=0; delete counted }
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }
' $SPECS)
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests found in parity harness"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property-based CASES: $PROP / $TOTAL = ${PCT}% (it.prop/test.prop=$PROP_CASE_FORMS, classic-blocks=$CLASSIC_PROP_BLOCKS)"
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30% (distinct property cases)"; exit 1; fi

# Execute the harness. This is a VERIFICATION/EXPANSION gate, NOT a RED phase: a PASSING suite is the
# success condition (the seams are already implemented). The run MUST actually execute — a
# setup/compile/deep-import error is NOT acceptable. If the suite PASSES, that is the expected,
# successful outcome. If any behavioral assertion FAILS, that is a REAL adequacy gap to fix in P20
# (by changing production code, NEVER by weakening the test). Either way, do NOT reverse-assert.
set +e
npx vitest run $SPECS > /tmp/p19_run.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p19_run.log
if grep -qiE "Cannot find module|SyntaxError|ReferenceError|Failed to resolve import" /tmp/p19_run.log; then
  echo "FAIL: harness did not execute (setup/compile/import error)."; exit 1
fi
echo "Harness executed (status=$STATUS). A passing suite is success; any behavioral failure is an adequacy gap addressed in P20."

# MACHINE-READABLE HAND-OFF STATUS (CRIT-3): record an explicit, machine-readable parity-harness
# result that P20 consumes to decide whether it is a no-op verification (harness already GREEN) or
# must close named adequacy gaps (harness has behavioral failures). This is a recorded pass/fail of
# the harness run — NOT a reverse test — emitted alongside the frozen-hash snapshot.
mkdir -p project-plans/issue1594remediate/.completed
if [ "$STATUS" -eq 0 ]; then HARNESS_RESULT=pass; else HARNESS_RESULT=fail; fi
{
  echo "phase: P19";
  echo "harness_status_code: $STATUS";
  echo "harness_result: $HARNESS_RESULT";
  echo "specs: $SPECS";
  echo "# harness_result=pass => P20 is a no-op verification (no frozen test weakened, no gap to close).";
  echo "# harness_result=fail => P20 MUST close the named production-surface adequacy gaps below (NEVER by weakening tests).";
  echo "## Named adequacy gaps (behavioral failures observed; empty when harness_result=pass):";
  grep -iE "FAIL|expected .* received|AssertionError" /tmp/p19_run.log | sed 's/^/gap: /' || true;
} | tee project-plans/issue1594remediate/.completed/P19-parity-status.txt
echo "Recorded machine-readable parity-harness status for P20 hand-off (P19-parity-status.txt)."

# FROZEN-TEST SNAPSHOT (consumed by P20's content-hash guard — NOT git): record sha256 of every
# parity test file + helper + fixture at the END of this characterization/expansion phase. P20 compares current hashes to
# these and FAILS if any test CONTENT changed. This is phase-local and does NOT rely on `git diff`
# (the files are uncommitted, so a git-diff guard would mis-fire). Persist into the completion marker.
mkdir -p project-plans/issue1594remediate/.completed
{
  echo "## Frozen parity-test hashes (P19 characterization snapshot)";
  for F in \
    packages/agents/src/api/__tests__/cli-turn-parity.spec.ts \
    packages/agents/src/api/__tests__/config-injection.spec.ts \
    packages/agents/src/api/__tests__/settings-surface.spec.ts \
    packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts \
    packages/agents/src/api/__tests__/fixtures/*.jsonl ; do
      shasum -a 256 "$F";
  done
} | tee project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt
echo "Recorded frozen-test hashes for P20 to verify."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Harness imports ONLY public root/subpaths (boundary scan is itself a test).
- [ ] Parity compares actual projected event sequences (Path A vs Path B), not mock calls.
- [ ] Reference drive mirrors useAgenticLoop.ts:254 object-form construction (all `AgenticLoopOptions` fields; never positional).
- [ ] Settings parity asserts numeric/streaming normalization + invalid-throw.
- [ ] ≥30% property-based; real FakeProvider fixtures.

## Success Criteria

- Harness authored; runs against the implemented surface; any failure reflects a REAL adequacy gap
  (to be fixed in P20), not a test weakness.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; rewrite without mocks/deep imports.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/cli-turn-parity.spec.ts, packages/agents/src/api/__tests__/config-injection.spec.ts, packages/agents/src/api/__tests__/settings-surface.spec.ts, packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts
for F in "packages/agents/src/api/__tests__/cli-turn-parity.spec.ts" "packages/agents/src/api/__tests__/config-injection.spec.ts" "packages/agents/src/api/__tests__/settings-surface.spec.ts" "packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P19.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P19
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```


Also produce (from the Verification Commands above):
`project-plans/issue1594remediate/.completed/P19-frozen-hashes.txt` — the sha256 content hashes of
every parity test file, helper, and fixture as authored in this characterization/expansion phase. P20
reads this file to prove the frozen tests were not weakened (content-hash guard; NOT `git diff HEAD`,
since the files are uncommitted during normal execution).

`project-plans/issue1594remediate/.completed/P19-parity-status.txt` (CRIT-3) — the machine-readable
parity-harness hand-off status: `harness_result: pass|fail`, the harness status code, the spec set,
and the named adequacy gaps (behavioral failures) when `fail`. P20 CONSUMES this to decide whether it
is a no-op verification (`pass`) or must close the named production-surface gaps (`fail`) — never by
weakening a frozen test.
