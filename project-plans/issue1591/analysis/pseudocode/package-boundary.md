# Pseudocode: Package Boundary

Plan ID: PLAN-20260609-ISSUE1591

## C-PB-01: Package Scaffold

```
10: CREATE directory packages/policy/
11: CREATE packages/policy/package.json with:
12:   name: "@vybestack/llxprt-code-policy"
13:   version: "0.10.0"
14:   type: "module"
15:   main: "dist/index.js"
16:   types: "dist/index.d.ts"
17:   dependencies:
18:     @iarna/toml: "^2.2.5"
19:     zod: "^3.25.76"
20:   devDependencies:
21:     typescript, vitest, fast-check, @types/node
22:   FORBIDDEN dependencies (NEVER add):
23:     @vybestack/llxprt-code-core — FORBIDDEN (injected interfaces replace)
24:     @vybestack/llxprt-code-telemetry — FORBIDDEN (PolicyLogger injection replaces)
25:     @google/genai — FORBIDDEN (PolicyFunctionCall replaces)
26:     @vybestack/llxprt-code-providers — FORBIDDEN
27:     @vybestack/llxprt-code-cli — FORBIDDEN
23: CREATE packages/policy/tsconfig.json (standalone, composite: false)
24: CREATE packages/policy/vitest.config.ts (no workspace aliases needed — policy has no workspace deps)
25: CREATE packages/policy/index.ts re-exporting src/index.js
26: CREATE packages/policy/src/index.ts as empty barrel
27: ADD "packages/policy" to root package.json workspaces array
28: RUN npm install to update workspace links
```

## C-PB-02: Type Migration

```
10: MOVE packages/core/src/policy/types.ts → packages/policy/src/types.ts
11: MOVE packages/core/src/policy/stable-stringify.ts → packages/policy/src/stable-stringify.ts
12: CREATE packages/policy/src/confirmation-bus/types.ts:
13:   DEFINE ConfirmationOutcome enum (moved from ToolConfirmationOutcome in core/tools/tool-confirmation-types.ts)
14:   DEFINE ConfirmationPayload interface (moved from ToolConfirmationPayload in core/tools/tool-confirmation-types.ts)
15:   DEFINE PolicyFunctionCall interface:
16:     name?: string
17:     args?: Record<string, unknown>
18:   DEFINE PolicyToolCallState interface:
19:     toolName: string
20:     status: string
21:   DEFINE ToolCallsUpdateMessage<T = unknown> (generic, no scheduler dep)
22:   DEFINE PolicyLogger interface (injected by core):
23:     debug(...args: unknown[]): void
24:     error(...args: unknown[]): void
25:   DEFINE PolicyPathResolver interface (injected by core):
26:     getUserPoliciesDir(): string
27:     getSystemPoliciesDir(): string
28: UPDATE packages/policy/src/index.ts to export all types
```

## C-PB-03: Utility Migration

```
10: MOVE packages/core/src/policy/utils.ts → packages/policy/src/utils.ts
11: VERIFY utils.ts has zero external dependencies (pure functions only)
12: COPY packages/core/src/policy/policies/ → packages/policy/src/policies/
13: VERIFY .toml files are data-only (no code dependencies)
```

## C-PB-04: Shell Utils Copy

```
10: COPY from packages/core/src/utils/shell-utils.ts to packages/policy/src/utils/shell-utils.ts
11: KEEP ONLY: SHELL_TOOL_NAMES constant, splitCommands function, hasRedirection function
12: DISCARD: ShellConfiguration, getShellConfiguration, parseShellCommand, etc. (core deps)
13: UPDATE imports: remove all core imports, keep only node built-ins
14: VERIFY: zero imports from @vybestack/llxprt-code-core
```

## C-PB-05: PolicyEngine Migration

