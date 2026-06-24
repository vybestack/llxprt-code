<!-- @plan:PLAN-20260621-COREAPIREMED.P18a @requirement:REQ-005,REQ-001 -->
# Phase 18a: Provider-Runtime Seam Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260621-COREAPIREMED.P18a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 18 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P18.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare against `analysis/pseudocode/provider-runtime-seam.md` lines 10–23.

```bash
set -e
npx vitest run packages/agents/src/api/__tests__/runtimeSeam.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint
# BLOCKING impl checks
grep -q "getRuntimeId(): string;" packages/agents/src/api/agent.ts || { echo "FAIL: getRuntimeId not on interface"; exit 1; }
grep -q "return this.deps.runtimeId;" packages/agents/src/api/agentImpl.ts || { echo "FAIL: getRuntimeId impl missing"; exit 1; }
if grep -nE "export \{[^}]*getProviderManager" packages/agents/src/index.ts packages/agents/src/api/index.ts; then
  echo "FAIL: raw ProviderManager getter exposed at public surface"; exit 1
fi
if grep -n "createHeadlessProviderManager" packages/agents/src/api/fromConfig.ts; then
  echo "FAIL: headless manager constructed on adopt path (must adopt config's manager)"; exit 1
fi
# CRIT-1 verification: fromConfig adopts the supplied Config's ProviderManager (no second manager).
grep -qE "config\.getProviderManager\(\)" packages/agents/src/api/fromConfig.ts \
  || { echo "FAIL: fromConfig does not source the adopted ProviderManager from the Config"; exit 1; }
grep -qE "providerManager\s*:" packages/agents/src/api/fromConfig.ts \
  || { echo "FAIL: fromConfig does not pass providerManager into createIsolatedRuntimeContext"; exit 1; }
# CRIT-1/CRIT-2 boundary: this plan does NOT re-add the messageBus seam to providers (already exists);
# the providers change is ONLY the additive providerManager? option (verified in P05/P05a).
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 10–12 getRuntimeId → deps.runtimeId | agentImpl.ts | [ ] |
| 11 runtimeId == context runtimeId | createAgent/fromConfig finalize | [ ] |
| 20–23 providers adopt active runtime | agentImpl providers sub-surface | [ ] |

### Semantic Verification Checklist

- [ ] getRuntimeId == runtime-context runtimeId for BOTH entry points.
- [ ] No second ProviderManager on adopt path (instance identity verified).
- [ ] No raw ProviderManager getter at root.
- [ ] messageBus seam NOT re-added in providers (already exists upstream).
- [ ] lint + typecheck clean; suites green.

## Holistic Functionality Assessment (MANDATORY — into marker)

### What was implemented? ### Satisfies REQ-005/.1/.2 + REQ-001.2? ### Adoption data flow ### Risks ### Verdict

## Success Criteria

- Compliance table complete; assessment written; suites green.

## Failure Recovery

- Return to Phase 18; do not proceed to Phase 19.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P18a.md` (include assessment).

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P18a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

