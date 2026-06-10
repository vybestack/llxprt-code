# Pseudocode: Consumer Migration

Plan ID: PLAN-20260609-ISSUE1591

## C-CM-01: Core Tool Files Migration

For each of 25+ tool files that import `MessageBus`:

```
10: FILE packages/core/src/tools/<toolname>.ts
11: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
12: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
13: IF file imports SerializableConfirmationDetails or other bus types:
14:   OLD: import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';
15:   NEW: import type { SerializableConfirmationDetails } from '@vybestack/llxprt-code-policy';
16: END IF
17: VERIFY file compiles
```

Files affected (partial list):
- `tools/codesearch.ts`, `tools/list-subagents.ts`, `tools/activate-skill.ts`
- `tools/read_line_range.ts`, `tools/write-file.ts`, `tools/tool-registry.ts`
- `tools/google-web-search-invocation.ts`, `tools/read-file.ts`, `tools/apply-patch.ts`
- `tools/exa-web-search.ts`, `tools/direct-web-fetch.ts`, `tools/glob.ts`
- `tools/check-async-tasks.ts`, `tools/ls.ts`, `tools/grep.ts`
- `tools/edit.ts`, `tools/shell.ts`, `tools/ripGrep.ts`, `tools/structural-analysis.ts`
- `tools/tools.ts`, `tools/delete_line_range.ts`, `tools/google-web-fetch.ts`
- `tools/ast-grep.ts`, `tools/read-many-files.ts`, `tools/insert_at_line.ts`
- `tools/memoryTool.ts`, `tools/task.ts`, `tools/google-web-search.ts`

## C-CM-02: Core Scheduler Migration

```
10: FILE packages/core/src/scheduler/types.ts
11: OLD: import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';
12: NEW: import type { SerializableConfirmationDetails } from '@vybestack/llxprt-code-policy';
13: VERIFY ToolCallsUpdateMessage reference (if it imports ToolCall from this file)
14: NOTE: ToolCallsUpdateMessage moves to policy package; scheduler defines its own if needed
```

```
20: FILE packages/core/src/scheduler/confirmation-coordinator.ts
21: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
22: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
23: OLD: import { PolicyDecision } from '../policy/types.js';
24: NEW: import { PolicyDecision } from '@vybestack/llxprt-code-policy';
25: OLD: import { ... } from '../policy/policy-helpers.js';
26: NEW: import { ... } from '../policy/policy-helpers.js'; // stays in core
```

## C-CM-03: Core Config Migration

```
10: FILE packages/core/src/config/config.ts
11: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
12: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
20: FILE packages/core/src/config/configBase.ts
21: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
22: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
30: FILE packages/core/src/config/configBaseCore.ts
31: OLD: import type { PolicyEngine } from '../policy/policy-engine.js';
32: NEW: import type { PolicyEngine } from '@vybestack/llxprt-code-policy';
```

```
40: FILE packages/core/src/config/configConstructor.ts
41: OLD: import { PolicyEngine } from '../policy/policy-engine.js';
42: NEW: import { PolicyEngine } from '@vybestack/llxprt-code-policy';
43: PASS PolicyPathResolver to createPolicyEngineConfig
```

```
50: FILE packages/core/src/config/configTypes.ts
51: OLD: import type { PolicyEngineConfig } from '../policy/types.js';
52: NEW: import type { PolicyEngineConfig } from '@vybestack/llxprt-code-policy';
```

