<!-- @plan:PLAN-20260621-COREAPIREMED.P10a @requirement:REQ-002,REQ-INT-003 -->
# Phase 10a: Settings Surface Stub Verification

## Phase ID

`PLAN-20260621-COREAPIREMED.P10a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 10 completed
- Verification: `test -f project-plans/issue1594remediate/.completed/P10.md`

## Verification Tasks

```bash
set -e
# CRIT-2: getConfig's interface member was declared in P06 (with the fromConfig seam) and implemented
# at P09, NOT here. P10 must REFERENCE it, not re-declare it. Confirm it is present (from P06) AND
# declared exactly once on the interface.
grep -q "getConfig(): Config" packages/agents/src/api/agent.ts || { echo "FAIL: getConfig missing — should exist from P06"; exit 1; }
if [ "$(grep -cE "getConfig\s*\(\s*\)\s*:\s*Config" packages/agents/src/api/agent.ts)" -ne 1 ]; then echo "FAIL: getConfig must be declared exactly once (P10 must not duplicate the P06 member)"; exit 1; fi
# P10 adds ONLY the three ephemeral methods (it does NOT newly add getConfig).
for m in getEphemeralSetting setEphemeralSetting getEphemeralSettings; do
  grep -q "$m" packages/agents/src/api/agent.ts
  grep -q "$m" packages/agents/src/api/agentImpl.ts
done
grep -rq "@plan:PLAN-20260621-COREAPIREMED.P10" packages/agents/src/api/
npm run typecheck
# No version duplication (BLOCKING)
DUP=$(find packages/agents/src -name "*V2*" -o -name "*New*")
if [ -n "$DUP" ]; then echo "FAIL: duplicate/parallel files: $DUP"; exit 1; fi
```

### Semantic Verification Checklist

- [ ] The THREE ephemeral methods are newly on the public interface with correct signatures (read agent.ts).
- [ ] `getConfig()` interface member is present from P06 (impl from P09) and declared exactly once (P10 did NOT re-add it).
- [ ] Stubs compile; no logic yet; no parallel store.
- [ ] Additive only (existing Agent members unchanged).

## Holistic Assessment (MANDATORY)

Confirm the surface matches the pseudocode contract (4 delegating methods) and is additive. Verdict.

## Success Criteria

- All checks pass.

## Failure Recovery

- Return to Phase 10.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P10a.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P10a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```

