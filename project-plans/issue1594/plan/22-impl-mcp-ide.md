# Phase 22: Impl — MCP Control + Discovery Gate + IDE [GREEN: T12, T12b, T20, T15]

## Phase ID

`PLAN-20260617-COREAPI.P22`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 21a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P21a.md`

## Requirements Implemented (Expanded)

### REQ-013: MCP control + discovery gating

**Full Text**: `agent.mcp` (RUNTIME ONLY) exposes listServers/status/toolsByServer/
auth/discoveryState/refresh. The prompt gate is fixed by this plan: by default,
`chat()`/`stream()` await MCP discovery readiness before starting a model turn;
`TurnOptions.mcpDiscovery?: 'await' | 'skip'` provides an explicit opt-out for callers
that want to start immediately. While discovery is pending, public runtime methods
(`agent.mcp.status()`, `agent.mcp.discoveryState()`, `agent.listTools()`) remain
callable and report pending state. If discovery fails, the turn yields/returns a
structured AgentError with `code:'mcp_discovery_failed'` and exactly one terminal
`done{reason:'error'}`. The Agent does NOT parse slash commands. Durable MCP server
config add/remove is an app-service subpath (P27), not here.

**Behavior**:
- GIVEN MCP discovery is pending
- WHEN `agent.stream(prompt)` is called with default options
- THEN the turn waits for discovery readiness before sending the prompt to the model,
  while `agent.mcp.status()` and `agent.listTools()` remain callable
- AND WHEN discovery fails, the public stream returns a structured MCP-discovery
  error and exactly one `done`

**Why This Matters**: The CLI must preserve its prompt gate without parsing slash
commands inside Agent, and non-CLI clients need deterministic behavior while tools
are still being discovered.

### REQ-014: IDE

**Full Text**: `agent.ide` reports current/detected IDE + trust + status; editor
open/close callbacks fire.

**Behavior**:
- GIVEN IDE detection/callbacks are configured
- WHEN clients query `agent.ide` or tools request editor open/close
- THEN the public IDE surface reports current status/trust and invokes callbacks
  without CLI-only imports

**Why This Matters**: GUI/CLI integrations need editor status and callbacks without
importing CLI IDE hooks.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/control/mcp.ts` — runtime MCP sub-surface + discovery gate
  wiring into chat()/stream().
- `packages/agents/src/api/control/ide.ts` — IDE sub-surface.
  - `@plan:PLAN-20260617-COREAPI.P22` + `@requirement:REQ-013`/`REQ-014`.

### Implementation Rules

- Discovery gate behavior is pre-decided: default `chat()`/`stream()` await MCP readiness; `TurnOptions.mcpDiscovery:'skip'` opts out.
- Discovery failure maps to structured `AgentError{code:'mcp_discovery_failed'}` plus exactly one `done{reason:'error'}`.
- mcp sub-surface is runtime-only; durable add/remove belongs to app-service (P27).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P22"
npm test -- --testNamePattern "T12\b\|T12b\|T20\b\|T15\b"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/mcp.ts packages/agents/src/api/control/ide.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/mcp.ts packages/agents/src/api/control/ide.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] mcp.listServers/status/toolsByServer reflect a configured fake MCP server (T12b)
- [ ] discovery gate honored; runtime methods remain callable (T20)
- [ ] instance listTools includes MCP/extension/skill entries (T12)
- [ ] ide reports current/detected/trust; callbacks fire (T15)

## Success Criteria

- MCP/IDE + gate working; named T-rows green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/mcp.ts packages/agents/src/api/control/ide.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P22.md`
