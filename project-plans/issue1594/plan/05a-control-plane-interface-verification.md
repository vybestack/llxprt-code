# Phase 05a: Agent Control-Plane Interface Verification

## Phase ID

`PLAN-20260617-COREAPI.P05a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P05" packages/agents/src/api/`

## Verification Commands

```bash
set -e
missing=0
npm run typecheck
for m in chat stream setProvider setModel getHistory setHistory compress getStats onStats generate dispose; do
  grep -q "$m" packages/agents/src/api/agent.ts || { echo "MISSING $m"; missing=1; }
done
for s in AgentToolControl AgentMcpControl AgentAuthControl AgentIdeControl AgentSessionControl AgentProfileControl AgentHookControl; do
  grep -q "$s" packages/agents/src/api/agent.ts || { echo "MISSING $s"; missing=1; }
done
for s in mcpDiscovery AgentError mcp_discovery_failed; do
  grep -q "$s" packages/agents/src/api/agent.ts || { echo "MISSING MCP discovery/error contract $s"; missing=1; }
done
grep -rnE ": any\b|as [A-Z][A-Za-z]+" packages/agents/src/api/agent.ts && { echo "FAIL any/assertion"; missing=1; } || true
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does the `Agent` interface match `specification.md` §4.3 exactly (method names,
   parameters, async-ness)?
2. Are all sub-surface interfaces present and complete?
3. Do async signatures match `AgentClientContract`
   (`getHistory(): Promise<...>`, `setHistory`/`restoreHistory`/`resetChat`)?
4. Can the surface express every harness T-row's inputs/outputs?
5. Can T20 compile against `TurnOptions.mcpDiscovery` and `AgentError.code:'mcp_discovery_failed'`?
6. No `any`, no assertions, explicit return types, readonly where appropriate?

### Holistic Functionality Assessment (completion marker)

- Describe the public control-plane surface.
- Confirm it can express every harness T-row.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if control-plane surface complete, typecheck clean, no `any`/assertions.

## Failure Recovery

- Return to Phase 05 with specific missing-method list.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P05a.md`
