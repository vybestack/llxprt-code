# Feature Specification: Extract `@vybestack/llxprt-code-policy` Package

Plan ID: PLAN-20260609-ISSUE1591

## Purpose

Extract `packages/core/src/policy` and `packages/core/src/confirmation-bus` into a new standalone workspace package `@vybestack/llxprt-code-policy`. This decomposes the monolithic core package, establishing a clean dependency boundary where policy/confirmation logic has **zero** dependency on core, providers, tools, CLI, or `@google/genai`.

## Architectural Decisions

- **Pattern**: Library package with barrel exports, following existing `packages/telemetry` workspace pattern
- **Technology Stack**: TypeScript strict mode, Vitest for testing, `@iarna/toml` for TOML parsing, `zod` for validation
- **Data Flow**: PolicyEngine evaluates rules → MessageBus publishes decisions → Core consumes via imports
- **Integration Points**: Core re-exports all policy symbols for backward compatibility

## Project Structure

```
packages/policy/
  index.ts                    # Root barrel export
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                  # Public API barrel
    types.ts                  # PolicyDecision, ApprovalMode, PolicyRule, etc.
    policy-engine.ts          # PolicyEngine class
    stable-stringify.ts       # Deterministic JSON serialization
    utils.ts                  # escapeRegex, buildArgsPatterns
    toml-loader.ts            # TOML policy file loading/validation
    config.ts                 # Policy directory/tier constants, migrateLegacyApprovalMode (pure utilities ONLY)
    confirmation-bus/
      index.ts                # Confirmation bus barrel
      types.ts                # MessageBusType, message interfaces, ConfirmationOutcome/Payload, PolicyFunctionCall, PolicyToolCallState
      message-bus.ts          # MessageBus class (with injected PolicyLogger)
    policies/                 # Built-in TOML policy files
      read-only.toml
      write.toml
      discovered.toml
      yolo.toml
    utils/
      shell-utils.ts          # SHELL_TOOL_NAMES, splitCommands, hasRedirection (COPIED)
```

## Technical Environment

- **Type**: Library package (workspace dependency)
- **Runtime**: Node.js 20+
- **Production Dependencies**: `@iarna/toml`, `zod` ONLY
- **Dev Dependencies**: `@types/node`, `fast-check`, `typescript`, `vitest`

## Package Boundary Rules

| Package | May Depend On | Must Not Depend On |
|---------|--------------|--------------------|
| `packages/policy` | `@iarna/toml`, `zod` | `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-cli`, `@google/genai` |
| `packages/core` | `@vybestack/llxprt-code-policy` | (none restricted) |
| `packages/cli` | `@vybestack/llxprt-code-policy`, `@vybestack/llxprt-code-core` | (none restricted) |

**Dependency direction**: `core → policy` (allowed). `policy → core` (forbidden).

## Settings/Config Handling

`packages/settings` does NOT exist. Settings/config orchestration stays in core:
- `createPolicyEngineConfig` stays in `core/src/policy/config.ts`
- `createPolicyUpdater` stays in `core/src/policy/config.ts`
- Policy package defines `PolicyPathResolver` interface; core provides the implementation
- Policy package defines `PolicyLogger` interface; core provides the implementation

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- `packages/core/src/policy/index.ts` — Re-exports from new package
- `packages/core/src/confirmation-bus/index.ts` — Re-exports from new package
- `packages/core/src/policy/policy-helpers.ts` — Imports PolicyEngine, MessageBus from new package
- `packages/core/src/policy/config.ts` — Imports PolicyEngine, types from new package; keeps `createPolicyEngineConfig`/`createPolicyUpdater` orchestration
- `packages/core/src/config/configTypes.ts`, `configBaseCore.ts`, `configConstructor.ts` — Import PolicyEngine/types from new package
- `packages/core/src/scheduler/confirmation-coordinator.ts` — Imports PolicyDecision, policy-helpers
- `packages/core/src/test-utils/` — Imports PolicyEngine, MessageBus
- `packages/core/src/tools/*.ts` — Import MessageBus type
- `packages/core/src/agents/*.ts` — Import MessageBus type
- `packages/core/src/core/*.ts` — Import MessageBus type
- `packages/core/src/hooks/*.ts` — Import MessageBus type
- `packages/cli/src/config/policy.ts` — Uses re-exports from core

### Existing Code To Be Replaced

- `packages/core/src/policy/types.ts` — Replaced by re-export from `@vybestack/llxprt-code-policy`
- `packages/core/src/policy/policy-engine.ts` — Replaced by re-export
- `packages/core/src/policy/stable-stringify.ts` — Replaced by re-export
- `packages/core/src/policy/toml-loader.ts` — Replaced by re-export
- `packages/core/src/policy/utils.ts` — Replaced by re-export
- `packages/core/src/confirmation-bus/types.ts` — Replaced by re-export
- `packages/core/src/confirmation-bus/message-bus.ts` — Replaced by re-export
- `packages/core/src/tools/tool-confirmation-types.ts` — Types moved to policy package; core becomes thin re-export