```
10: MOVE packages/core/src/policy/policy-engine.ts → packages/policy/src/policy-engine.ts
11: REPLACE import from '../utils/shell-utils.js' with:
12:   import { SHELL_TOOL_NAMES, splitCommands, hasRedirection } from './utils/shell-utils.js' (local copy)
13: REPLACE relative type imports with:
14:   import { PolicyDecision, PolicyEngineConfig, PolicyRule } from './types.js'
15:   import { stableStringify } from './stable-stringify.js'
16: VERIFY no imports to tools, scheduler, providers, cli, core, @google/genai, telemetry
```

## C-PB-06: TOML Loader Migration

```
10: MOVE packages/core/src/policy/toml-loader.ts → packages/policy/src/toml-loader.ts
11: REPLACE relative type imports with:
12:   import { PolicyRule, PolicyDecision, ApprovalMode } from './types.js'
13:   import { escapeRegex, buildArgsPatterns } from './utils.js'
14: VERIFY external deps are @iarna/toml, zod only
15: VERIFY no imports to tools, scheduler, providers, core, @google/genai
```

## C-PB-07: Confirmation-Bus Types Migration

```
10: MOVE packages/core/src/confirmation-bus/types.ts → packages/policy/src/confirmation-bus/types.ts
11: REPLACE import { FunctionCall } from '@google/genai' with:
12:   USE PolicyFunctionCall defined locally in this file
13: REPLACE import { ToolConfirmationOutcome, ToolConfirmationPayload } from '../tools/tool-confirmation-types.js' with:
14:   USE ConfirmationOutcome and ConfirmationPayload defined locally in this file
15: REPLACE import { ToolCall } from '../scheduler/types.js' with:
16:   USE PolicyToolCallState defined locally in this file
17:   UPDATE ToolCallsUpdateMessage to use generic <T = unknown>
18: VERIFY zero imports from @google/genai, tools/, scheduler/, core, telemetry
```

## C-PB-08: MessageBus Migration

```
10: MOVE packages/core/src/confirmation-bus/message-bus.ts → packages/policy/src/confirmation-bus/message-bus.ts
11: REPLACE import { PolicyEngine } from '../policy/policy-engine.js' with:
12:   import { PolicyEngine } from '../policy-engine.js' (same package)
13: REPLACE import { PolicyDecision } from '../policy/types.js' with:
14:   import { PolicyDecision } from '../types.js' (same package)
15: REPLACE import { FunctionCall } from '@google/genai' with:
16:   USE PolicyFunctionCall from ./types.js
17: REPLACE import { ToolConfirmationOutcome, ... } from '../tools/tool-confirmation-types.js' with:
18:   USE ConfirmationOutcome, ConfirmationPayload from ./types.js
19: REPLACE import { debugLogger } from '../utils/debugLogger.js' with:
20:   ACCEPT optional PolicyLogger interface in constructor (default no-op)
21:   constructor(policyEngine, logger?: PolicyLogger)
22:   DEFAULT logger to no-op: { debug: () => {}, error: () => {} }
23: VERIFY zero imports from @google/genai, tools/, scheduler/, core, telemetry
```

## C-PB-09: Config Split (Pure Utilities Move, Orchestration Stays)

```
10: CREATE packages/policy/src/config.ts with pure utilities ONLY:
11:   MOVE constants: DEFAULT_CORE_POLICIES_DIR, DEFAULT_POLICY_TIER, USER_POLICY_TIER, ADMIN_POLICY_TIER
12:   MOVE getPolicyDirectories(userPoliciesDir, adminPoliciesDir) — paths as parameters, NO Storage import
13:   MOVE getPolicyTier(dir, userPoliciesDir, adminPoliciesDir) — paths as parameters, NO Storage import
14:   MOVE formatPolicyError() — pure function
15:   MOVE PolicyConfigSource interface
16:   MOVE migrateLegacyApprovalMode() — uses own ApprovalMode from ./types.js
17:   MOVE normalizeToolName() helper
18:   MOVE AUTO_EDIT_TOOLS constant
19: DO NOT MOVE: createPolicyEngineConfig (Storage, coreEvents deps — stays in core)
20: DO NOT MOVE: createPolicyUpdater (Storage, coreEvents deps — stays in core)
21: DO NOT MOVE: persistPolicyToToml (Storage deps — stays in core)
22: REMOVE from moved code: ALL imports from core (Storage, coreEvents, debugLogger, ApprovalModeEnum)
23: VERIFY: zero imports from @vybestack/llxprt-code-core, @vybestack/llxprt-code-telemetry, @google/genai
```

