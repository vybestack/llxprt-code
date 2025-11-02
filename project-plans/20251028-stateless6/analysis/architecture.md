# PLAN-20251028-STATELESS6 – Architecture Analysis

> @plan PLAN-20251028-STATELESS6.P02, PLAN-20251028-STATELESS6.P03

## Background: STATELESS5 Outcomes

> @plan PLAN-20251028-STATELESS6.P02

PLAN-20251027-STATELESS5 successfully established runtime state as the source of truth for foreground agent provider/model/auth data, eliminating 89 Config coupling touchpoints. Key achievements:

- **AgentRuntimeState**: Immutable container (Object.freeze) for provider/model/auth/baseUrl/params metadata
- **Runtime Isolation**: Foreground agent operates on injected runtime state, no shared Config mutation
- **CLI Integration**: Runtime adapter (`agentRuntimeAdapter.ts`) bridges Config to runtime state for foreground flows
- **Test Coverage**: 4592 tests passing with 19 regression guards protecting architectural invariants
- **Production Ready**: All quality gates pass (format, lint, typecheck, build, tests)

### Outstanding Dependencies

Despite STATELESS5 progress, **SubAgentScope and GeminiChat retain Config dependencies** for:

1. **Ephemeral Settings**: Compression thresholds, context limits, preserve thresholds accessed via `config.getEphemeralSetting*()`
2. **Telemetry Logging**: `logApiRequest/Response/Error(this.config, ...)` requires Config instance for metadata extraction
3. **Provider Manager Access**: `config.getProviderManager?.()` used for diagnostics and tool registry lookups
4. **Settings Service Fallback**: `config.getSettingsService()` accessed for feature flags and defaults
5. **Shared State Mutation**: `this.runtimeContext.setModel(...)` in SubAgentScope (~line 609) mutates shared Config, overriding foreground model

These dependencies prevent true runtime isolation between foreground and subagent contexts. **STATELESS6 scope**: Eliminate these touchpoints by introducing `AgentRuntimeContext` wrapper.

## Glossary

> @plan PLAN-20251028-STATELESS6.P02

### AgentRuntimeContext

Immutable wrapper extending `AgentRuntimeState` with additional adapters required by GeminiChat and SubAgentScope. Provides:

- **Runtime State Data**: Provider, model, auth, baseUrl, params (immutable snapshot from AgentRuntimeState)
- **Ephemeral Configuration**: Read-only access to compression/context thresholds without Config dependency
- **Telemetry Target**: Logging sink interface enriched with runtime metadata (runtimeId, provider, model)
- **Provider Adapters**: Diagnostic/tool registry queries without requiring Config instance
- **Immutability Guarantee**: Object.freeze applied to prevent mutation, verifiable via `Object.isFrozen(runtimeContext) === true`

### Ephemerals

Compression and context management settings derived from profile/settings but scoped to runtime instance:

- `compressionEnabled`: Boolean flag
- `compressionThreshold`: Token count triggering compression
- `compressionMinAge`: Minimum age (turns) before compression eligible
- `contextLimit`: Maximum conversation history tokens
- `preserveThreshold`: Token count triggering context preservation
- `toolFormatOverride`: Optional tool output format preference

Accessed via `runtimeContext.getEphemeralSetting(key)` instead of `config.getEphemeralSetting*(key)`.

### TelemetryTarget

Logging abstraction decoupled from Config. Interface methods:

- `logApiRequest(metadata, requestPayload)`
- `logApiResponse(metadata, responsePayload)`
- `logApiError(metadata, error)`

Metadata includes: `{ runtimeId, provider, model, timestamp, correlationId }`. Implementation may delegate to existing telemetry loggers but does not require Config instance.

### Runtime View Adapter

Temporary helper for foreground agent (CLI runtime) until STATELESS7 completes full Config elimination:

```typescript
createRuntimeViewFromConfig(config: Config, runtimeState: AgentRuntimeState): AgentRuntimeContext
```

Bridges existing Config-based foreground flows to new runtime view architecture. **Subagent flows do NOT use this adapter**; they construct AgentRuntimeContext directly from subagent profile.

## Target Scope

- `packages/core/src/core/geminiChat.ts`
- `packages/core/src/core/subagent.ts`
- `packages/core/src/core/subagent.runtimeContext.ts` (implicit via `runtimeContext` utilities)
- Telemetry helpers `packages/core/src/telemetry/loggers.ts`

## Detailed Dependency Analysis (Phase P03)

