<!-- @plan:PLAN-20260622-COREAPIGAP.P03 @requirement:REQ-001 -->
# Phase 03: Approval Mode — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P03`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 02a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P02a.md`

## Requirements Implemented (Expanded)

### REQ-001: Approval mode read/write on `Agent`

**Full Text**: `Agent` MUST expose `getApprovalMode(): ApprovalMode` and
`setApprovalMode(mode: ApprovalMode): void` as top-level methods that delegate DIRECTLY to the bound
`Config.getApprovalMode()` (`configBaseCore.ts:463`) and `Config.setApprovalMode()` (`config.ts:401`).
- **REQ-001.1**: `getApprovalMode()` returns the live Config value (no caching).
- **REQ-001.2**: `setApprovalMode(mode)` delegates DIRECTLY — it MUST NOT normalize, swallow, or
  catch. The untrusted-folder throw (`"Cannot enable privileged approval modes in an untrusted
  folder."`, `config.ts:404`) MUST propagate faithfully for any non-`DEFAULT` mode in an untrusted
  folder.

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a Config whose approval mode is `AUTO_EDIT` → `agent.getApprovalMode()` returns
  `ApprovalMode.AUTO_EDIT`.
- GIVEN a trusted folder → `agent.setApprovalMode(YOLO)` makes a subsequent `getApprovalMode()`
  return `YOLO` (no caching).
- GIVEN an untrusted folder → `agent.setApprovalMode(YOLO)` THROWS the untrusted-folder error
  (uncaught, unnormalized).

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/agent.approvalMode.behavior.test.ts`
  - This component drives ENTIRELY through the PUBLIC ROOT `@vybestack/llxprt-code-agents` using the
    existing `buildAgent` harness (`__tests__/helpers/agentHarness.ts:79`) — NO deep imports, NO
    mocking. Mirror `agent.sequenceModel.behavior.test.ts` structure (real agent, real Config,
    assertions on real return values).
  - The harness `buildAgent(fixtureRelPath, configOverrides)` accepts `Partial<AgentConfig>`. Two
    blessed real seams (verified in P00a) make every case drivable with NO mock theater:
    - `approvalMode: ApprovalMode.AUTO_EDIT` → `agentConfig.adapter.ts:204-205` →
      `params.approvalMode` → `Config.getApprovalMode()` returns it (T1 setup).
    - `folderTrust: false` → `agentConfig.adapter.ts:210-212` → `params.trustedFolder = false` →
      `Config.isTrustedFolder()` returns `false` (`config.ts:512`) → the REAL untrusted-folder throw
      fires from `Config.setApprovalMode` (`config.ts:402-405`) (T2 setup). This is the production
      throw path driven through the public API — NOT a spy (core's own `config.d.test.ts:101` spies
      `isTrustedFolder`; we MUST NOT — we drive the real Config flag instead).
  - Use the existing committed fixture `plain-text.jsonl` (already used by the sequence-model suite).
  - **`ApprovalMode` enum VALUE sourcing (IMPORTANT — verified in P00a/P02a):** the agents public
    root currently re-exports `ApprovalMode` as a TYPE ONLY (`config-types.ts:25`, `agent.ts:387`),
    so `ApprovalMode.AUTO_EDIT` (a VALUE) is NOT yet importable from `@vybestack/llxprt-code-agents`.
    The value-export promotion is owned by Phase 17 (REQ-008 barrel). For THIS phase, import the enum
    VALUE from the core barrel: `import { ApprovalMode } from '@vybestack/llxprt-code-core';`. This is
    permitted because `.behavior.test.ts` is T17-EXEMPT (the boundary scan only governs `*.spec.ts`),
    and the enum is a stable core value used the same way the harness `AgentConfig` accepts it. Do NOT
    import `ApprovalMode` as a value from the public agents root in this phase — it would be a module
    resolution error (a non-behavioral RED) and the RED-gate would (correctly) reject it.
  - After Phase 17 promotes `ApprovalMode` to a value export, a later phase MAY switch this import to
    the public root; that switch is NOT part of P03.
  - Markers `@plan:PLAN-20260622-COREAPIGAP.P03`, `@requirement:REQ-001`.

### Required scenarios

```
T1    build agent with { approvalMode: ApprovalMode.AUTO_EDIT } (trusted) →
      agent.getApprovalMode() === ApprovalMode.AUTO_EDIT (live read)
T2    build agent with { folderTrust: false } →
      agent.setApprovalMode(ApprovalMode.YOLO) throws, and the thrown message is
      "Cannot enable privileged approval modes in an untrusted folder." (real propagated throw)
T3    build agent (trusted) → agent.setApprovalMode(ApprovalMode.YOLO);
      agent.getApprovalMode() === ApprovalMode.YOLO (write-then-read parity via public root, no cache)
