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

## Current Findings (2025-10-28)

### GeminiChat (`packages/core/src/core/geminiChat.ts`)

- Still relies on `this.config` for:
  - `getProviderManager?.()` – lines 605, 1225, 1823, 2532
  - `getSettingsService()` fallback – lines 763, 1120, 1328, 1898
  - `getEphemeralSetting()` – lines 1415, 1420, 1748, 1935 (compression/context thresholds)
  - Telemetry calls `logApiRequest/Response/Error(this.config, ...)` – lines 514, 538, 672
  - Tool registry lookups for diagnostics – line 2139
- Runtime state (`this.runtimeState`) already supplies provider/model/auth (STATELESS5). Remaining shared-state touchpoints require injected view.

### SubAgentScope (`packages/core/src/core/subagent.ts`)

- Critical mutation: `this.runtimeContext.setModel(this.modelConfig.model);` (line ~609) mutates shared Config, overriding foreground model.
- Constructs content generator via `createContentGenerator(contentGenConfig, this.runtimeContext, ...)`, which expects Config-like object with mutable state.
- Tool execution pathways pull history/telemetry from `runtimeContext`, currently backed by shared Config.
- Constructor currently receives `runtimeContext: Config`; refactor requires new signature accepting `AgentRuntimeContext` (and temporary adapter for legacy helpers).
- Needs strategy for obtaining `contentGeneratorConfig` from subagent profile instead of Config.

### Supporting Observations

- `AgentRuntimeState` lacks model params/headers/ephemeral fields needed for compression/telemetry logic.
- Telemetry logger API requires Config instance; needs adapter to accept runtime view metadata instead.
- Tool registry access in GeminiChat is read-only; view should expose diagnostics info without requiring Config.

## Required Outcomes

1. Remove shared Config mutation from `SubAgentScope`.
2. Provide injected runtime view containing:
   - Immutable provider/model/auth/modelParams/header data.
   - Ephemeral/compression thresholds & telemetry flags.
   - Provider manager/tool diagnostics adapters.
3. Update telemetry/tool helpers to accept runtime view metadata.
4. Define temporary Config adapter for content generator until follow-on plan migrates foreground paths.

These findings feed directly into Phase P05 pseudocode and subsequent TDD phases.