> @plan PLAN-20251028-STATELESS6.P03
> @requirement REQ-STAT6-001, REQ-STAT6-002

### GeminiChat Config Dependencies (`packages/core/src/core/geminiChat.ts`)

#### 1. Config Storage (Field Declaration)
- **Line 352**: `private readonly config: Config;` - Stored as instance field
- **Line 387**: Constructor accepts `config: Config` parameter
- **Impact**: Full Config object retained throughout lifecycle, enabling all dependency patterns below

#### 2. Provider Manager Access (4 occurrences)
- **Line 561**: `const providerManager = this.config.getProviderManager?.();`
  - Context: `sendMessage()` - Enforce runtime provider switch
  - Purpose: Dynamic provider selection based on `runtimeState.provider`
  - Pattern: Read-only query followed by mutation via `setActiveProvider()`
- **Line 1177**: `const providerManager = this.config.getProviderManager?.();`
  - Context: `makeApiCallAndProcessStream()` - Stream path provider enforcement
  - Purpose: Same as line 561, but in streaming code path
- **Line 1775**: `const providerManager = this.config.getProviderManager?.();`
  - Context: `directCompressionCall()` - Compression API provider enforcement
  - Purpose: Ensure compression uses correct provider
- **Line 2480**: `const providerManager = this.config.getProviderManager();`
  - Context: `getActiveProvider()` - Provider lookup helper
  - Purpose: Retrieve active provider instance for capability checks

#### 3. Settings Service Fallback (4 occurrences)
- **Line 716**: `activeRuntime.settingsService ?? this.config.getSettingsService()`
  - Context: `sendMessage()` - Runtime context construction
  - Purpose: Fallback when provider runtime context lacks settings service
- **Line 1071**: `activeRuntime.settingsService ?? this.config.getSettingsService()`
  - Context: `generateDirectMessage()` - Non-streaming runtime context
- **Line 1279**: `activeRuntime.settingsService ?? this.config.getSettingsService()`
  - Context: `makeApiCallAndProcessStream()` - Streaming runtime context
- **Line 1849**: `activeRuntime.settingsService ?? this.config.getSettingsService()`
  - Context: `directCompressionCall()` - Compression runtime context

#### 4. Ephemeral Settings Access (5 occurrences)
- **Line 1392-1394**: Compression threshold calculation
  ```typescript
  (this.config.getEphemeralSetting('compression-threshold') as number | undefined) ?? COMPRESSION_TOKEN_THRESHOLD
  ```
  - Context: `shouldCompress()` - Determine if history compression needed
  - Setting: `compression-threshold` (fractional multiplier, default 0.6)
- **Line 1396-1398**: Context limit retrieval
  ```typescript
  (this.config.getEphemeralSetting('context-limit') as number | undefined) ?? 60000
  ```
  - Context: `shouldCompress()` - Calculate absolute token threshold
  - Setting: `context-limit` (max tokens, default 60000)
- **Line 1575**: Ephemeral setting capability check
  ```typescript
  if (typeof this.config.getEphemeralSetting === 'function')
  ```
  - Context: `getCompletionBudget()` - Check if config supports ephemerals
- **Line 1578**: Max output tokens retrieval
  ```typescript
  const value = this.asNumber(this.config.getEphemeralSetting(key))
  ```
  - Context: `getCompletionBudget()` - Retrieve `maxOutputTokens` or `max-output-tokens`
  - Settings: `['maxOutputTokens', 'max-output-tokens']` (candidate keys)
- **Line 1700-1702**: Preservation threshold retrieval
  ```typescript
  (this.config.getEphemeralSetting('compression-preserve-threshold') as number | undefined) ?? COMPRESSION_PRESERVE_THRESHOLD
  ```
  - Context: `getCompressionSplit()` - Calculate % of history to preserve (default 0.3 = 30%)

#### 5. Telemetry Integration (6 method calls via 3 private wrappers)
- **Lines 454-457**: `_logApiRequest()` wrapper
  ```typescript
  logApiRequest(this.config, new ApiRequestEvent(model, prompt_id, requestText))
  ```
  - Called from: lines 624, 1025 (sendMessage, generateDirectMessage paths)
  - Data: model, prompt_id, request payload JSON
- **Lines 468-478**: `_logApiResponse()` wrapper
  ```typescript
  logApiResponse(this.config, new ApiResponseEvent(this.runtimeState.model, durationMs, prompt_id, this.runtimeState.authType, usageMetadata, responseText))
  ```
  - Called from: lines 758, 1147 (success paths in sendMessage, generateDirectMessage)
  - Data: model, duration, prompt_id, authType (from runtimeState), usage metadata, response payload
