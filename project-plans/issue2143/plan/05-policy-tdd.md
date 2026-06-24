<!-- @plan:PLAN-20260622-COREAPIGAP.P05 @requirement:REQ-002 -->
# Phase 05: Policy Control (read-only) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P05`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 04a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P04a.md`

## Requirements Implemented (Expanded)

### REQ-002: Read-only policy inspection via `agent.policy`

**Full Text**: `Agent` MUST expose a read-only `policy` sub-controller (`AgentPolicyControl`) with
`getRules(): readonly PolicyRuleView[]`, `getDefaultDecision(): PolicyDecision`, and
`isNonInteractive(): boolean`, each delegating to the live `Config.getPolicyEngine()`
(`configBaseCore.ts:475`).
- **REQ-002.1**: `getRules()` returns a fresh read-only snapshot; each `PolicyRuleView.argsPattern`
  is the `RegExp.source` STRING (never a `RegExp`); a rule with no `argsPattern` projects `undefined`
  (R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING).
- **REQ-002.2**: `getDefaultDecision()` returns the engine default decision.
- **REQ-002.3**: `isNonInteractive()` returns the engine non-interactive flag.
- **REQ-002.4**: rule MUTATION is OUT OF SCOPE (no add/remove/set on the controller).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN an engine seeded with a rule whose `argsPattern` is `/"command":"npm test"/` → the
  corresponding `PolicyRuleView.argsPattern === '"command":"npm test"'` (string).
- GIVEN a rule with no `argsPattern` → its view's `argsPattern === undefined`.
- GIVEN `defaultDecision: ASK_USER`, `nonInteractive: true` → `getDefaultDecision() === ASK_USER`
  and `isNonInteractive() === true`.
- GIVEN the snapshot array → mutating it does NOT affect a subsequent `getRules()` (fresh array).

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/policyControl.behavior.test.ts`
  - Drive through the PUBLIC ROOT via the `buildAgent` harness (`helpers/agentHarness.ts:79`). The
    REAL `PolicyEngine` is SEEDED through the public config path with ZERO mocking (verified P00a):
    - `AgentConfig.policy` (`config-types.ts:164`, type `PolicyEngineConfig`) →
      `agentConfig.adapter.ts:207-208` → `params.policyEngineConfig` → `configConstructor.ts:469`
      `new PolicyEngine(params.policyEngineConfig)` → `Config.getPolicyEngine()` returns it.
    - So `buildAgent('plain-text.jsonl', { policy: { rules: [...], defaultDecision, nonInteractive } })`
      yields a real engine with your seeded rules. Then assert `agent.policy.getRules()` etc.
  - **`PolicyDecision` enum VALUE sourcing:** the agents public root does NOT yet export
    `PolicyDecision` (added in Phase 17). Import the VALUE from the BARE core barrel:
    `import { PolicyDecision } from '@vybestack/llxprt-code-core';`. `.behavior.test.ts` is T17-EXEMPT
    and the bare barrel (no trailing `/`) is NOT a deep import. The `PolicyEngineConfig`/`PolicyRule`
    TYPES needed to seed may be imported `import type { ... } from '@vybestack/llxprt-code-core';`.
  - Markers `@plan:PLAN-20260622-COREAPIGAP.P05`, `@requirement:REQ-002`.

### Required scenarios

```
T4    seed engine with 2 rules (one WITH argsPattern /"command":"npm test"/, one WITHOUT) →
      agent.policy.getRules() returns 2 views; the first view's argsPattern === '"command":"npm test"'
      (a STRING), the second view's argsPattern === undefined; and NO view's argsPattern is a RegExp
      (assert typeof !== 'object' / instanceof RegExp === false)
T4b   snapshot isolation: const a = agent.policy.getRules(); (a as PolicyRuleView[]).length mutation
      attempt does not change agent.policy.getRules().length on a second call (fresh array each call)
T6    seed { defaultDecision: PolicyDecision.ASK_USER, nonInteractive: true } →
      agent.policy.getDefaultDecision() === PolicyDecision.ASK_USER AND
      agent.policy.isNonInteractive() === true
PROP  argsPattern projection: for a generated set of rule argsPattern sources (strings that are valid
      regex bodies), after seeding rules new RegExp(src), every returned view.argsPattern === the
      original src string (RegExp.source round-trip); MIN-2 cases
PROP  rules count/order fidelity: for a generated list of N (1..5) rules, agent.policy.getRules()
      has length N and the decisions line up positionally with the seeded rules; MIN-2 cases
```

### Constraints

- Assert real return VALUES (rule fields, decision enum, boolean) — NEVER `toHaveBeenCalled`.
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- Seed the engine via `AgentConfig.policy` ONLY — do NOT construct a `PolicyEngine` directly in the
  test, do NOT spy on `getPolicyEngine`/`getRules`.
- Positive cases fail at RED because `agent.policy` does not exist yet → missing-property/missing-method
  `TypeError` (acceptable behavioral RED).
- Do NOT assert `argsPattern` equals a `RegExp`; assert it is the `.source` STRING (the R-ARGSPATTERN
  contract).

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/policyControl.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# Deep-import guard: bare core barrel allowed (enum value); deep core/<path> and internal not allowed.
if grep -nE "from ['\"]@vybestack/llxprt-code-(core|providers|policy|tools|mcp)/" "$F"; then echo "FAIL: deep subpath import"; exit 1; fi
if grep -nE "from ['\"]\.\./(control|agentImpl)" "$F"; then echo "FAIL: internal import"; exit 1; fi

# Property-based >= 30% (BLOCKING; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property ${PCT}% < 30%"; exit 1; fi

# argsPattern STRING contract asserted (BLOCKING — the test must check .source projection).
grep -qE "argsPattern" "$F" || { echo "FAIL: argsPattern projection not tested"; exit 1; }

# RED-state enforcement.
set +e
npx vitest run "$F" > /tmp/p05_red.log 2>&1
STATUS=$?
set -e
tail -30 /tmp/p05_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P06"; exit 1; fi
if grep -qiE "Cannot find module|SyntaxError|Failed to resolve import|ReferenceError" /tmp/p05_red.log; then
  echo "FAIL: RED is module/compile error, not behavioral"; exit 1
fi
echo "RED confirmed behavioral (expected until P06)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] Engine seeded ONLY via `AgentConfig.policy` through the public `buildAgent` harness (no direct
      `new PolicyEngine`, no spies).
- [ ] `argsPattern` asserted as STRING `.source` (and `undefined` when absent); never `RegExp`.
- [ ] ≥30% property-based; MIN-2; no mock theater; no reverse tests.
- [ ] RED for behavioral reasons.

## Success Criteria

- Behavioral RED suite; ≥30% property; engine seeded through the real public config path.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/policyControl.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P05.md`

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