### User Access Points

- CLI: Via `@vybestack/llxprt-code-core` barrel export (no CLI changes required)
- Programmatic: `import { PolicyEngine, MessageBus } from '@vybestack/llxprt-code-policy'`

### Migration Requirements

- All existing imports via `@vybestack/llxprt-code-core` must continue to work unchanged
- Internal core imports updated to use `@vybestack/llxprt-code-policy` where direct
- TOML policy files moved to new package's `src/policies/` directory
- Test files moved to new package where they only test policy/confirmation-bus code
- Old core files become thin re-export shims or are deleted

## Key Design Decisions

### KDD-1: What stays in core

`policy-helpers.ts` stays in core — it imports `AnyToolInvocation`, `BaseToolInvocation`, `ToolCallRequestInfo`, `ToolCallResponseInfo`, `PolicyContext`, `ToolErrorType`, and `createErrorResponse`, all from core's tools/scheduler systems. Moving it would create circular deps.

`createPolicyEngineConfig` and `createPolicyUpdater` stay in core's `config.ts` — they import `Storage` (core config), `ApprovalMode` (core config), `coreEvents` (core utils), and `debugLogger` (core utils). These orchestrate between policy and core infrastructure.

### KDD-2: Confirmation types migration with policy-owned structural types

`ToolConfirmationOutcome` and `ToolConfirmationPayload` move from `packages/core/src/tools/tool-confirmation-types.ts` to `packages/policy/src/confirmation-bus/types.ts` (renamed to `ConfirmationOutcome`/`ConfirmationPayload`). Core re-exports with original names for backward compat.

`FunctionCall` from `@google/genai` is replaced by `PolicyFunctionCall` interface defined in the policy package — no `@google/genai` dependency.

`ToolCall` from `scheduler/types` is replaced by `PolicyToolCallState` interface — no scheduler dependency.

### KDD-3: Shell utilities

`SHELL_TOOL_NAMES`, `splitCommands`, and `hasRedirection` are **copied** (not moved) from `core/src/utils/shell-utils.ts` to `policy/src/utils/shell-utils.ts`. The original stays in core; only the lightweight functions needed by PolicyEngine are copied.

### KDD-4: Debug logging via injected interface

`MessageBus` receives an optional `PolicyLogger` interface in its constructor instead of importing `debugLogger` from core or telemetry. Default is a no-op logger. Core provides the real implementation at wiring time.

### KDD-5: Generic types for ToolCallsUpdateMessage

`ToolCallsUpdateMessage` in confirmation-bus/types.ts becomes `ToolCallsUpdateMessage<T = unknown>` so the policy package has no scheduler dependency. Core provides the concrete type when re-exporting.

### KDD-6: Settings/config injection

Policy package defines `PolicyPathResolver` interface. Core's `config.ts` provides an implementation backed by `Storage`. This avoids policy importing `Storage` from core.

## Formal Requirements

### REQ-001: Package Creation
[REQ-001.1] Create `packages/policy` directory with package.json, tsconfig.json, vitest.config.ts, index.ts
[REQ-001.2] Register `packages/policy` in root package.json workspaces array
[REQ-001.3] Package name is `@vybestack/llxprt-code-policy`
[REQ-001.4] Package declares dependencies: `@iarna/toml`, `zod` ONLY. NO `@google/genai`, NO `@vybestack/llxprt-code-core`, NO `@vybestack/llxprt-code-telemetry`.
[REQ-001.5] TypeScript compiles with strict mode, composite: false (following telemetry pattern)

### REQ-002: Policy Source Extraction
[REQ-002.1] Move `types.ts` from core/policy → policy/src (no content changes)
[REQ-002.2] Move `policy-engine.ts` from core/policy → policy/src (update imports to relative)
[REQ-002.3] Move `stable-stringify.ts` from core/policy → policy/src (no content changes)
[REQ-002.4] Move `utils.ts` from core/policy → policy/src (no content changes)
[REQ-002.5] Move `toml-loader.ts` from core/policy → policy/src (update imports to relative)
[REQ-002.6] Copy (not move) `policies/*.toml` from core/policy → policy/src/policies/
[REQ-002.7] Copy `SHELL_TOOL_NAMES`, `splitCommands`, `hasRedirection` from core/utils/shell-utils → policy/src/utils/shell-utils.ts

### REQ-003: Confirmation Bus Extraction
[REQ-003.1] Create `policy/src/confirmation-bus/types.ts` with all MessageBusType enum and message interfaces
[REQ-003.2] Move `ConfirmationOutcome` enum (from `ToolConfirmationOutcome`) into policy/src/confirmation-bus/types.ts
[REQ-003.3] Move `ConfirmationPayload` interface (from `ToolConfirmationPayload`) into policy/src/confirmation-bus/types.ts
[REQ-003.4] Define `PolicyFunctionCall` interface replacing `FunctionCall` from `@google/genai`
[REQ-003.5] Define `PolicyToolCallState` interface replacing `ToolCall` from `scheduler/types`
[REQ-003.6] Make `ToolCallsUpdateMessage` generic: `ToolCallsUpdateMessage<T = unknown>`
[REQ-003.7] Move `message-bus.ts` to policy/src/confirmation-bus/ with injected `PolicyLogger` interface
[REQ-003.8] Create confirmation-bus/index.ts barrel export with backward-compatible aliases