- **Lines 491-501**: `_logApiError()` wrapper
  ```typescript
  logApiError(this.config, new ApiErrorEvent(this.runtimeState.model, errorMessage, durationMs, prompt_id, this.runtimeState.authType, errorType))
  ```
  - Called from: lines 853, 1157 (error handling paths)
  - Data: model, error message/type, duration, prompt_id, authType (from runtimeState)

**Telemetry Observation**: All telemetry calls pass `this.config` as first argument to enable metadata extraction (session ID, profile name, etc.). However, actual model/auth data comes from `this.runtimeState` (STATELESS5 migration already complete).

#### 6. Tool Registry Access (1 occurrence)
- **Line 2282**: `const tools = this.config.getToolRegistry().getAllTools();`
  - Context: `maybeIncludeSchemaDepthContext()` - Error diagnostics for schema depth errors
  - Purpose: Scan all tools for cyclic schema references to provide troubleshooting hints
  - Pattern: Read-only diagnostic query, no tool execution

#### Summary: GeminiChat Config Touchpoints
| Category | Occurrences | Lines | Purpose | Stateless Replacement |
|----------|-------------|-------|---------|----------------------|
| Provider Manager | 4 | 561, 1177, 1775, 2480 | Dynamic provider switching, capability checks | `runtimeContext.providerAdapter.getProvider()` |
| Settings Service | 4 | 716, 1071, 1279, 1849 | Fallback for provider runtime context | `runtimeContext.settingsAdapter` (always present) |
| Ephemeral Settings | 5 | 1392, 1396, 1575, 1578, 1700 | Compression/context thresholds, output budgets | `runtimeContext.getEphemeralSetting(key)` |
| Telemetry | 6 | 454, 468, 491 (wrappers), 624, 758, 853, 1025, 1147, 1157 (call sites) | API request/response/error logging | `runtimeContext.telemetry.log*(metadata, payload)` |
| Tool Registry | 1 | 2282 | Diagnostic error context | `runtimeContext.toolAdapter.getAllToolNames()` (read-only) |

**Total Config Access Points**: 20 unique locations requiring runtime view adapters.

---

### SubAgentScope Config Dependencies (`packages/core/src/core/subagent.ts`)

#### 1. Runtime Context Field (Config Type)
- **Line 255**: `readonly runtimeContext: Config`
  - Constructor parameter type declaration
  - **Critical Issue**: Type is `Config`, enabling full mutation API
  - **Impact**: Entire Config surface area accessible, including `setModel()`, `setProvider()`, etc.

#### 2. Config Mutation (STATELESS6 PRIMARY TARGET)
- **Line 609**: `this.runtimeContext.setModel(this.modelConfig.model);`
  - **Context**: `createChatObject()` - Preparing GeminiChat instance for subagent execution
  - **Pattern**: Direct mutation of shared Config state
  - **Impact**: Overwrites foreground agent's model selection
  - **Concurrency Risk**: If foreground agent runs query while subagent mutates, race condition occurs
  - **Requirement Violation**: REQ-STAT6-003 (isolation & concurrency)

#### 3. Tool Registry Access (2 occurrences)
- **Line 290**: `const toolRegistry = runtimeContext.getToolRegistry();`
  - Context: `SubAgentScope.create()` - Validation that tools don't require user confirmation
  - Purpose: Pre-flight check for non-interactive compatibility
- **Line 355**: `const toolRegistry = this.runtimeContext.getToolRegistry();`
  - Context: `runNonInteractive()` - Load tool function declarations
  - Purpose: Retrieve FunctionDeclaration objects for API calls

#### 4. Session ID Access (3 occurrences)
- **Line 399**: `const promptId = \`${this.runtimeContext.getSessionId()}#${this.subagentId}#${turnCounter++}\`;`
  - Context: `runNonInteractive()` - Generate unique prompt ID for telemetry correlation
- **Line 606**: `this.runtimeContext.getSessionId()`
  - Context: `createChatObject()` - Pass session ID to content generator
- **Line 612**: `this.runtimeContext.getSessionId() || 'subagent-runtime'`
  - Context: `createChatObject()` - Construct runtime ID for AgentRuntimeState

