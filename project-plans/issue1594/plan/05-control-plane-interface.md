# Phase 05: Agent Control-Plane Interface (control-plane-interface)

## Phase ID

`PLAN-20260617-COREAPI.P05`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 04a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P04a.md`

## Requirements Implemented (Expanded)

### REQ-001 (interface): createAgent / Agent surface

**Full Text**: `createAgent(config) → Promise<Agent>` and the `Agent` control
plane (§4.3) MUST exist as the single public orchestration surface.
**Behavior**:
- GIVEN: the §4.3 control plane
- WHEN: the `Agent` interface is defined
- THEN: all top-level methods and sub-surface interfaces exist as typed members
**Why This Matters**: this is the surface #1595 consumes; it must be complete so
the CLI never deep-imports.

### REQ-017 (interface): discovery + result/options/stats types

**Full Text**: The public API MUST expose discovery/result/options/status types needed by the Agent control plane and CLI touchpoints.

Defines `ProviderInfo`, `ToolInfo`, `SessionStats`, `AgentResult`, `AgentError`,
`TurnOptions`, `GenerateOptions`, `AuthStatus`, `ProviderStatus`, and the
sub-surface interfaces (`AgentToolControl`, `AgentMcpControl`, `AgentAuthControl`,
`AgentIdeControl`, `AgentSessionControl`, `AgentProfileControl`,
`AgentHookControl`). `TurnOptions` MUST include
`mcpDiscovery?: 'await' | 'skip'`; `AgentError` MUST include code
`'mcp_discovery_failed'` for T20. Consumes the config types (P03) and event types
(P04).

**Behavior**:
- GIVEN: a caller invokes `stream()`/`chat()` while MCP discovery is pending or fails
- WHEN: they pass default options or `{ mcpDiscovery: 'skip' }`
- THEN: `TurnOptions` expresses the choice and `AgentError` can carry `code:'mcp_discovery_failed'` in `AgentEvent`/`AgentResult`

**Why This Matters**: T20 must compile against the public interface instead of adding ad hoc MCP discovery fields in a later implementation phase.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/agent.ts` — the `Agent` interface, all sub-surface
  interfaces, `TurnOptions` (including `mcpDiscovery?: 'await' | 'skip'`),
  `GenerateOptions`, `AgentResult`, `AgentError` (including
  `code:'mcp_discovery_failed'`), `SessionStats`, `ProviderInfo`, `ToolInfo`,
  `ProviderStatus`, `AuthStatus`, `Unsubscribe`.
  - MUST include: `@plan:PLAN-20260617-COREAPI.P05`, `@requirement:REQ-001,REQ-017`
- `packages/agents/src/api/index.ts` — re-export the public type surface from
  config-types/event-types/agent (single import root for downstream phases).
  - MUST include plan/requirement markers.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260617-COREAPI.P05
 * @requirement REQ-001, REQ-017
 */
```

### Constraints (RULES.md)

- Strict TypeScript: NO `any`, NO type assertions, explicit return types.
- Immutable: prefer `readonly` arrays/fields; async returns where the underlying
  contract is async (`getHistory(): Promise<...>`).
- NO production logic — interface definitions only (no stub bodies yet).
- Keep `@plan`/`@requirement` markers minimal (one marker block per file).

## Verification Commands

```bash
set -e
missing=0
grep -rqc "@plan:PLAN-20260617-COREAPI.P05" packages/agents/src/api/ || { echo "MISSING plan marker"; missing=1; }
# Core Agent control-plane methods present
for m in chat stream getProvider setProvider getModel setModel getModelParams setModelParam getHistory setHistory addHistory resetChat compress getStats onStats generate generateJson generateEmbedding listProviders listTools dispose; do
  grep -q "$m" packages/agents/src/api/agent.ts || { echo "MISSING Agent method $m"; missing=1; }
done
# Sub-surface interfaces present
for s in AgentToolControl AgentMcpControl AgentAuthControl AgentIdeControl AgentSessionControl AgentProfileControl AgentHookControl; do
  grep -q "$s" packages/agents/src/api/agent.ts || { echo "MISSING sub-surface $s"; missing=1; }
done
# MCP discovery public contract present
for s in "mcpDiscovery" "'await'" "'skip'" "AgentError" "mcp_discovery_failed"; do
  grep -q "$s" packages/agents/src/api/agent.ts || { echo "MISSING MCP discovery/error contract $s"; missing=1; }
done
npm run typecheck
grep -rnE ": any\b|as [A-Z]" packages/agents/src/api/agent.ts && { echo "FAIL: any/assertion"; missing=1; } || true
exit $missing
```

### Deferred Implementation Detection

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX)" packages/agents/src/api/agent.ts packages/agents/src/api/index.ts | grep -v ".spec.ts"
# Expected: none
```

### Semantic Verification Checklist

- [ ] Every §4.3 control-plane method + sub-surface is present
- [ ] Async signatures match `AgentClientContract` (getHistory async, etc.)
- [ ] Sub-surface interfaces cover tools/mcp/auth/ide/session/profiles/hooks
- [ ] `TurnOptions.mcpDiscovery` and `AgentError.code:'mcp_discovery_failed'` are present and used by `AgentResult.error` / error events
- [ ] `npm run typecheck` clean

## Success Criteria

- agent.ts + index.ts compile; complete control-plane interface surface.

## Failure Recovery

- `git checkout -- packages/agents/src/api/`; redo with full method coverage.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P05.md`
