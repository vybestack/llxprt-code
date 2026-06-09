# Phase 06a: Agent Client and Config Accessor Rename Verification

## Phase ID

`PLAN-20260608-ISSUE1423.P06a`

## Prerequisites

- Required: Phase 06 completed.
- Verification: `test -f project-plans/issue1423/.completed/P06.md`.

## Verification Scope

Verify the agent client/config accessor rename is complete and no old aliases remain.

## Required Checks

```bash
grep -n "class AgentClient" packages/core/src/core/client.ts
grep -n "getAgentClient" packages/core/src/config/configBaseCore.ts
test ! -f packages/core/src/core/__tests__/geminiClient.dispose.test.ts
test ! -f packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts
rg "GeminiClient|getGeminiClient|geminiClient" packages/core/src packages/cli/src packages/a2a-server/src packages/providers/src --glob '!**/dist/**' --glob '!**/coverage/**' --glob '!**/*.log' --glob '!**/*.xml'
npm run typecheck
```

## Holistic Functionality Assessment

The reviewer must read `client.ts`, `configBaseCore.ts`, `config.ts`, and representative CLI/A2A call sites. Answer:

- What was implemented?
- How does config now expose the agent client?
- Does any old-name alias/shim remain?
- Does the data flow from config to CLI/A2A still work?
- What remaining old-name matches are legitimate or violations?

## PASS Criteria

PASS only if direct callers are migrated and no old core client API remains.

## Phase Completion Marker

Create `project-plans/issue1423/.completed/P06a.md` with PASS/FAIL and assessment.