#### 5. Content Generator Config Access (1 occurrence)
- **Line 594**: `const contentGenConfig = this.runtimeContext.getContentGeneratorConfig();`
  - Context: `createChatObject()` - Retrieve API endpoint/auth configuration
  - Purpose: Initialize ContentGenerator for Gemini API calls
  - **Issue**: Returns undefined when using provider-based flows (comment at line 595-600)
  - **Resolution Need**: Subagent must derive config from runtime view, not shared Config

#### 6. Settings Service Usage (Indirect via HistoryService)
- **Not directly visible in subagent.ts**, but:
  - GeminiChat instances created by SubAgentScope inherit Config reference
  - History service token counting may query settings for model-specific tokenizers
  - Telemetry helpers invoked by GeminiChat pass Config through

#### Summary: SubAgentScope Config Touchpoints
| Category | Occurrences | Lines | Purpose | Stateless Replacement |
|----------|-------------|-------|---------|----------------------|
| **Mutation (CRITICAL)** | **1** | **609** | **Set subagent model** | **Construct isolated AgentRuntimeContext with subagent model** |
| Tool Registry | 2 | 290, 355 | Tool validation & loading | `runtimeContext.toolAdapter.getTool(name)` |
| Session ID | 3 | 399, 606, 612 | Telemetry correlation, runtime ID generation | `runtimeContext.sessionId` (immutable field) |
| Content Gen Config | 1 | 594 | API endpoint/auth setup | `runtimeContext.contentGeneratorConfig` (derived from profile) |

**Total Config Access Points**: 7 unique locations, with **1 CRITICAL mutation** requiring immediate remediation.

---

### Telemetry/Tool Logging Dependencies

#### Current API Signatures (packages/core/src/telemetry/loggers.ts)
```typescript
logApiRequest(config: Config, event: ApiRequestEvent): void
logApiResponse(config: Config, event: ApiResponseEvent): void
logApiError(config: Config, event: ApiErrorEvent): void
```

**Config Usage in Telemetry**:
- Extract session ID for correlation: `config.getSessionId()`
- Retrieve profile/settings metadata: `config.getSettingsService()`
- Access telemetry service instance: `config.getTelemetryService?.()`

**Refactoring Need**: Telemetry APIs must accept runtime view metadata instead:
```typescript
interface TelemetryMetadata {
  sessionId: string;
  runtimeId: string;
  provider: string;
  model: string;
  authType: AuthType;
  timestamp: number;
}

logApiRequest(metadata: TelemetryMetadata, payload: string): void
logApiResponse(metadata: TelemetryMetadata, response: ApiResponseEvent): void
logApiError(metadata: TelemetryMetadata, error: ApiErrorEvent): void
```

---

### Supporting Observations

> @plan PLAN-20251028-STATELESS6.P03

1. **AgentRuntimeState Gaps**: Current runtime state (STATELESS5) contains `{ provider, model, authType, baseUrl, authPayload, modelParams }` but lacks:
   - Ephemeral settings (compression thresholds, context limits)
   - Telemetry target interface
   - Tool/provider adapter interfaces
   - Settings service reference

2. **Immutability Verification**: AgentRuntimeState uses `Object.freeze()` (verified in STATELESS5). AgentRuntimeContext must extend this guarantee to adapter interfaces.

3. **Backward Compatibility**: Foreground agent (CLI) currently constructs Config first, then derives runtime state. Adapter pattern required: `createRuntimeViewFromConfig(config, runtimeState)` for Phase P06 transition.

4. **Subagent Isolation**: SubAgentScope must receive **pre-constructed** AgentRuntimeContext with subagent-specific model/provider, not shared Config. Constructor signature change required:
   ```typescript
   // Current (VIOLATES ISOLATION)
   constructor(name: string, runtimeContext: Config, ...)

   // Target (ENFORCES ISOLATION)
   constructor(name: string, runtimeContext: AgentRuntimeContext, ...)
   ```

5. **History Service Coupling**: HistoryService internally may query Config for tokenizer settings. Needs audit in follow-on phase (not STATELESS6 scope, but noted for STATELESS7).

## Required Outcomes

1. Remove shared Config mutation from `SubAgentScope`.
2. Provide injected runtime view containing:
   - Immutable provider/model/auth/modelParams/header data.
   - Ephemeral/compression thresholds & telemetry flags.
   - Provider manager/tool diagnostics adapters.
3. Update telemetry/tool helpers to accept runtime view metadata.
4. Define temporary Config adapter for content generator until follow-on plan migrates foreground paths.

These findings feed directly into Phase P05 pseudocode and subsequent TDD phases.
