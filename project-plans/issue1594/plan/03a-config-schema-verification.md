# Phase 03a: AgentConfig Types + Schema Verification

## Phase ID

`PLAN-20260617-COREAPI.P03a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P03" packages/agents/src/api/`

## Verification Commands

```bash
set -e
missing=0
npm run typecheck
for f in provider model modelParams auth tools excludeTools mcpServers approvalMode systemPrompt workingDir sessionId includeDirectories fileFiltering telemetry proxy maxSessionTurns compression checkpointing recording policy extensions ide hooks memory streamIdleTimeoutMs toolOutputLimits outputFormat shell contextLimit compressionThreshold skills useWriteTodos sandbox folderTrust embeddingModel debugMode continueOnFailedApiCall allowedTools coreTools toolDiscoveryCommand toolCallCommand mcpServerCommand allowedMcpServers blockedMcpServers mcpEnabled extensionsEnabled projectHooks disabledHooks interactive onApproval onOAuthPrompt editorCallbacks toolSchedulerFactory settings; do
  grep -q "$f" packages/agents/src/api/config-types.ts || { echo "MISSING $f"; missing=1; }
done
for s in AgentSchedulerFactory AgentSchedulerHandle toolSchedulerFactory; do
  grep -q "$s" packages/agents/src/api/config-types.ts || { echo "MISSING scheduler factory contract $s"; missing=1; }
done
for f in folderTrust embeddingModel debugMode continueOnFailedApiCall allowedTools coreTools toolDiscoveryCommand toolCallCommand mcpServerCommand allowedMcpServers blockedMcpServers mcpEnabled extensionsEnabled compressionThreshold projectHooks disabledHooks; do
  grep -q "$f" packages/agents/src/api/config-classification.ts || { echo "MISSING classification for $f"; missing=1; }
done
grep -q "settings-escape-hatch" packages/agents/src/api/config-classification.ts || { echo "MISSING settings classification"; missing=1; }
grep -rnE ": any\b|as [A-Z][A-Za-z]+" packages/agents/src/api/config-types.ts && { echo "FAIL any/assertion"; missing=1; } || true
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Do the types match `specification.md` §Data Schemas exactly (field names/optionality)?
2. Is the AgentConfig classification honored (every overview.md §4.2 / ConfigParameters field is typed, assigned to a named sub-surface/app-service, or explicitly justified in `settings-escape-hatch`; nothing critical hidden in `settings`)?
3. Does `ProviderAuth` express the verified precedence inputs (raw key, key-name,
   keyfile, base-url, per-provider, profile)?
4. Is the scheduler factory contract explicit (`AgentSchedulerFactory`, `AgentSchedulerHandle`, `toolSchedulerFactory`) with factory caller-owned / created scheduler instances Agent-owned?
5. No `any`, no assertions, explicit return types, readonly where appropriate?

### Holistic Functionality Assessment (completion marker)

- Describe the public AgentConfig surface.
- Confirm it can express every harness T-row's config inputs.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if AgentConfig surface complete, typecheck clean, no `any`/assertions.

## Failure Recovery

- Return to Phase 03 with specific missing-field list.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P03a.md`
