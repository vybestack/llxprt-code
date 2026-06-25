<!-- @plan:PLAN-20260622-COREAPIGAP.P20a @requirement:REQ-INT-001,REQ-INT-002,REQ-INT-003,REQ-INT-004 -->
# Phase 20a: Capability-Gap Adequacy Driver — Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P20a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 20 completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P20.md`

## Purpose

This is the plan's keystone gate. Confirm the adequacy driver genuinely proves the #1595 mission:
EVERY new capability is reachable on a REAL `Agent` built through the PUBLIC ROOT, with NO
`getConfig()` escape and NO deep import — and that the driver is behavioral (real Agent, real
results), not a reachability sham (e.g. only `typeof` checks with no real calls). Verify the T17
boundary guard actually polices this file.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/capabilityGaps.integration.spec.ts

# 1. The #1595 keystone, restated as a hard gate: zero getConfig, zero deep import, zero internals.
if grep -nE "getConfig" "$F"; then echo "FAIL: getConfig escape present"; exit 1; fi
if grep -nE "internals(\.js)?'|/dist/" "$F"; then echo "FAIL: internals/dist import"; exit 1; fi
if grep -nE "from '[^']*(/src/|core/|providers/|tools/|auth/|settings/|ide-integration/|policy/)" "$F" \
   | grep -vE "from '@vybestack/llxprt-code-agents'"; then echo "FAIL: deep import"; exit 1; fi
# Only public root + node/vitest/fast-check + ./helpers/agentHarness.js may be imported.
# Key off the `from '<specifier>'` clause (NOT a bare `^import`, which false-positives on the
# prettier-mandated multi-line `import type {` opener whose specifier is on a later line).
BAD=$(grep -nE "from '" "$F" | grep -vE "from '(@vybestack/llxprt-code-agents|node:[^']*|vitest|fast-check|\./helpers/agentHarness\.js)'" || true)
[ -z "$BAD" ] || { echo "FAIL: unexpected import on the public-consumer path:"; echo "$BAD"; exit 1; }

# 2. Behavioral, not a sham: it must CALL each capability and assert on REAL results (await + expect),
#    not merely `typeof`. Require real-call evidence per capability.
# NOTE: these two async checks keep the `await ` prefix (it distinguishes a REAL invocation from a
# bare `typeof agent.mcp.details` reference) but are receiver-agnostic — the harness returns
# `built`, so the natural call site is `await built.agent.mcp.details(`. Pinning a bare `agent`
# receiver would brittly false-fail on the legitimate `built.agent.` form (the other five capability
# checks below are already receiver-agnostic substring matches).
grep -qE "await [A-Za-z_.]*auth\.detailedStatus\(" "$F" || { echo "FAIL: auth.detailedStatus not actually called"; exit 1; }
grep -qE "await [A-Za-z_.]*mcp\.details\(" "$F" || { echo "FAIL: mcp.details not actually called"; exit 1; }
grep -qE "agent\.tasks\.(list|cancelAllRunning)\(" "$F" || { echo "FAIL: tasks not actually called"; exit 1; }
grep -qE "agent\.policy\.getRules\(" "$F" || { echo "FAIL: policy.getRules not actually called"; exit 1; }
grep -qE "agent\.hooks\.setDisabledHooks\(" "$F" || { echo "FAIL: hooks round-trip not actually driven"; exit 1; }
grep -qE "agent\.setApprovalMode\(" "$F" || { echo "FAIL: approval not actually set"; exit 1; }
grep -qE "agent\.tools\.keys\.(supported|status)\(" "$F" || { echo "FAIL: tool-keys not actually called"; exit 1; }
# Untrusted-folder throw genuinely driven.
grep -qE "folderTrust: false" "$F" && grep -qiE "untrusted folder" "$F" || { echo "FAIL: untrusted throw not driven"; exit 1; }

# 3. The driver is GREEN and the T17 boundary guard PASSES on it (the file is in scope of the guard).
npx vitest run "$F" 2>&1 | tail -40
npx vitest run packages/agents/src/api/__tests__/boundary.spec.ts 2>&1 | tail -20
# Prove the boundary guard actually scans this file: it must be a *.spec.ts (in-scope) not *.test.ts.
case "$F" in *.spec.ts) echo "in T17 scope (.spec.ts)";; *) echo "FAIL: adequacy driver must be .spec.ts to be T17-policed"; exit 1;; esac

# 4. Whole dir + typecheck green.
npx vitest run packages/agents/src/api/__tests__/ > /tmp/p20a_all.log 2>&1 || { echo "FAIL: regressions"; tail -60 /tmp/p20a_all.log; exit 1; }
npm run typecheck 2>&1 | tail -12

# 5. Discipline + property gate.
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.fn\(|vi\.spyOn|not\.toThrow\(\)|\.skip\(" "$F"; then echo "FAIL: discipline"; exit 1; fi
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '/(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 } /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } } END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
[ "$PROP" -ge 2 ] && [ "$PCT" -ge 30 ] || { echo "FAIL: property gate"; exit 1; }
echo "PASS: P20a keystone gates green."
```

## Holistic Assessment (MANDATORY — into marker)

- **Reachability proven**: each of the seven capabilities is actually CALLED (await/expect on real
  results) on a public-root-built Agent — not a `typeof`-only sham. Cite the real-call lines.
- **No escape**: zero `getConfig`, zero deep import, zero internals; import set is exactly {public
  root, node, vitest, fast-check, agentHarness}. The file is `.spec.ts` so the T17 guard polices it,
  and the guard is GREEN — the strongest possible evidence the #1595 boundary holds.
- **Edge fidelity**: untrusted-folder throw driven through the public harness; `abortController`
  projected out; auth/tool-keys masked.
- **#1595 verdict**: state explicitly whether a CLI restricted to the public root could now drive all
  seven capabilities. PASS/FAIL with evidence.

## Success Criteria

- Driver green; T17 guard green on it; behavioral (real calls); zero escape; verdict PASS.

## Failure Recovery

- If any capability is not genuinely reachable/called from the public root, reopen the owning
  component phase (or P17 barrel). Never weaken the driver to pass.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P20a.md` (include real-call evidence + #1595 verdict).

```markdown
Phase: P20a
Completed: YYYY-MM-DD HH:MM
Files Created: none
Files Modified: none (verification only)
Verification: [paste actual output incl. driver + boundary.spec.ts green]
Holistic Assessment: [PASS/FAIL; explicit #1595 reachability verdict with cited real-call lines]
```
