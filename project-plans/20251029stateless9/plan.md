# PlanExec: Provider Invocation Fail-Fast (STATELESS9)

Plan ID: PLAN-20251029-STATELESS9  
Generated: 2025-10-29  
Scope: Remove all implicit fallbacks from provider invocation plumbing and guarantee that foreground agents and subagents execute against fully isolated runtime state.

## Current Context

- `createRuntimeInvocationContext` still pulls ephemerals from `config.getEphemeralSettings()` or `settings.getAllGlobalSettings()` when callers omit an explicit snapshot. This causes a stateless call to inherit whichever global settings happen to be active.
- `BaseProvider.normalizeGenerateChatOptions` and `ProviderManager.normalizeRuntimeInputs` synthesize invocation contexts without identifying the active provider. They silently reuse foreground config objects and do not fail when required runtime inputs are missing.
- SubAgentScope currently reuses the foreground `Config`, `SettingsService`, and `ProviderManager`. There is no provisioned subagent profile loader yet, so provider calls still see the primary agent’s state.
- LoggingProviderWrapper and provider tests expect a config/runtime to exist; however, the runtime adapter still allows null-ish configs and masks errors instead of fast failing.
- Telemetry/user memory remain global (which is acceptable), but we must ensure their presence is explicit rather than inferred from global config.

## Objectives

1. Eliminate every fallback inside `createRuntimeInvocationContext`; the helper must require provider-scoped ephemerals (or fail) and a non-empty runtime ID.
2. Ensure `ProviderManager` and `BaseProvider` pass provider-aware runtime inputs (explicit provider name, config, settings) and throw immediately when any invocation dependency is missing.
3. Provision a true subagent runtime enclosure: unique `SettingsService`, `Config`, `ProviderManager`, history, and invocation snapshot for each subagent launch.
4. Update runtime adapters and wrapper layers to rely solely on injected context, never on cached globals, while preserving explicitly-passed global telemetry/user memory.
5. Backstop with fail-fast tests that prove foreground and subagent invocations no longer share ephemerals, and that missing inputs abort early.

## Deliverables

- Hardened `RuntimeInvocationContext` module with zero implicit fallbacks and provider-aware ephemerals.
- Updated `ProviderManager` / `BaseProvider` logic that requires explicit config/settings/runtime metadata and propagates provider names into invocation snapshots.
- SubAgentScope bootstrap that constructs dedicated config/settings/provider manager instances (stubbed until full profile loader lands) and passes them into runtime creation.
- Regression tests across providers and subagent flows that throw when legacy global state is accessed, plus new fail-fast assertions in unit and integration suites.
## Work Breakdown (Test-First)

### Phase P01 – Guard Rails Before Code
- [ ] Author regression tests that intentionally fail under current behaviour:
  - Runtime invocation builder rejects missing runtime IDs or ephemerals.
  - ProviderManager/BaseProvider propagate provider-scoped ephemerals and throw when absent.
  - Subagent stateless flows confirm ephemerals/history isolation from the primary agent.
- [ ] Ensure tests cover both unit-level (invocation builder, provider normalization) and integration-level (subagent + provider suites).

### Phase P02 – Runtime Invocation Hardening
- [ ] Refactor `createRuntimeInvocationContext` to:
  - require `runtime.runtimeId` (throw if missing)  
  - accept `providerName` and read ephemerals via `settings.getProviderSettings(providerName)` unless an explicit snapshot is provided  
  - drop all fallbacks to `config.getEphemeralSettings()` and `settings.getAllGlobalSettings()`  
  - treat telemetry/redaction/userMemory as optional pass-through values only.
- [ ] Update call sites to supply provider name or an explicit snapshot; adjust failing tests accordingly.

### Phase P03 – Provider Manager & Base Provider Integration
- [ ] Propagate provider names into `ProviderManager.normalizeRuntimeInputs` and `BaseProvider.normalizeGenerateChatOptions`; invoke the hardened builder.
- [ ] Enforce fast-fail when `options.config` or `options.runtime?.config` is missing.
- [ ] Require invocation construction to fail if provider-specific ephemerals are unavailable.
- [ ] Update LoggingProviderWrapper and dependent layers to assume the presence of the hardened invocation context.

### Phase P04 – Subagent Runtime Isolation
- [ ] Implement isolated subagent runtime wiring: per-subagent `SettingsService`, stub `Config`, dedicated `ProviderManager`, and unique runtime IDs.
- [ ] Ensure invocations executed through subagents only see subagent ephemerals (tests from P01 must now pass).

### Phase P05 – Final Verification
- [ ] Run targeted suites (`vitest run packages/core/src/providers`, `npm run test:integration:sandbox:none`) and archive results under `.completed/PLAN-20251029-STATELESS9/`.

## Dependencies & Risks

- Subagent profile loader is not yet built; interim stub config must be sufficient until the real loader lands (flag this dependency explicitly).
- Some integration tests may rely on global fallbacks; coordination with owners may be needed to update fixtures.
- Provider wrappers in other packages (e.g., CLI) must be audited to ensure they pass the new required parameters.
- Strict fail-fast behaviour may surface latent bugs in downstream code; plan for coordinated rollout.

## Exit Criteria

- `createRuntimeInvocationContext` refuses to construct when runtime ID or provider ephemerals are missing.
- Provider calls in both foreground and subagent cases succeed only when per-call settings/config/runtime metadata are explicitly supplied.
- Subagent stateless tests prove isolation (unique runtime IDs, independent ephemerals, no global settings usage).
- All relevant unit/integration tests pass with the new fail-fast behaviour; results archived under `.completed/PLAN-20251029-STATELESS9/`.
