# Dependency Audit: Policy Package Extraction

Plan ID: PLAN-20260609-ISSUE1591

## Source Code Inventory

### Policy Module (`packages/core/src/policy/`)
| File | Lines (actual) | Role | External Dependencies |
|------|----------------|------|-----------------------|
| `types.ts` | 91 | Type definitions | None |
| `policy-engine.ts` | 357 | Rule evaluation engine | `utils/shell-utils` (SHELL_TOOL_NAMES, splitCommands, hasRedirection) |
| `stable-stringify.ts` | 188 | Deterministic JSON | None |
| `utils.ts` | 77 | Regex/pattern utilities | None |
| `toml-loader.ts` | 662 | TOML parsing/validation | `@iarna/toml`, `zod` |
| `config.ts` | 647 | Config creation, policy updater | `config/storage`, `config/config`, `utils/shell-utils`, `utils/events`, `utils/debugLogger`, `confirmation-bus/*`, `@iarna/toml` |
| `policy-helpers.ts` | 117 | Policy evaluation helpers | `@google/genai`, `tools/tools`, `scheduler/types`, `core/turn`, `core/index`, `confirmation-bus/*`, `utils/generateContentResponseUtilities` |
| `policies/*.toml` | ~varies | Default policy files | None |
| `index.ts` | 7 | Barrel exports | None |

### Confirmation-Bus Module (`packages/core/src/confirmation-bus/`)
| File | Lines (actual) | Role | External Dependencies |
|------|----------------|------|-----------------------|
| `types.ts` | 160 | Message types, enums | `@google/genai` (FunctionCall), `tools/tool-confirmation-types` (ToolConfirmationOutcome/Payload), `scheduler/types` (ToolCall) |
| `message-bus.ts` | 283 | Pub/sub implementation | `@google/genai` (FunctionCall), `policy/policy-engine` (PolicyEngine), `policy/types` (PolicyDecision), `tools/tool-confirmation-types` (ToolConfirmationOutcome/Payload), `utils/debugLogger` |
| `index.ts` | 2 | Barrel exports | None |

### Related Files That Must Move
| File | Location | Destination |
|------|----------|-------------|
| `tool-confirmation-types.ts` | `core/src/tools/` | `packages/policy/src/confirmation-types.ts` |

## Production Import Analysis

### Policy → Core Subsystem Imports (non-test)
```
config.ts:9    → path (node built-in)
config.ts:10   → fileURLToPath (node:url built-in)
config.ts:11   → fs (node:fs/promises built-in)
config.ts:12   → toml (@iarna/toml)
config.ts:13   → config/storage (Storage class)
config.ts:21   → config/config (ApprovalModeEnum — identical to policy/types.ts ApprovalMode)
config.ts:22   → policy/policy-engine (PolicyEngine type)
config.ts:23   → policy/types (PolicyDecision, PolicyRule, PolicyEngineConfig, PolicySettings, ApprovalMode)
config.ts:28   → policy/utils (buildArgsPatterns)
config.ts:29   → utils/shell-utils (SHELL_TOOL_NAMES)
config.ts:30   → confirmation-bus/types (MessageBusType, UpdatePolicy)
config.ts:34   → confirmation-bus/message-bus (MessageBus type)
config.ts:35   → utils/events (coreEvents)
config.ts:36   → utils/debugLogger (debugLogger)
config.ts:14-20: toml-loader types (TomlRule, PolicyFileError, PolicyLoadResult, loadPoliciesFromToml)
policy-engine.ts:1   → policy/types (PolicyDecision, PolicyEngineConfig, PolicyRule)
policy-engine.ts:6   → policy/stable-stringify (stableStringify)
policy-engine.ts:7   → utils/shell-utils (SHELL_TOOL_NAMES, splitCommands, hasRedirection)
policy-helpers.ts:7   → crypto (node:crypto built-in)
policy-helpers.ts:8   → @google/genai (FunctionCall type)
policy-helpers.ts:9   → tools/tools (AnyToolInvocation type)
policy-helpers.ts:10  → tools/tools (BaseToolInvocation class)
policy-helpers.ts:11  → scheduler/types (ToolCallRequestInfo, ToolCallResponseInfo)
policy-helpers.ts:15  → scheduler/types (PolicyContext type)
policy-helpers.ts:16  → policy/types (PolicyDecision type)
policy-helpers.ts:17  → policy/policy-engine (PolicyEngine type)
policy-helpers.ts:18  → confirmation-bus/message-bus (MessageBus type)
policy-helpers.ts:19  → confirmation-bus/types (MessageBusType)
policy-helpers.ts:20  → core/index (ToolErrorType)
policy-helpers.ts:21  → utils/generateContentResponseUtilities (createErrorResponse)
```