### REQ-004: Policy Config Split
[REQ-004.1] Move to policy/src/config.ts: `DEFAULT_CORE_POLICIES_DIR`, `DEFAULT_POLICY_TIER`, `USER_POLICY_TIER`, `ADMIN_POLICY_TIER`, `getPolicyDirectories`, `getPolicyTier`, `formatPolicyError`, `migrateLegacyApprovalMode`, `PolicyConfigSource`
[REQ-004.2] `getPolicyDirectories` receives storage paths as parameters instead of importing `Storage`
[REQ-004.3] `getPolicyTier` receives storage paths as parameters instead of importing `Storage`
[REQ-004.4] Keep `createPolicyEngineConfig`, `createPolicyUpdater`, `persistPolicyToToml` in core's config.ts
[REQ-004.5] `migrateLegacyApprovalMode` uses its own `ApprovalMode` enum (already defined in types.ts)

### REQ-005: Public API
[REQ-005.1] Create `policy/src/index.ts` barrel exporting all public types and classes
[REQ-005.2] PolicyEngine is the primary public entry point
[REQ-005.3] All types re-exported: PolicyDecision, ApprovalMode, PolicyRule, PolicyEngineConfig, PolicySettings, ConfirmationOutcome, ConfirmationPayload, MessageBusType, MessageBusMessage variants
[REQ-005.4] Utility exports: stableStringify, stableParse, escapeRegex, buildArgsPatterns, loadPoliciesFromToml, loadPolicyFromToml, loadDefaultPolicies
[REQ-005.5] Config exports: DEFAULT_CORE_POLICIES_DIR, DEFAULT_POLICY_TIER, USER_POLICY_TIER, ADMIN_POLICY_TIER, getPolicyDirectories, getPolicyTier, formatPolicyError, migrateLegacyApprovalMode, PolicyConfigSource, PolicyPathResolver, PolicyFunctionCall, PolicyToolCallState

### REQ-006: Core Integration
[REQ-006.1] Add `@vybestack/llxprt-code-policy` as dependency in core's package.json
[REQ-006.2] Add path alias in core's tsconfig.json
[REQ-006.3] Core's `policy/index.ts` re-exports from `@vybestack/llxprt-code-policy`
[REQ-006.4] Core's `confirmation-bus/index.ts` re-exports from `@vybestack/llxprt-code-policy`
[REQ-006.5] Core's `tools/tool-confirmation-types.ts` re-exports `ConfirmationOutcome` as `ToolConfirmationOutcome`, `ConfirmationPayload` as `ToolConfirmationPayload`
[REQ-006.6] Update all internal core imports to use `@vybestack/llxprt-code-policy` for policy/confirmation-bus types
[REQ-006.7] Delete old source files from core, replace with thin re-export shims

### REQ-007: Test Migration
[REQ-007.1] Move `policy-engine.test.ts` to policy package (update imports)
[REQ-007.2] Move `shell-safety.test.ts` to policy package (update imports)
[REQ-007.3] Move `toml-loader.test.ts` to policy package (update imports)
[REQ-007.4] Move `utils.test.ts` to policy package (update imports)
[REQ-007.5] Move `message-bus.test.ts` to policy/src/confirmation-bus/ (update imports, use ConfirmationOutcome)
[REQ-007.6] Keep in core: `config.test.ts`, `persistence.test.ts`, `policy-helpers.test.ts`, `policy-updater.test.ts`, `integration.test.ts`
[REQ-007.7] Update kept tests' imports to use `@vybestack/llxprt-code-policy`

### REQ-008: No Circular Dependencies
[REQ-008.1] Policy package MUST NOT depend on `@vybestack/llxprt-code-core`
[REQ-008.2] Policy package MUST NOT depend on `@vybestack/llxprt-code-providers`
[REQ-008.3] Policy package MUST NOT depend on `@vybestack/llxprt-code-tools`
[REQ-008.4] Policy package MUST NOT depend on `@vybestack/llxprt-code-cli`
[REQ-008.5] Policy package MUST NOT depend on `@google/genai`

## Constraints

- Zero breaking changes to any external consumer
- All existing `@vybestack/llxprt-code-core` imports must continue to work
- Package name follows project convention: `@vybestack/llxprt-code-policy`
- No dependency on core, providers, tools, CLI, or `@google/genai`
- No dependency on `@vybestack/llxprt-code-tools`
- TypeScript strict mode
- All tests must pass after migration

## Verification Commands

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```