## C-PB-10: Policy Helpers (Stays in Core)

```
10: DECISION: policy-helpers.ts STAYS in core (hard tool/scheduler deps)
11: UPDATE imports to use @vybestack/llxprt-code-policy for PolicyEngine, PolicyDecision, MessageBus
12: KEEP imports of tools/tools, scheduler/types, core/turn as-is
13: NO changes to logic — only import path updates
```

## C-PB-11: Core Re-Exports

```
10: UPDATE packages/core/src/index.ts:
11:   REMOVE direct policy/confirmation-bus barrel exports
12:   ADD re-export block from @vybestack/llxprt-code-policy:
13:     export { PolicyEngine, PolicyDecision, ... } from '@vybestack/llxprt-code-policy'
14:   KEEP exports of createPolicyEngineConfig, createPolicyUpdater from ./policy/config.js (stay in core)
15:   ADD backward-compat aliases:
16:     export { ConfirmationOutcome as ToolConfirmationOutcome } from '@vybestack/llxprt-code-policy'
17:     export { type ConfirmationPayload as ToolConfirmationPayload } from '@vybestack/llxprt-code-policy'
18: VERIFY all previously exported names are still available from core
```

## C-PB-12: Consumer Migration

```
10: UPDATE packages/core/src/tools/tool-confirmation-types.ts:
11:   RE-EXPORT ConfirmationOutcome as ToolConfirmationOutcome from @vybestack/llxprt-code-policy
12:   RE-EXPORT ConfirmationPayload as ToolConfirmationPayload from @vybestack/llxprt-code-policy
13: UPDATE packages/core/src/scheduler/types.ts:
14:   REPLACE import from '../confirmation-bus/types.js' with:
15:   import type { SerializableConfirmationDetails } from '@vybestack/llxprt-code-policy'
16: FOR EACH tool file (25+ files):
17:   REPLACE import type { MessageBus } from '../confirmation-bus/message-bus.js'
18:   WITH import type { MessageBus } from '@vybestack/llxprt-code-policy'
19: FOR EACH subagent/core/config/hook file:
20:   REPLACE confirmation-bus imports with @vybestack/llxprt-code-policy imports
21: UPDATE packages/cli/src/config/policy.ts:
22:   KEEP imports of createPolicyEngineConfig, createPolicyUpdater from @vybestack/llxprt-code-core (orchestration stays in core)
23:   UPDATE type imports to @vybestack/llxprt-code-policy where appropriate
24: UPDATE packages/cli/package.json:
25:   ADD @vybestack/llxprt-code-policy: "file:../policy"
```

## C-PB-13: Cleanup

```
10: DELETE packages/core/src/policy/types.ts (moved to policy)
11: DELETE packages/core/src/policy/policy-engine.ts (moved to policy)
12: DELETE packages/core/src/policy/stable-stringify.ts (moved to policy)
13: DELETE packages/core/src/policy/utils.ts (moved to policy)
14: DELETE packages/core/src/policy/toml-loader.ts (moved to policy)
15: REPLACE packages/core/src/policy/index.ts with thin re-export shim
16: REPLACE packages/core/src/policy/config.ts — keep only orchestration functions
17: REPLACE packages/core/src/confirmation-bus/index.ts with thin re-export shim
18: DELETE packages/core/src/confirmation-bus/types.ts (moved to policy)
19: DELETE packages/core/src/confirmation-bus/message-bus.ts (moved to policy)
20: REPLACE packages/core/src/tools/tool-confirmation-types.ts with re-export shim
21: RUN full build, test, lint, typecheck
22: RUN smoke test
```