```
60: FILE packages/core/src/config/toolRegistryFactory.ts
61: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
62: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
70: FILE packages/core/src/config/schedulerSingleton.ts
71: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
72: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

## C-CM-04: Core Subagent/Core Migration

```
10: FOR EACH FILE in [coreToolScheduler, subagentRuntimeSetup, subagentToolProcessing,
11:   subagentTypes, subagentExecution, subagent]:
12:   OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
13:   NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
14: END FOR
15: FILE coreToolScheduler.ts also imports SerializableConfirmationDetails:
16:   OLD: import type { SerializableConfirmationDetails } from '../confirmation-bus/types.js';
17:   NEW: import type { SerializableConfirmationDetails } from '@vybestack/llxprt-code-policy';
```

## C-CM-05: Core Agent/Hook Migration

```
10: FILE packages/core/src/agents/executor.ts, invocation.ts
11: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
12: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
20: FILE packages/core/src/hooks/hookEventHandler.ts, hookSystem.ts
21: OLD: import type { MessageBus } from '../confirmation-bus/message-bus.js';
22: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
23: OLD: import { MessageBusType, ... } from '../confirmation-bus/types.js';
24: NEW: import { MessageBusType, ... } from '@vybestack/llxprt-code-policy';
```

## C-CM-06: Core Test Utilities Migration

```
10: FILE packages/core/src/test-utils/tools.ts, config.ts, mock-tool.ts
11: OLD: import { MessageBus } from '../confirmation-bus/message-bus.js';
12: NEW: import { MessageBus } from '@vybestack/llxprt-code-policy';
13: OLD: import { PolicyEngine } from '../policy/policy-engine.js';
14: NEW: import { PolicyEngine } from '@vybestack/llxprt-code-policy';
15: OLD: import { PolicyDecision } from '../policy/types.js';
16: NEW: import { PolicyDecision } from '@vybestack/llxprt-code-policy';
```

## C-CM-07: CLI Migration

```
10: FILE packages/cli/src/config/policy.ts
11: OLD: import { ..., createPolicyEngineConfig as createCorePolicyEngineConfig,
12:   createPolicyUpdater as createCorePolicyUpdater } from '@vybestack/llxprt-code-core';
13: NEW: import type { PolicyEngineConfig, PolicySettings } from '@vybestack/llxprt-code-policy';
14: NEW: import { ApprovalMode, PolicyEngine, MessageBus } from '@vybestack/llxprt-code-policy';
15: KEEP: import { createPolicyEngineConfig, createPolicyUpdater } from '@vybestack/llxprt-code-core';
16: REASON: createPolicyEngineConfig and createPolicyUpdater stay in core (Storage, coreEvents deps)
17: ADD to cli/package.json: @vybestack/llxprt-code-policy: "file:../policy"
```

```
20: FILE packages/cli/src/ui/commands/policiesCommand.ts
21: OLD: import { PolicyDecision } from '@vybestack/llxprt-code-core';
22: NEW: import { PolicyDecision } from '@vybestack/llxprt-code-policy';
```

```
30: FILE packages/cli/src/ui/commands/authCommand.ts
31: OLD: import { MessageBus } from '@vybestack/llxprt-code-core';
32: NEW: import { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
40: FILE packages/cli/src/ui/hooks/useHookDisplayState.ts
41: OLD: import { MessageBusType } from '@vybestack/llxprt-code-core';
42: OLD: import type { MessageBus } from '@vybestack/llxprt-code-core';
43: NEW: import { MessageBusType, type MessageBus } from '@vybestack/llxprt-code-policy';
```

```
50: FILE packages/cli/src/ui/hooks/useReactToolScheduler.ts
51: OLD: import type { MessageBus } from '@vybestack/llxprt-code-core';
52: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
60: FILE packages/cli/src/ui/hooks/geminiStream/*.ts
61: OLD: import type { MessageBus } from '@vybestack/llxprt-code-core';
62: NEW: import type { MessageBus } from '@vybestack/llxprt-code-policy';
```

```
70: UPDATE packages/cli/package.json:
71: ADD " @vybestack/llxprt-code-policy": "file:../policy" to dependencies
```

## C-CM-08: Core Index Re-Export

```
10: FILE packages/core/src/index.ts
11: REMOVE lines:
12:   export * from './policy/index.js';
13:   export { PolicyEngine } from './policy/policy-engine.js';
14:   export { PolicyDecision, ApprovalMode, ... } from './policy/types.js';
15:   export { createPolicyEngineConfig, ... } from './policy/config.js';
16:   export * from './confirmation-bus/types.js';
17:   export * from './confirmation-bus/message-bus.js';
18: ADD lines for policy package re-exports:
19:   export {
20:     PolicyEngine, PolicyDecision, ApprovalMode, PolicyRule,
21:     type PolicyEngineConfig, type PolicySettings,
22:     MessageBus, MessageBusType, MessageBusMessage,
23:     type SerializableConfirmationDetails,
24:     DEFAULT_CORE_POLICIES_DIR, DEFAULT_POLICY_TIER,
25:     USER_POLICY_TIER, ADMIN_POLICY_TIER,
26:     getPolicyDirectories, getPolicyTier, formatPolicyError,
27:     migrateLegacyApprovalMode,
28:     PolicyFunctionCall, PolicyToolCallState,
29:     ConfirmationOutcome,
30:     type ConfirmationPayload,
31:     ... all other exported names
32:   } from '@vybestack/llxprt-code-policy';
33: ADD backward-compat aliases from policy package:
34:   export { ConfirmationOutcome as ToolConfirmationOutcome } from '@vybestack/llxprt-code-policy';
35:   export { type ConfirmationPayload as ToolConfirmationPayload } from '@vybestack/llxprt-code-policy';
36: KEEP lines for core-only orchestration (these do NOT come from policy):
37:   export { createPolicyEngineConfig, createPolicyUpdater, persistPolicyToToml } from './policy/config.js';
38:   export { getPolicyContextFromInvocation, evaluatePolicyDecision, handlePolicyDenial, publishConfirmationRequest } from './policy/policy-helpers.js';
```

## C-CM-09: Tool Confirmation Types Core Shim

```
10: FILE packages/core/src/tools/tool-confirmation-types.ts
11: AFTER ConfirmationOutcome and ConfirmationPayload move to policy package:
12: OPTION A (preferred): File becomes re-export shim:
13:   export { ConfirmationOutcome as ToolConfirmationOutcome } from '@vybestack/llxprt-code-policy';
14:   export { type ConfirmationPayload as ToolConfirmationPayload } from '@vybestack/llxprt-code-policy';
15: OPTION B: File is deleted; all importers updated to use policy package directly
16: IF OPTION A:
17:   UPDATE all core files importing from './tool-confirmation-types.js' to use policy package
18:   OR keep shim temporarily for backward compat within core
19: END IF
```
