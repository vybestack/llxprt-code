<!-- @plan:PLAN-20260621-COREAPIREMED.P07 @requirement:REQ-INT-001,REQ-INT-002 -->
# Phase 07: Early Integration-First CLI Turn-Parity — RED Slice (Drives #1595 Adequacy)

## Phase ID

`PLAN-20260621-COREAPIREMED.P07`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 06a completed (PASS) — the stub phase (P06) is authored AND its verifier (P06a)
  has confirmed it, so this RED slice is never authored against an UNVERIFIED stub (strict
  NN → NNa → NN+1 sequencing per `dev-docs/COORDINATING.md`). At that point the `fromConfig` STUB
  exists (throws `NotYetImplemented`), AND `getConfig(): Config` is DECLARED on the `Agent` interface
  with a NotYetImplemented STUB body in `agentImpl.ts` (CRIT-2: the real `return this.deps.config`
  impl lands at P09, not P06). EP1 (`agent.getConfig() === config`) below references that interface
  member; because the member is on the type, the slice COMPILES — it is RED for a BEHAVIORAL reason
  (both `fromConfig` and the `getConfig` stub throw `NotYetImplemented`), not a compile error.
- Verification: `test -f project-plans/issue1594remediate/.completed/P06a.md`
- The providers `providerManager?` adoption seam (P03–P05) MUST be merged (so the CLI-style Config
  helper can assemble a real provider runtime for the FakeProvider fixture).
- Pseudocode: `analysis/pseudocode/cli-integration-adapter.md` (lines 10–34 adopt, 40–51 parity).

## Purpose (WHY THIS PHASE EXISTS — integration-first per `dev-docs/PLAN.md`)

`dev-docs/PLAN.md`'s headline requirement is INTEGRATION-FIRST: the biggest red flag is a feature
built in isolation and only tested afterward. The #1595-critical contract is "the CLI can drive a
turn through the PUBLIC `Agent` path (`fromConfig` → `agent.stream`) with parity to today's
reference `AgenticLoop` drive." That contract MUST be authored as a RED test BEFORE the
implementation phases it is meant to drive (fromConfig IMPL is P09), NOT after them.

This phase authors the CORE turn-parity slice and REQUIRES it to be RED for a BEHAVIORAL reason: the
public `fromConfig` path is a stub (P06), so `agent.stream(...)` cannot yet reach turn-drive parity
with the reference `AgenticLoop`. The verifier (P07a) FAILS if this slice unexpectedly PASSES before
the implementations exist — proving it is a genuine driver, not an after-the-fact check.

The BROADER parity suite (settings/seqmodel/boundary, all REQ-INT-001..004) remains later at
P19/P20, kept where it makes sense once every sub-seam lands. This phase is the early, integration-
first slice that drives the core turn parity.

## Requirements Implemented (Expanded)

### REQ-INT-001: fromConfig adopts an external (CLI-style) Config

GIVEN a real Config built the way `loadCliConfig` builds it; WHEN `fromConfig({ config })`; THEN
`agent.getConfig() === config` (same instance), and `agent.stream('hello')` drives a real turn that
ends with exactly one terminal `done`.

### REQ-INT-002: core turn-drive parity with the CLI's reference AgenticLoop drive

