# PLAN-20251028-STATELESS6 – Architecture Analysis (P03)

> @plan PLAN-20251028-STATELESS6.P03

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
- Constructor currently receives `runtimeContext: Config`; refactor requires new signature accepting `GeminiRuntimeView` (and temporary adapter for legacy helpers).
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
