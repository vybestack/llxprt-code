# Pseudocode: Core Integration

## Component: Updating packages/core to use @vybestack/llxprt-code-policy

### Interface Contracts

```typescript
// INPUTS: New @vybestack/llxprt-code-policy package (built in P03-P07)
// OUTPUTS: Core imports updated, backward compatibility maintained
// DEPENDENCIES: packages/core/package.json adds policy dep
```

### Pseudocode

```
# --- Core package.json ---
10: MODIFY packages/core/package.json
11:   ADD dependency: "@vybestack/llxprt-code-policy": "file:../policy"
12:   ADD to exports map (for deep imports):
13:     "./policy/types.js": "./dist/src/policy/types.js" → stays (re-export)
14:     "./confirmation-bus/message-bus.js": "./dist/src/confirmation-bus/message-bus.js" → stays

# --- Core tsconfig.json ---
20: MODIFY packages/core/tsconfig.json
21:   ADD path alias: "@vybestack/llxprt-code-policy": ["../policy/index.ts"]
22:   ADD path alias: "@vybestack/llxprt-code-policy/*": ["../policy/src/*"]

# --- Core vitest.config.ts ---
30: MODIFY packages/core/vitest.config.ts
31:   ADD to workspaceDependencyAliasPlugin:
32:     RESOLVE "@vybestack/llxprt-code-policy" → ../policy/index.ts
33:     RESOLVE "@vybestack/llxprt-code-policy/*" → ../policy/src/*

# --- Core policy/index.ts (RE-EXPORT) ---
40: MODIFY packages/core/src/policy/index.ts
41:   REPLACE direct exports with re-exports from policy package:
42:   EXPORT * from '@vybestack/llxprt-code-policy'
43:   KEEP: export { getPolicyContextFromInvocation, evaluatePolicyDecision,
44:          handlePolicyDenial, publishConfirmationRequest } from './policy-helpers.js'
45:   KEEP policy-helpers.ts in place (it has core deps)

# --- Core policy/config.ts (UPDATE) ---
50: MODIFY packages/core/src/policy/config.ts
51:   CHANGE imports of types, PolicyEngine, etc. to come from '@vybestack/llxprt-code-policy'
52:   REMOVE local imports of moved functions
53:   KEEP: createPolicyEngineConfig, createPolicyUpdater (they orchestrate core deps)
54:   KEEP: persistPolicyToToml, buildConfigSourceRules, buildSettingsRules
55:   KEEP: all addMcp*/addTools* helper functions
56:   UPDATE: import { getPolicyDirectories, getPolicyTier, formatPolicyError,
57:     migrateLegacyApprovalMode, DEFAULT_CORE_POLICIES_DIR, ... }
58:     FROM './config-local.js' or '@vybestack/llxprt-code-policy'
59:   RESOLVE: Storage, coreEvents, debugLogger stay as core imports

# --- Core confirmation-bus/index.ts (RE-EXPORT) ---
60: MODIFY packages/core/src/confirmation-bus/index.ts
61:   EXPORT * from '@vybestack/llxprt-code-policy/confirmation-bus/index.js'
62:   OR EXPORT * from '@vybestack/llxprt-code-policy'

# --- Core tools/tool-confirmation-types.ts (RE-EXPORT) ---
70: MODIFY packages/core/src/tools/tool-confirmation-types.ts
71:   EXPORT { ConfirmationOutcome as ToolConfirmationOutcome } from '@vybestack/llxprt-code-policy'
72:   EXPORT { ConfirmationPayload as ToolConfirmationPayload } from '@vybestack/llxprt-code-policy'
73:   REMOVE local enum/interface definitions

# --- Update internal core imports ---
80: UPDATE packages/core/src/config/configTypes.ts
81:   CHANGE: import type { PolicyEngineConfig } from '../policy/types.js'
82:   TO: import type { PolicyEngineConfig } from '@vybestack/llxprt-code-policy'

83: UPDATE packages/core/src/config/configBaseCore.ts
84:   CHANGE: import type { PolicyEngine } from '../policy/policy-engine.js'
85:   TO: import type { PolicyEngine } from '@vybestack/llxprt-code-policy'

86: UPDATE packages/core/src/config/configConstructor.ts
87:   CHANGE: import { PolicyEngine } from '../policy/policy-engine.js'
88:   TO: import { PolicyEngine } from '@vybestack/llxprt-code-policy'

89: UPDATE packages/core/src/scheduler/confirmation-coordinator.ts
90:   CHANGE: import { PolicyDecision } from '../policy/types.js'
91:   TO: import { PolicyDecision } from '@vybestack/llxprt-code-policy'
92:   CHANGE: import from '../policy/policy-helpers.js' → KEEP (stays in core)
93:   CHANGE: import type from '../confirmation-bus/message-bus.js'
94:   TO: import type from '@vybestack/llxprt-code-policy'
95:   CHANGE: import from '../confirmation-bus/types.js'
96:   TO: import from '@vybestack/llxprt-code-policy'

97: UPDATE packages/core/src/test-utils/tools.ts
98:   CHANGE policy/confirmation imports to @vybestack/llxprt-code-policy

99: UPDATE packages/core/src/test-utils/mock-tool.ts
100:   CHANGE policy imports to @vybestack/llxprt-code-policy

101: UPDATE packages/core/src/test-utils/config.ts
102:   CHANGE confirmation-bus imports to @vybestack/llxprt-code-policy

# --- MessageBus type imports across tools ---
110: UPDATE all packages/core/src/tools/*.ts files:
111:   CHANGE: import type { MessageBus } from '../confirmation-bus/message-bus.js'
112:   TO: import type { MessageBus } from '@vybestack/llxprt-code-policy'
113: AFFECTED FILES: activate-skill, apply-patch, ast-grep, check-async-tasks,
114:   codesearch, delete_line_range, direct-web-fetch, edit, exa-web-search,
115:   glob, google-web-fetch, google-web-search, google-web-search-invocation,
116:   grep, insert_at_line, list-subagents, ls, memoryTool, read_line_range,
117:   read-file, read-many-files, ripGrep, shell, structural-analysis, task,
118:   tool-registry, tools, write-file

# --- Agent/core imports ---
120: UPDATE packages/core/src/agents/executor.ts, invocation.ts
121:   CHANGE MessageBus import to @vybestack/llxprt-code-policy
122: UPDATE packages/core/src/core/coreToolScheduler.ts, subagent.ts,
123:   subagentExecution.ts, subagentRuntimeSetup.ts, subagentToolProcessing.ts,
124:   subagentTypes.ts
125:   CHANGE MessageBus import to @vybestack/llxprt-code-policy
126: UPDATE packages/core/src/config/config.ts, configBase.ts, schedulerSingleton.ts,
127:   toolRegistryFactory.ts
128:   CHANGE MessageBus import to @vybestack/llxprt-code-policy
129: UPDATE packages/core/src/hooks/hookEventHandler.ts, hookSystem.ts
130:   CHANGE MessageBus import to @vybestack/llxprt-code-policy
```

### Integration Points

- Line 41-44: Core's policy/index.ts becomes a thin re-export layer
- Line 70-72: Tool-confirmation-types.ts must preserve exact original names
- Line 110-118: ~25 tool files need MessageBus import updated

### Anti-Pattern Warnings

```
[ERROR] DO NOT: Remove tool-confirmation-types.ts entirely
[OK] DO: Keep it as re-export with original names for backward compat

[ERROR] DO NOT: Change CLI-facing API surface
[OK] DO: Core re-exports everything, CLI sees no changes

[ERROR] DO NOT: Forget to update vitest alias plugin
[OK] DO: Add policy package alias in core's vitest.config.ts
```
