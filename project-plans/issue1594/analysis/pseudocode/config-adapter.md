<!-- @plan:PLAN-20260617-COREAPI.P02 @requirement:REQ-002 -->
# Pseudocode: AgentConfig -> ConfigParameters adapter

Plan ID: PLAN-20260617-COREAPI
Phase: P02 (finalized)
Component: `packages/agents/src/api/agentConfig.adapter.ts`
Requirements: REQ-002 (translation + full field classification)

---

## Interface Contracts

```typescript
// INPUTS:
interface AdapterInput { config: AgentConfig }      // already AgentConfigSchema-validated

// OUTPUTS:
type AdapterOutput = ConfigParameters               // core type; consumed by new Config(...)

// DEPENDENCIES:
interface Dependencies {
  CLASSIFICATION: FieldClassificationTable           // the REQ-002 table (typed | sub-surface | settings)
  mapApprovalMode: (m?) => ApprovalMode
  mapMcpServers: (r?) => Record<string, McpServerConfig>
  mapFileFiltering, mapTelemetry, mapCompression, mapCheckpointing, ... : pure mappers
}
```

## Integration Points

```
Line 20: read CLASSIFICATION table - every consumer-relevant ConfigParameters field is here
Line 40: typed fields copied 1:1 (no guessing)
Line 70: sub-surface fields are NOT placed here (handled by control/* at runtime)
Line 80: long-tail merged from config.settings (UNSTABLE)
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT drop a CLI-needed field into settings silently   [OK] type it per CLASSIFICATION
[ERROR] DO NOT invent ConfigParameters fields                   [OK] only map verified fields
[ERROR] DO NOT mutate the input config                          [OK] build a fresh params object
[ERROR] DO NOT JSON-stringify functions (callbacks)             [OK] callbacks are not ConfigParameters
```

## Numbered Pseudocode

```
10: METHOD toConfigParameters(config)
11:   params = {}                                          # fresh, immutable build
12:
20:   # ---- Required identity ----
21:   params.provider = config.provider
22:   params.model = config.model
23:   # NOTE (verified vs configTypes.ts): ConfigParameters has NO `modelParams`
23a:  # field. `modelParams` flows through the runtime-state path
23b:  # (createAgent.md step 111: createAgentRuntimeState({ modelParams })), NOT
23c:  # through ConfigParameters — so it is intentionally NOT placed here.
24:
30:   # ---- Working context / session ----
31:   IF config.workingDir THEN params.cwd = config.workingDir; params.targetDir = config.workingDir
32:   IF config.sessionId THEN params.sessionId = config.sessionId
33:   # systemPrompt maps to ConfigParameters.userMemory (per CLASSIFICATION L65);
33a:  # `systemPrompt` is NOT a ConfigParameters field. memory ALSO targets
33b:  # userMemory; systemPrompt wins when both are present.
33c:  IF config.systemPrompt THEN params.userMemory = config.systemPrompt
33d:  ELSE IF config.memory THEN params.userMemory = config.memory
34:   IF config.includeDirectories THEN params.includeDirectories = clone(config.includeDirectories)
35:
40:   # ---- Tools / MCP ----
41:   IF config.tools THEN params.coreTools = clone(config.tools)
42:   IF config.excludeTools THEN params.excludeTools = clone(config.excludeTools)
43:   IF config.mcpServers THEN params.mcpServers = mapMcpServers(config.mcpServers)
44:
50:   # ---- Approval / policy ----
51:   IF config.approvalMode THEN params.approvalMode = config.approvalMode
52:   # policy maps to ConfigParameters.policyEngineConfig (verified) — NOT `policy`.
52a:  IF config.policy THEN params.policyEngineConfig = config.policy
53:
60:   # ---- Typed first-class fields (REQ-002 classification) ----
61:   FOR EACH field IN CLASSIFICATION.typed
62:     IF config[field] IS defined
63:       params[CLASSIFICATION.target(field)] = mapField(field, config[field])
64:   END FOR
65:   # covers ONLY fields whose target genuinely exists on ConfigParameters
66:   #   (verified configTypes.ts): fileFiltering, telemetry, proxy,
67:   #   maxSessionTurns, compression→chatCompression, checkpointing, sandbox,
68:   #   folderTrust(+trustedFolder), interactive, embeddingModel, debugMode,
69:   #   memory→userMemory, continueOnFailedApiCall, toolOutputLimits→
70:   #   truncateToolOutput{Threshold,Lines}/enableToolOutputTruncation,
71:   #   outputFormat, shell→shellReplacement, contextLimit, compressionThreshold,
72:   #   skills, useWriteTodos, allowedTools, coreTools, allowedMcpServers,
73:   #   blockedMcpServers, mcpEnabled, extensionsEnabled, toolDiscoveryCommand,
74:   #   toolCallCommand, mcpServerCommand, hooks, projectHooks, disabledHooks,
75:   #   ide.mode→ideMode, ide.experimentalZed→experimentalZedIntegration.
76:   # EXCLUDED (no ConfigParameters target — verified): modelParams (runtime
77:   #   state path), streamIdleTimeoutMs (drives runtime idle event, not Config),
78:   #   recording/extensions (agent-sub-surface, handled by facade/control).
72:
80:   # ---- UNSTABLE escape hatch (documented) ----
81:   IF config.settings
82:     FOR EACH (k, v) IN config.settings
83:       IF k IN CLASSIFICATION.typedTargets
84:         THROW AdapterError('field ' + k + ' must be a typed AgentConfig field, not settings')
85:       params[k] = v
86:     END FOR
87:
90:   # ---- callbacks are NOT ConfigParameters (handled by createAgent/facade) ----
91:   # onApproval/onOAuthPrompt/editorCallbacks intentionally not copied here
92:
100:  RETURN freeze(params)
101: END METHOD
```

## Notes for impl phase
- Line 61-71: the CLASSIFICATION table is fixed in the types phase (preflight deliverable).
- Line 83-84: guards against silently shadowing a typed field via `settings`.
