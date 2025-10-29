# PlanExec: Provider Runtime Hardening (STATELESS8)

Plan ID: PLAN-20251029-STATELESS8  
Generated: 2025-10-29  
Scope: Eliminate residual Config-based ephemeral reads inside provider adapters and ensure runtime metadata is the single source of truth for stateless execution.

## Current Context

- GeminiChat/SubAgentScope now require fully-injected `AgentRuntimeContext` instances that already contain provider/telemetry/tool adapters plus a frozen `providerRuntime` snapshot.
- Provider call sites still forward the legacy `Config` object via `options.config`; providers use it for both stable CLI state (OK) and ephemeral settings (NOT OK).
- Runtime metadata already contains everything needed: runtimeId, telemetry target, per-call tool counts, settings service, and the snapshot of ephemeral overrides.
- Tests exist for stateless behavior at the agent layer; no provider-level regression harness yet.

## Objectives

1. Providers consume ephemeral settings (streaming, tool overrides, model params, redaction) exclusively from injected runtime metadata, not `options.config`.
2. Telemetry signals emitted by providers rely on runtime metadata/args, keeping Config for static CLI-only data.
3. Ensure `AgentRuntimeContext` exports adapter factories so callers can build provider-specific views without touching Config.
4. Backstop with provider stateless tests proving Config is optional for mutable state.

## Deliverables

- Refactored provider adapters (Gemini, Anthropic, OpenAI, logging wrapper) that accept a `RuntimeInvocationContext` object (new interface) instead of peeking into Config.
- Updated `runtimeAdapters.ts` (or new provider-specific adapter modules) to map Config snapshots to the new context shape at construction time.
- Provider unit tests in `packages/core/src/providers/**/` asserting ephemerals come from runtime metadata.
- Integration updates ensuring `options.config` is only referenced for static CLI info; plan notes capturing removal steps for the final Config dependency.

## Work Breakdown

### Phase P01 – Inventory & Guard Rails
- [ ] Grep providers for `options.config` usage; classify each call as STATIC vs EPHEMERAL.
- [ ] Draft `ProviderInvocationContext` interface capturing runtime metadata + settings.
- [ ] Add regression tests that throw if providers access `options.config.getEphemeral*`.

### Phase P02 – Adapter Refactor (per provider)
- [ ] GeminiProvider: consume streaming/model overrides from invocation context; ensure telemetry enrichment uses runtime metadata.
- [ ] OpenAIProvider: reroute model params, base URL, and user memory reads through the new context.
- [ ] AnthropicProvider: switch to runtime context for `anthropic` overrides and prompt construction.
- [ ] LoggingProviderWrapper & ProviderManager guard tests: update to pass/expect the new context type.

### Phase P03 – Runtime Context Wiring
- [ ] Extend `createAgentRuntimeContext` (or new helper) to build provider invocation metadata, including ephemerals.
- [ ] Update `GeminiChat`/`SubAgentScope` to pass the enriched context to provider calls (they already call `buildProviderRuntime`; just add the extra fields).
- [ ] Ensure foreground/subagent tests create deterministic context objects for providers.

### Phase P04 – Hardening
- [ ] Add provider-focused stateless tests that mock Config to throw on `getEphemeral*` while invoking providers through the new context.
- [ ] Run full `npm run build` and integration suites; capture artifacts under `.completed/PLAN-20251029-STATELESS8/`.
- [ ] Document any remaining static Config reads (CLI path, sandbox) and confirm they are acceptable.

## Dependencies & Risks

- Need agreement on `ProviderInvocationContext` fields; include at least `runtimeId`, `settingsService`, `telemetry`, `ephemerals`, `metadata`.
- Provider tests currently assume Config availability; will need refactoring across multiple files.
- Potential regression in CLI provider features if Config-only paths existed; mitigate with targeted integration checks.

## Exit Criteria

- All providers pass stateless tests without using Config for mutable data.
- `options.config` is optional (or omitted) for ephemeral access; lint/grep confirms no `getEphemeral*` usage remains in providers.
- Build/typecheck/test suites are green; plan artifacts recorded.
