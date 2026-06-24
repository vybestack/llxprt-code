<!-- @plan:PLAN-20260622-COREAPIGAP.P06a @requirement:REQ-002 -->
# Phase 06a: Policy Control Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260622-COREAPIGAP.P06a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 06 completed
- Verification: `test -f project-plans/issue2143/.completed/P06.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare `control/policyControl.ts` against `analysis/pseudocode/policy-control.md` (lines 1-18,
30-33, 40-43). Re-audit the Phase 05 suite for behavioral discipline.

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/policyControl.behavior.test.ts

npx vitest run "$F"
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint

# Delegation + snapshot + projection (BLOCKING).
grep -qE "engine\.getRules\(\)|getEngine\(\)\.getRules\(\)" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: getRules delegate"; exit 1; }
grep -qE "argsPattern\.source" packages/agents/src/api/control/policyControl.ts || { echo "FAIL: argsPattern projection"; exit 1; }
if grep -nE "return[[:space:]]+(engine|this\.deps\.getEngine\(\))\.getRules\(\)" packages/agents/src/api/control/policyControl.ts; then echo "FAIL: live array returned"; exit 1; fi
# No engine/rules caching field.
if grep -nE "this\.(engine|_engine|rules|_rules)\s*=" packages/agents/src/api/control/policyControl.ts; then echo "FAIL: cached engine/rules"; exit 1; fi
# No mutation.
if grep -nE "(addRule|removeRule|setRules)\b" packages/agents/src/api/control/policyControl.ts; then echo "FAIL: mutation present"; exit 1; fi

# Re-audit test discipline (BLOCKING).
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater in test"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
if grep -nE "from ['\"]@vybestack/llxprt-code-(core|providers|policy|tools|mcp)/" "$F"; then echo "FAIL: deep import in test"; exit 1; fi
if grep -nE "from ['\"]\.\./(control|agentImpl)" "$F"; then echo "FAIL: internal import in test"; exit 1; fi
# argsPattern must be asserted as a string, never compared to a RegExp literal.
grep -qE "argsPattern" "$F" || { echo "FAIL: argsPattern not tested"; exit 1; }

# Deferred scan (NEW + changed).
NEW=packages/agents/src/api/control/policyControl.ts
if grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" "$NEW"; then echo "FAIL: deferred marker in control"; exit 1; fi
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then echo "FAIL: deferred in $FILE"; exit 1; fi
done
echo "PASS: pseudocode-compliance + discipline."
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 1-18 getRules snapshot + argsPattern→.source (undefined preserved) | | [ ] |
| 30-33 getDefaultDecision delegate | | [ ] |
| 40-43 isNonInteractive delegate | | [ ] |

### Semantic Verification Checklist

- [ ] Decision table holds (0-rule `[]`; argsPattern string; undefined preserved; default/non-interactive read-through).
- [ ] Fresh snapshot per call (no cache); read-only (no mutation); no `RegExp` leak (R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING).
- [ ] Engine seeded through the real public `AgentConfig.policy` path; test behavioral + ≥30% property; lint/typecheck/full-api-suite green.

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented?** (PolicyControl + interface + wiring)
- **Satisfies REQ-002/.1/.2/.3/.4?** (cite evidence — snapshot, projection, read-only)
- **Data flow** (agent.policy → getEngine() → Config.getPolicyEngine() → real engine; views are fresh)
- **Risks** (RegExp leak, live-array leak, caching, mutation surface)
- **Verdict** (PASS/FAIL with evidence)

## Success Criteria

- Compliance table complete; assessment written; suites + lint + typecheck green.

## Failure Recovery

- Return to Phase 06 or 05; do not proceed to Phase 07.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P06a.md` (include assessment).

```markdown
Phase: P06a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence]
```