### Confirmation-Bus → Core Subsystem Imports (non-test)
```
types.ts:1   → @google/genai (FunctionCall type)
types.ts:2   → tools/tool-confirmation-types (ToolConfirmationOutcome, ToolConfirmationPayload types)
types.ts:6   → scheduler/types (ToolCall type — union of 7 subtypes)
message-bus.ts:1   → node:events (EventEmitter)
message-bus.ts:2   → node:crypto (randomUUID)
message-bus.ts:3   → @google/genai (FunctionCall type)
message-bus.ts:4   → policy/policy-engine (PolicyEngine class)
message-bus.ts:5   → policy/types (PolicyDecision enum)
message-bus.ts:6   → tools/tool-confirmation-types (ToolConfirmationOutcome, ToolConfirmationPayload — types used in message interfaces)
message-bus.ts:12  → confirmation-bus/types (MessageBusType, UpdatePolicy, SerializableConfirmationDetails, ToolCallsUpdateMessage, message interfaces)
message-bus.ts:16  → utils/debugLogger (debugLogger)
```

### Core → Policy/Confirmation-Bus Imports (non-test)
**58 confirmation-bus import sites** in core production code (58 import lines across 50 unique files):
- 27 tool files: `MessageBus` type import (tools.ts also imports MessageBusType)
- 7 subagent/core files: `MessageBus` type import (coreToolScheduler, nonInteractiveToolExecutor, subagent, subagentExecution, subagentRuntimeSetup, subagentToolProcessing, subagentTypes)
- 4 config files: `MessageBus` type import (config.ts, configBase.ts, schedulerSingleton.ts, toolRegistryFactory.ts)
- 3 scheduler files: `MessageBus`, `SerializableConfirmationDetails` (confirmation-coordinator.ts imports both, types.ts imports SerializableConfirmationDetails)
- 4 hooks files: `MessageBus`, bus types (hookBusContracts, hookEventHandler, hookSystem, hookValidators)
- 2 agent files: `MessageBus` type import (executor.ts, invocation.ts)
- 1 core/index.ts: re-exports (2 lines: types + message-bus)
- 2 policy/ internal: config.ts imports MessageBus + MessageBusType, policy-helpers.ts imports MessageBus + MessageBusType
- 3 test-utils files: tools.ts, config.ts, mock-tool.ts import MessageBus

**15 policy import sites** in core production code (15 import lines across 8 unique files):
- `configBaseCore.ts:55`: `PolicyEngine` type
- `configConstructor.ts:44`: `PolicyEngine` class
- `configTypes.ts:30`: `PolicyEngineConfig` type
- `confirmation-coordinator.ts:31`: `PolicyDecision` from types; `:37` policy-helpers
- `confirmation-bus/message-bus.ts:4`: `PolicyEngine` class; `:5` `PolicyDecision`
- `core/index.ts:15-16,23,34`: re-exports from policy/index, policy-engine, types, config
- `test-utils/tools.ts:17-18`: `PolicyEngine`, `PolicyDecision`
- `test-utils/mock-tool.ts:18-19`: `PolicyEngine`, `PolicyDecision`

### CLI → Policy/Confirmation-Bus Imports (via core re-exports)
- `cli/src/config/policy.ts`: `PolicyEngineConfig`, `ApprovalMode`, `PolicyEngine`, `MessageBus`, `PolicySettings`, `createPolicyEngineConfig`, `createPolicyUpdater`
- `cli/src/config/intermediateConfig.ts`: `createPolicyEngineConfig` (local)
- `cli/src/ui/commands/policiesCommand.ts`: `PolicyDecision`
- `cli/src/ui/commands/authCommand.ts`: `MessageBus`
- `cli/src/ui/hooks/useHookDisplayState.ts`: `MessageBusType`, `MessageBus`
- `cli/src/ui/hooks/useReactToolScheduler.ts`: `MessageBus` type
- `cli/src/ui/hooks/geminiStream/*.ts`: `MessageBus` type

## Hard Blockers for Full Extraction

### Blocker 1: policy-helpers tool/scheduler dependencies
`policy-helpers.ts` imports `AnyToolInvocation`, `BaseToolInvocation`, `ToolCallRequestInfo`, `ToolCallResponseInfo`, `PolicyContext`, `ToolErrorType`. These are core tool/scheduler/runtime types.

**Resolution**: Keep `policy-helpers.ts` in core OR refactor to callback interfaces:
```typescript
// policy package provides:
interface PolicyEvaluationCallbacks {
  getToolPolicyContext: (invocation: unknown, request: unknown) => PolicyContext;
  createDenialResponse: (request: unknown, context: PolicyContext) => { response: unknown; message: string };
}
```
The helpers call these callbacks; core provides implementations.

### Blocker 2: FunctionCall from @google/genai
`confirmation-bus/types.ts` and `message-bus.ts` import `FunctionCall` from `@google/genai`. Policy package must not depend on provider SDK.

