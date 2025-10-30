# Agent Runtime Loader

The module `packages/core/src/runtime/AgentRuntimeLoader.ts` builds fully isolated agent runtime bundles that combine the `AgentRuntimeContext`, history service, telemetry/provider adapters, tool registry view, and content generator.

## Responsibilities

- Construct runtime contexts through `loadAgentRuntime(profile, overrides?)` without exposing foreground `Config` state to callers.
- Ensure each invocation receives an isolated `HistoryService` unless a reusable instance is provided.
- Normalize primary agent and subagent bootstrap logic so both routes share the same runtime assembly pipeline.

## Usage

- **Primary agent (`GeminiClient.startChat`)**: passes the active config, runtime state, and history override plus the existing content generator. The loader returns a bundle whose `runtimeContext` is supplied to `GeminiChat`.
- **SubAgentScope**: provides subagent-specific runtime state, settings snapshot, and provider/tool overrides. Tests can inject mock adapters using the `overrides` argument to keep foreground `Config` untouched.

## Overrides

The optional `overrides` parameter supports custom adapters (`providerAdapter`, `telemetryAdapter`, `toolsView`), reusable history, a pre-built `contentGenerator`, or a custom `contentGeneratorFactory`. When overrides are supplied, the loader skips the corresponding `Config` access, which keeps regression guards effective in stateless subagent tests.
