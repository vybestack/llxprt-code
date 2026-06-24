# Phase 03: AgentConfig Types + Zod Schema (config-schema)

## Phase ID

`PLAN-20260617-COREAPI.P03`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 02a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P02a.md`

## Requirements Implemented (Expanded)

### REQ-002: AgentConfig → ConfigParameters translation (config types + schema only here)

**Full Text**: The API MUST accept a single declarative `AgentConfig` with typed
common fields + an explicit unstable `settings` escape hatch, classifiable to
ConfigParameters/sub-surface/settings.
**Behavior**:
- GIVEN: a consumer building config
- WHEN: they construct an `AgentConfig`
- THEN: TypeScript types + a Zod schema validate it (parse rejects unknown
  shapes / shadowed keys)
**Why This Matters**: schema-first (RULES.md) catches misconfiguration at the boundary.

### REQ-017: Config-relevant public projection types

**Full Text**: The public API MUST define all config-side handler and projection
types referenced by `AgentConfig`, including `ApprovalHandler`, `OAuthPromptHandler`,
`EditorCallbacks`, `AgentSchedulerFactory`, `AgentSchedulerHandle`, `ProviderAuth`,
and the complete typed/sub-surface/settings classification for fields enumerated in
the authoritative design.

**Behavior**:
- GIVEN: a consumer configures approvals, OAuth, editor callbacks, scheduler factory,
  auth, tools, MCP, sandbox, and runtime toggles
- WHEN: they write `AgentConfig`
- THEN: TypeScript exposes typed public shapes for those supported fields and a
  documented classification for fields intentionally handled by a sub-surface or
  the unstable `settings` hatch.

**Why This Matters**: #1595 must not deep-import config internals or silently hide
CLI-needed fields in an unstable settings bag.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/config-types.ts` — `AgentConfig`, `ProviderAuth`, the
  typed first-class fields, and the config-scoped handler types
  (`ApprovalHandler`, `OAuthPromptHandler`, `EditorCallbacks`,
  `AgentSchedulerFactory`, `AgentSchedulerHandle`). `AgentConfig` MUST include
  `toolSchedulerFactory?: AgentSchedulerFactory`; the factory function remains
  caller-owned, while scheduler instances it creates for the Agent are Agent-owned
  and disposed by `Agent.dispose()`.
  - MUST include: `@plan:PLAN-20260617-COREAPI.P03`, `@requirement:REQ-002,REQ-006,REQ-017`
- `packages/agents/src/api/config-schema.ts` — Zod `AgentConfigSchema`
  (+ `ProviderAuthSchema`). `AgentConfig` derived from / consistent with schema.
  - MUST include plan/requirement markers.
- `packages/agents/src/api/config-classification.ts` — exhaustive public
  classification table for every field from overview.md §4.2 and current
  `ConfigParameters`: `typed`, `agent-sub-surface`, `app-service`, or
  `settings-escape-hatch`, with rationale for every non-typed field.
  - MUST include plan/requirement markers.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260617-COREAPI.P03
 * @requirement REQ-002, REQ-017
 */
```

### Constraints (RULES.md)

- Strict TypeScript: NO `any`, NO type assertions, explicit return types.
- Zod schema-first.
- Immutable: prefer `readonly` arrays/fields.
- NO production logic — type/schema definitions only.
- Keep `@plan`/`@requirement` markers minimal (one marker block per file; no
  additional explanatory comments).

## Verification Commands

```bash
set -e
missing=0
grep -rqc "@plan:PLAN-20260617-COREAPI.P03" packages/agents/src/api/ || { echo "MISSING plan marker"; missing=1; }
# Every CLI-needed typed field from specification.md §4.2 present in AgentConfig
for f in provider model modelParams auth tools excludeTools mcpServers approvalMode systemPrompt workingDir sessionId includeDirectories fileFiltering telemetry proxy maxSessionTurns compression checkpointing recording policy extensions ide hooks memory streamIdleTimeoutMs toolOutputLimits outputFormat shell contextLimit compressionThreshold skills useWriteTodos sandbox folderTrust embeddingModel debugMode continueOnFailedApiCall allowedTools coreTools toolDiscoveryCommand toolCallCommand mcpServerCommand allowedMcpServers blockedMcpServers mcpEnabled extensionsEnabled projectHooks disabledHooks interactive onApproval onOAuthPrompt editorCallbacks toolSchedulerFactory settings; do
  grep -q "$f" packages/agents/src/api/config-types.ts || { echo "MISSING AgentConfig field $f"; missing=1; }
done
for s in AgentSchedulerFactory AgentSchedulerHandle toolSchedulerFactory; do
  grep -q "$s" packages/agents/src/api/config-types.ts || { echo "MISSING scheduler factory contract $s"; missing=1; }
done
for f in folderTrust embeddingModel debugMode continueOnFailedApiCall allowedTools coreTools toolDiscoveryCommand toolCallCommand mcpServerCommand allowedMcpServers blockedMcpServers mcpEnabled extensionsEnabled compressionThreshold projectHooks disabledHooks; do
  grep -q "$f" packages/agents/src/api/config-classification.ts || { echo "MISSING classification for $f"; missing=1; }
done
grep -q "settings-escape-hatch" packages/agents/src/api/config-classification.ts || { echo "MISSING settings classification"; missing=1; }
npm run typecheck
grep -rnE ": any\b|as [A-Z]" packages/agents/src/api/config-types.ts packages/agents/src/api/config-schema.ts && { echo "FAIL: any/assertion"; missing=1; } || true
exit $missing
```

### Deferred Implementation Detection

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX)" packages/agents/src/api/config-types.ts packages/agents/src/api/config-schema.ts | grep -v ".spec.ts"
# Expected: none
```

### Semantic Verification Checklist

- [ ] AgentConfig typed fields match the §4.2 classification (no CLI-needed field
      left only in `settings`)
- [ ] `toolSchedulerFactory?: AgentSchedulerFactory` and `AgentSchedulerHandle` are present, with ownership documented as factory caller-owned / created scheduler instances Agent-owned
- [ ] `settings` escape hatch documented UNSTABLE
- [ ] Zod schema parses valid examples + rejects invalid (sanity, no tests yet)
- [ ] `npm run typecheck` clean

## Success Criteria

- config-types.ts + config-schema.ts compile; complete AgentConfig surface.

## Failure Recovery

- `git checkout -- packages/agents/src/api/`; redo with full field coverage.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P03.md`
