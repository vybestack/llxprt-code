# Phase 25: Impl — Discovery Helpers (static + instance) [GREEN: T12, T25]

## Phase ID

`PLAN-20260617-COREAPI.P25`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 24a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P24a.md`

## Requirements Implemented (Expanded)

### REQ-017: discovery helpers (static + instance)

**Full Text**: Static `listProviders()`/`listTools()` return built-in/static names
(re-projected from providers' `listProviders()` accessor); instance
`agent.listProviders()`/`agent.listTools()` return the authoritative config-dependent
set (extensions/MCP/skills/active ProviderManager). Static helpers let a consumer pick
a plausible value before building an agent.

**Behavior**:
- GIVEN a consumer asks for static discovery before creating an Agent
- WHEN `listProviders()`/`listTools()` are called
- THEN built-in/static public info is returned without CLI imports
- AND GIVEN an initialized Agent with MCP/extensions/skills
- WHEN instance discovery is called
- THEN the config-dependent public info includes those contributions

**Why This Matters**: Scripts need pre-agent discovery, while the CLI/GUI need the
actual initialized runtime set without importing provider/tool internals.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/discovery.ts` — static listProviders/listTools (project
  from `@vybestack/llxprt-code-providers/runtime.js` listProviders + built-in tool registry).
- `packages/agents/src/api/agent.ts` — instance listProviders/listTools from
  initialized Config.
  - `@plan:PLAN-20260617-COREAPI.P25` + `@requirement:REQ-017`.

### Implementation Rules

- Re-project to public `ProviderInfo[]`/`ToolInfo[]`; do not leak internal types.
- Instance discovery reflects extensions/MCP/skills (T12).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P25"
npm test -- --testNamePattern "T12\b\|T25\b"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/discovery.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/discovery.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] static listProviders returns the available set without CLI deep import (T25)
- [ ] instance listTools includes MCP/extension/skill entries (T12)
- [ ] public ProviderInfo/ToolInfo shapes (no internal leakage)

## Success Criteria

- Discovery helpers working; T12/T25 green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/discovery.ts packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P25.md`