GIVEN a FakeProvider fixture (a tool call then a final answer); WHEN driving Path A
`agent.stream(...)` (public `fromConfig` agent) versus Path B
`new AgenticLoop({ agentClient: config.getAgentClient(), config, messageBus: messageBus ?? new MessageBus(), interactiveMode: false, approvalHandler, displayCallbacks: {} })`
(object-form options, EXACTLY as `useAgenticLoop.ts:254` does today; constructor is
`constructor(options: AgenticLoopOptions)` at `AgenticLoop.ts:182`); THEN the PUBLIC projections are
equivalent (same tool name, same `isError`, same single terminal `done` reason). Internal fields
(`prompt_id`, `traceId`) are NOT compared (projected away by #1594 R-PROJECT).

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts` — builds a REAL Config the way
  `loadCliConfig` builds it (provider runtime + FakeProvider JSONL fixture). NO mocks. This is the
  CANONICAL shared helper; the later broader suite (P19) REUSES this exact file (P19 MUST NOT create
  a duplicate). Export `buildCliStyleConfig(fixtureRelPath: string): Promise<Config>` and a
  `projectToComparable(event)` that yields ONLY the public projection fields (kind/type, tool name,
  isError, terminal done reason) — never internal fields.
- `packages/agents/src/api/__tests__/fixtures/parity-toolcall.jsonl` — one `FakeResponseTurn` per
  line: a tool call then a final answer. CANONICAL shared fixture; P19 REUSES it.
- `packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts` — the EARLY core turn-parity
  slice (REQ-INT-001 adopt + REQ-INT-002 turn parity ONLY). DISTINCT filename from the later broad
  `cli-turn-parity.spec.ts` (P19) so the two never collide.
- All markers `@plan:PLAN-20260621-COREAPIREMED.P07`, `@requirement:REQ-INT-001,REQ-INT-002`.

### Test Scenarios (behavioral; RED expected against the P06 stub)

- **EP1 (REQ-INT-001 adopt):** `const agent = await fromConfig({ config });` → `agent.getConfig()`
  is the SAME instance as `config`; then `agent.stream('hello')` yields exactly one terminal `done`.
- **EP2 (REQ-INT-002 parity):** drive Path A `agent.stream(...)` and Path B reference `AgenticLoop`
  over the SAME `parity-toolcall.jsonl` fixture; assert `projectToComparable(pathA) ===
  projectToComparable(pathB)` (same tool name, same `isError`, same single terminal `done` reason).
- **EP3 (REQ-INT-002 property, ≥30%):** `fc.property` over a small set of FakeProvider tool
  names/answers asserting Path A vs Path B projection equivalence holds for each generated turn.

### Constraints (RULES.md)

- REAL FakeProvider JSONL fixtures; NO mock theater (no `.mockResolvedValue`, no `toHaveBeenCalled`).
- Reference Path B MUST construct `AgenticLoop` in OBJECT-FORM exactly as `useAgenticLoop.ts:254`
  does today, matching `AgenticLoopOptions` (`packages/agents/src/core/agenticLoop/types.ts`:
  `agentClient`, `config`, `messageBus`, `approvalHandler?`, `interactiveMode?`, `displayCallbacks?`).
  NEVER positional — it does not match the real constructor and will not compile.
- Path A (the PUBLIC path under test, and the eventual #1595 production path) MUST import ONLY the
  curated public root `@vybestack/llxprt-code-agents` — never `/src/`, `core/src`, `providers/src`.
  Path B (the TEST-ONLY reference drive) MAY import `AgenticLoop` from the public root (as the CLI
  does); it MUST NOT use a deep `/src/` import either. (Internals subpath `./internals.js` is
  permitted ONLY for the reference side if a public re-export is unavailable — see
  `analysis/pseudocode/cli-integration-adapter.md` boundary scan.)
- ≥30% property-based across this slice (EP3 satisfies this; compute and enforce).
- Behavioral assertions only (specific tool name, isError, single terminal done) — never
  `events.length > 0` alone.
- Tests MUST NOT ASSERT a NotYetImplemented error (no reverse-testing). A stub-thrown
  NotYetImplemented is an ACCEPTABLE behavioral RED ONLY IF the test actually executed the call and
  no test expects that specific error — i.e., the RED comes from absent behavior, not from a
  compile/module/import failure. (Here the stubbed `fromConfig` rejects, so the parity assertions
  cannot be reached/satisfied — a behavioral RED.)

## Verification Commands

```bash
set -e
SPEC=packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts
HELP=packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts
test -f "$SPEC" || { echo "FAIL: missing early parity spec"; exit 1; }
test -f "$HELP" || { echo "FAIL: missing buildCliStyleConfig helper"; exit 1; }
ls packages/agents/src/api/__tests__/fixtures/parity-toolcall.jsonl >/dev/null || { echo "FAIL: missing JSONL fixture"; exit 1; }

# Mock-theater / deep-import guards (BLOCKING)
if grep -rnE "mockResolvedValue|toHaveBeenCalled" "$SPEC"; then echo "FAIL: mock theater"; exit 1; fi
if grep -rnE "from '[^']*(/src/|core/src|providers/src)" "$SPEC" "$HELP"; then echo "FAIL: deep import"; exit 1; fi
# No reverse testing for the stub error
if grep -nE "toThrow\('NotYetImplemented'\)|not\.toThrow\(\)" "$SPEC"; then echo "FAIL: reverse test"; exit 1; fi

# Reference Path B must be OBJECT-FORM (not positional)
grep -nE "new AgenticLoop\(\s*\{" "$SPEC" || { echo "FAIL: no object-form reference AgenticLoop drive"; exit 1; }
if grep -nE "new AgenticLoop\(\s*[A-Za-z_]" "$SPEC"; then echo "FAIL: positional AgenticLoop — must be object-form"; exit 1; fi
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

# RED-state ENFORCEMENT (BLOCKING): this slice MUST FAIL now (fromConfig is a P06 stub). It MUST
# actually execute — a setup/compile/deep-import error is NOT an acceptable "RED". P07a re-checks.
set +e
npx vitest run "$SPEC" > /tmp/p07_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p07_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: early parity slice PASSED before fromConfig impl — it is not driving anything (expected RED)."; exit 1; fi
# Per dev-docs/PLAN.md:733-737, a missing-method/stub RED (`TypeError: ... is not a function`) is an
# ACCEPTABLE natural behavioral RED — do NOT categorically reject it (CRIT-3). Both the P06 stub
# `fromConfig` AND the P06 `getConfig` stub throw `NotYetImplemented` (the real getConfig impl is
# deferred to P09 — CRIT-2), which surfaces as an Error reaching the assertion (also acceptable;
# never reverse-asserted). Reject ONLY genuine module/compile/import/transpile failures where the
# test never ran.
if grep -qiE "Cannot find module|SyntaxError|ReferenceError|Failed to resolve import" /tmp/p07_red.log; then
  echo "FAIL: RED is a module/compile/import error (test never ran), not behavioral."; exit 1
fi
echo "RED confirmed for a behavioral reason (public fromConfig path not yet adequate)."

# FROZEN-TEST SNAPSHOT (consumed by P09's RED→GREEN integrity check — NOT git): record sha256 of the
# early slice + shared helper + fixture at the END of this RED phase. P09 compares the slice's hash to
# this and FAILS if the driver was WEAKENED to pass. Content-hash guard (the files are uncommitted, so
# a `git diff HEAD` guard would mis-fire).
mkdir -p project-plans/issue1594remediate/.completed
{
  echo "## Frozen early-parity hashes (P07 RED snapshot)";
  for F in \
    packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts \
    packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts \
    packages/agents/src/api/__tests__/fixtures/parity-toolcall.jsonl ; do
      shasum -a 256 "$F";
  done
} | tee project-plans/issue1594remediate/.completed/P07-frozen-hashes.txt
echo "Recorded frozen early-parity hashes for P09 to verify."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Slice imports ONLY the public root (Path A); Path B reference drive uses the public-root
      `AgenticLoop` (object-form), no deep `/src/` imports.
- [ ] Parity compares actual projected event sequences (Path A vs Path B), not mock calls.
- [ ] Reference drive mirrors `useAgenticLoop.ts:254` object-form construction (all
      `AgenticLoopOptions` fields; never positional).
- [ ] ≥30% property-based; real FakeProvider fixture.
- [ ] Slice is RED NOW for a behavioral reason (stubbed `fromConfig`), and would only go GREEN once
      `fromConfig` (P09) genuinely adopts the Config and drives a real turn.

## Success Criteria

- The early core turn-parity slice is authored, executes, and is RED for a behavioral reason — it
  will drive the fromConfig/runtime implementations toward #1595 adequacy.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; rewrite without mocks/deep imports/positional
  AgenticLoop.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW spec/helper file(s) THIS phase creates (NOT an unscoped `__tests__/` global scan
that would trip on pre-existing #1594 matches). Test files MUST contain no deferred-impl markers and
no reverse/weakened tests.

```bash
set -e
# scoped target file(s): packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts, packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts
for F in "packages/agents/src/api/__tests__/cli-turn-parity.early.spec.ts" "packages/agents/src/api/__tests__/helpers/buildCliStyleConfig.ts"; do
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

Create: `project-plans/issue1594remediate/.completed/P07.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```


Also produce (from the Verification Commands above):
`project-plans/issue1594remediate/.completed/P07-frozen-hashes.txt` — the sha256 content hashes of
the early parity slice, the shared `buildCliStyleConfig` helper, and the fixture as authored in this
RED phase. P09 reads this to prove the integration-first driver was NOT weakened to pass once
`fromConfig` is implemented (content-hash guard; NOT `git diff HEAD`).