**Resolution**: Define `PolicyFunctionCall` interface:
```typescript
interface PolicyFunctionCall {
  name?: string;
  args?: Record<string, unknown>;
}
```
Policy package uses this; core/providers map `FunctionCall` to `PolicyFunctionCall` at the boundary.

### Blocker 3: ToolCall from scheduler/types
`confirmation-bus/types.ts` imports `ToolCall` for `ToolCallsUpdateMessage`.

**Resolution**: Define `PolicyToolCallState` interface in policy package with just the fields `ToolCallsUpdateMessage` needs. Or move `ToolCallsUpdateMessage` out of confirmation-bus types (it's arguably a scheduler concern).

### Blocker 4: ToolConfirmationOutcome/Payload in tools
`confirmation-bus/types.ts` and `message-bus.ts` import `ToolConfirmationOutcome` and `ToolConfirmationPayload` from `core/tools/tool-confirmation-types.ts`.

**Resolution**: Move `ToolConfirmationOutcome` and `ToolConfirmationPayload` to the policy package. Update core/tools to import from policy package. These types are confirmation primitives, not tool implementation concerns.

### Blocker 5: Storage/config dependencies in createPolicyEngineConfig
`config.ts` uses `Storage.getUserPoliciesDir()`, `Storage.getSystemPoliciesDir()`, and `ApprovalMode` enum from `config/config.ts`.

**Resolution**: 
- `ApprovalMode` enum already exists in `policy/types.ts`. The `config/config.ts` version is a legacy re-export. Policy package uses its own.
- Storage paths are injected via callback: `(tier: string) => string[]` or a `PolicyPathResolver` interface.

## Package Dependency Direction (Final)

```
packages/policy  →  @iarna/toml, zod ONLY (zero core/provider/cli deps)
packages/policy  ⊥  @vybestack/llxprt-code-core (FORBIDDEN)
packages/policy  ⊥  @vybestack/llxprt-code-telemetry (FORBIDDEN)
packages/policy  ⊥  @google/genai (FORBIDDEN — PolicyFunctionCall replaces)
packages/policy  ⊥  providers, cli, tools (concrete tool implementations)
packages/cli     →  @vybestack/llxprt-code-policy
packages/cli     →  @vybestack/llxprt-code-core
packages/core    →  @vybestack/llxprt-code-policy (re-exports + production imports)
```

| Package | May Depend On | Must Not Depend On |
|---------|--------------|--------------------|
| `packages/policy` | `@iarna/toml`, `zod` ONLY | `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-telemetry`, `@google/genai`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-cli` |
| `packages/core` | `@vybestack/llxprt-code-policy` | (none restricted) |
| `packages/cli` | `@vybestack/llxprt-code-policy`, `@vybestack/llxprt-code-core` | (none restricted) |

## npm Package Dependencies

### packages/policy/package.json dependencies
```json
{
  "@iarna/toml": "^2.2.5",
  "zod": "^3.25.76"
}
```

### packages/policy/package.json devDependencies
```json
{
  "@types/node": "^24.2.1",
  "fast-check": "^4.2.0",
  "typescript": "^5.3.3",
  "vitest": "^3.1.1"
}
```

Note: `@google/genai` is NOT a dependency of the policy package (not prod, not dev). `PolicyFunctionCall` replaces it. `@vybestack/llxprt-code-core` is NOT a dependency. All cross-boundary deps injected via `PolicyPathResolver` and `PolicyLogger` interfaces. `@vybestack/llxprt-code-telemetry` is NOT a dependency. Logging injected via `PolicyLogger`.

## P01 Verification Notes (2026-06-10)

Cross-referenced against actual codebase. Key findings:

1. **Tool file count**: Actual 27 non-test tool files importing MessageBus (audit said "25+") — updated
2. **Core/subagent file count**: Actual 7 files in core/ importing MessageBus (audit said "5 subagent files") — updated
3. **Hook file count**: Actual 4 hook files (hookBusContracts, hookEventHandler, hookSystem, hookValidators) — updated
4. **Line counts**: Verified with `wc -l` — toml-loader.ts is 662 lines (audit estimated ~400), config.ts is 647 lines (audit estimated ~450)
5. **migrateLegacyApprovalMode**: Uses `ApprovalModeEnum` from `../config/config.js` which is the same enum as `policy/types.ts` ApprovalMode — safe to move with import swap
6. **persistPolicyToToml**: Local (non-exported) function in config.ts:573, called only by `createPolicyUpdater` — naturally stays in core
7. **ToolCall type**: Confirmed as union type at scheduler/types.ts:117 = ValidatingToolCall | ScheduledToolCall | ExecutingToolCall | SuccessfulToolCall | ErroredToolCall | CancelledToolCall | WaitingToolCall
8. **Total import lines**: 58 confirmation-bus import lines across 50 files, 15 policy import lines across 8 files — all verified
