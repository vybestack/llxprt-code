# Phase 22a: MCP / Discovery Gate / IDE Verification

## Phase ID

`PLAN-20260617-COREAPI.P22a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 22 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P22" packages/agents/src/api/control/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P22"
npm test -- --testNamePattern "T12\b\|T12b\|T20\b\|T15\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/mcp.ts packages/agents/src/api/control/ide.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Do mcp methods reflect a real configured fake MCP server?
2. Does default `chat()`/`stream()` await MCP readiness while runtime methods stay callable?
3. Does `TurnOptions.mcpDiscovery:'skip'` opt out, and does discovery failure produce `AgentError{code:'mcp_discovery_failed'}` plus exactly one `done{reason:'error'}`?
4. Does instance listTools include MCP/extension/skill entries?
5. Does ide report current/detected/trust and fire callbacks?
6. Is durable MCP add/remove correctly deferred to app-service (not on Agent)?

### Holistic Functionality Assessment (completion marker)

- Trace discovery-pending → gated chat() → ready → proceeds.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if MCP/IDE/gate behaviorally correct, T-rows green.

## Failure Recovery

- Return to Phase 22.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P22a.md`