PROP  round-trip (trusted): for any mode m in {DEFAULT, AUTO_EDIT, YOLO}, after
      agent.setApprovalMode(m), agent.getApprovalMode() === m (use fc.constantFrom over the 3 enum
      values; MIN-2 distinct cases)
PROP  untrusted matrix: for any non-DEFAULT mode m in {AUTO_EDIT, YOLO} with { folderTrust: false },
      agent.setApprovalMode(m) throws the untrusted-folder error; and setApprovalMode(DEFAULT) does
      NOT throw (DEFAULT is always allowed — config.ts:402 guards only non-DEFAULT)
```

### Constraints

- Assert real return VALUES / real thrown error messages — NEVER `toHaveBeenCalled`.
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- T2 / the untrusted PROP MUST assert the SPECIFIC message
  `"Cannot enable privileged approval modes in an untrusted folder."` — asserting a real, faithful
  throw is NOT a reverse test (it is the genuine REQ-001.2 contract). Do NOT use `not.toThrow()`
  as a sole assertion shape anywhere; the DEFAULT-allowed leg of the untrusted PROP must additionally
  assert a positive post-condition (e.g. `agent.getApprovalMode() === ApprovalMode.DEFAULT`).
- RED for the right reason: the methods do not exist yet, so positive cases (T1/T3) fail with a
  missing-method `TypeError`, and T2 fails because the thrown message is the missing-method error,
  not the untrusted message. Both are acceptable behavioral RED (CRIT-3).
- Do NOT spy/stub `isTrustedFolder` or `Config.setApprovalMode`; drive the real flag via `folderTrust`.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/agent.approvalMode.behavior.test.ts
test -f "$F"

# Mock theater / reverse testing guards (BLOCKING)
if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test (bare not.toThrow)"; exit 1; fi

# Property-based >= 30% (BLOCKING — count DISTINCT property test CASES; MIN-2).
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
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases (MIN-2)"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property-based ${PCT}% < 30%"; exit 1; fi

# T17 boundary courtesy check: this .behavior.test.ts is T17-EXEMPT, but it SHOULD still import only
# the public root for this all-public component. BLOCKING: no deep agents/core subpath imports.
if grep -nE "from ['\"]@vybestack/llxprt-code-(core|providers|policy|tools|mcp)/" "$F"; then
  echo "FAIL: deep import in an all-public-root component test"; exit 1
fi
if grep -nE "from ['\"]\.\./(control|agentImpl)" "$F"; then
  echo "FAIL: internal import in an all-public-root component test"; exit 1
fi

# RED-state enforcement (BLOCKING): positive cases present and the suite is RED for a behavioral reason.
grep -qE "T1|T3" "$F" || { echo "FAIL: positive cases (T1/T3) missing"; exit 1; }
set +e
npx vitest run "$F" > /tmp/p03_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p03_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: suite unexpectedly all-green before P04"; exit 1; fi
# Missing-method TypeError is acceptable behavioral RED (CRIT-3). Reject only module/compile errors.
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p03_red.log; then
  echo "FAIL: RED is a module/compile/import error, not a behavioral assertion failure."; exit 1
fi
echo "RED confirmed for behavioral reasons (expected until P04)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] All agent CONSTRUCTION + behavior drives through the public root `@vybestack/llxprt-code-agents`
      (`buildAgent` harness). The ONLY non-public import permitted in this phase is the
      `ApprovalMode` enum VALUE from the bare core barrel `@vybestack/llxprt-code-core` (no trailing
      `/`, i.e. NOT a deep subpath) — a temporary sourcing closed by Phase 17. No deep `core/<path>`
      and no `../control`/`../agentImpl` internal imports.
- [ ] T2 (and the untrusted PROP) assert the SPECIFIC untrusted-folder message via the REAL `folderTrust`
      flag — no spying on `isTrustedFolder`/`setApprovalMode`.
- [ ] Positive cases (T1/T3) FAIL for a behavioral missing-method reason.
- [ ] ≥30% property-based (computed, enforced); MIN-2 property cases.
- [ ] No mock theater; no bare reverse tests.

## Success Criteria

- Behavioral tests authored; suite RED for behavioral reasons; ≥30% property-based; public-root-only.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

Scoped to the NEW test file THIS phase creates.

```bash
set -o pipefail
set -e
for F in "packages/agents/src/api/__tests__/agent.approvalMode.behavior.test.ts"; do
  test -f "$F" || continue
  if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then
    echo "FAIL: deferred-implementation marker in $F"; exit 1
  fi
  if grep -niE "expect\(.*\)\.(not)\.toBeDefined|toThrow\(.*NotYetImplemented|should (not )?be implemented|reverse test|negative test \(expected\)" "$F"; then
    echo "FAIL: reverse/weakened-test pattern in $F"; exit 1
  fi
  if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then
    echo "FAIL: skipped/disabled test in $F"; exit 1
  fi
done
echo "PASS: no deferred-implementation markers / reverse tests in the new test file."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P03.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; fill every field with REAL values):

```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
