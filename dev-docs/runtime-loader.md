# Agent Runtime Loader

The module `packages/core/src/runtime/AgentRuntimeLoader.ts` builds fully isolated agent runtime bundles that combine the `AgentRuntimeContext`, history service, telemetry/provider adapters, tool registry view, and content generator.

## Responsibilities

- Construct runtime contexts through `loadAgentRuntime(profile, overrides?)` without exposing foreground `Config` state to callers.
- Ensure each invocation receives an isolated `HistoryService` unless a reusable instance is provided.
- Normalize primary agent and subagent bootstrap logic so both routes share the same runtime assembly pipeline.

## Bundle Shape

`loadAgentRuntime` returns an `AgentRuntimeLoaderResult` with the following fields:

- `runtimeContext` – frozen view consumed by `GeminiChat` and `SubAgentScope`
- `history` – isolated `HistoryService` instance
- `providerAdapter` / `telemetryAdapter`
- `toolsView` – filtered read-only registry view
- `contentGenerator`
- `toolRegistry` (optional) – passthrough to support stateless tool execution
- `settingsSnapshot` (optional) – preserved so shims can rebuild ephemeral settings

The additional `toolRegistry` and `settingsSnapshot` references allow subagent flows to enforce tool governance without touching the foreground `Config`.

## Usage

- **Primary agent (`GeminiClient.startChat`)**: passes the active config, runtime state, and history override plus the existing content generator. The loader returns a bundle whose `runtimeContext` is supplied to `GeminiChat`.
- **SubAgentScope**: now requires callers to supply a `runtimeBundle`. The scope consumes the bundle's `runtimeContext`, `toolRegistry`, and optional `settingsSnapshot` to assemble a stateless tool executor. Tests can inject mock adapters using the `overrides` argument to keep foreground `Config` untouched.

## Overrides

The optional `overrides` parameter supports custom adapters (`providerAdapter`, `telemetryAdapter`, `toolsView`), reusable history, a pre-built `contentGenerator`, or a custom `contentGeneratorFactory`. When overrides are supplied, the loader skips the corresponding `Config` access, which keeps regression guards effective in stateless subagent tests.

## Subagent Orchestrator Integration

`SubagentOrchestrator` (see `packages/core/src/core/subagentOrchestrator.ts`) resolves a subagent's config/profile pair, composes a `ContentGeneratorConfig`, and calls `loadAgentRuntime` before launching `SubAgentScope`. The resulting bundle is threaded back into `SubAgentScope.create` via a `runtimeBundle` override so the scope skips the internal loader call. This keeps runtime assembly centralized while allowing the Task tool to manage agent ids and cleanup semantics around the returned history service.

When launching a scope, the orchestrator also supplies an `environmentContextLoader` override that calls `getEnvironmentContext(foregroundConfig)`. This preserves the existing environment prompt formatting while allowing the scope itself to remain stateless.

## Tool Execution Shim

`executeToolCall` now accepts a `ToolExecutionConfig` shim (subset of the `Config` interface). `SubAgentScope` builds this shim from the runtime bundle and the loader's `settingsSnapshot`, ensuring tool governance and telemetry filters stay intact without reaching back into the foreground configuration.
