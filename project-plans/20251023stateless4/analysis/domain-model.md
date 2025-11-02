# Domain Model – Stateless Provider Hardening Phase 4

## Runtime Context Actors
- **CLI Runtime Registry** (`packages/cli/src/runtime/runtimeSettings.ts`): tracks per-runtime `SettingsService`, `Config`, `ProviderManager`, and `OAuthManager`. Creates `ProviderRuntimeContext` for commands/tests.
- **ProviderManager** (`packages/core/src/providers/ProviderManager.ts`): registers providers, wraps with `LoggingProviderWrapper`, and syncs runtime services via `setRuntimeSettingsService`.
- **LoggingProviderWrapper** (`packages/core/src/providers/LoggingProviderWrapper.ts`): injects conversation logging, ensures `GenerateChatOptions` contain `config`, and proxies to underlying provider.
- **BaseProvider** (`packages/core/src/providers/BaseProvider.ts`): owns auth precedence, runtime context storage via `AsyncLocalStorage`, and fallback to singleton settings.
- **Concrete Providers** (`AnthropicProvider`, `OpenAIProvider`, `OpenAIResponsesProvider`, `GeminiProvider`): implement per-call API interactions, currently caching models/params or using constructor-captured config.

## State & Data Flow
1. CLI command/test obtains runtime services from registry → gets `ProviderManager`.
2. `ProviderManager` wraps providers with logging wrapper and calls `setRuntimeSettingsService`.
3. On generation call, `LoggingProviderWrapper.generateChatCompletion` merges incoming options with stored `Config`.
4. `BaseProvider.generateChatCompletion` (via concrete provider) uses `resolveSettingsService()` to determine settings; currently may fallback to `getSettingsService()` singleton.
5. Concrete provider reads/caches model params/auth, storing them on instance for reuse; caches keyed by runtime IDs.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 -->
## Runtime ↔ Provider Interaction Failures
- **Singleton fallback (REQ-SP4-001)**: When `ProviderManager` is constructed without an explicit runtime (e.g., CLI background tasks instantiating `new ProviderManager()` in `packages/cli/src/runtime/runtimeSettings.ts:54-92`), `resolveInit()` (packages/core/src/providers/ProviderManager.ts:75-117) pulls from `getActiveProviderRuntimeContext()`. The subsequent call into `BaseProvider.resolveSettingsService()` (packages/core/src/providers/BaseProvider.ts:96-129) then uses the cached singleton `defaultSettingsService`, leaking credentials between runtimes.
- **Call-scope deficit (REQ-SP4-002)**: `LoggingProviderWrapper` retains constructor `config` (packages/core/src/providers/LoggingProviderWrapper.ts:41-84) and forwards it unchanged, so when an isolated runtime omits `config` in `GenerateChatOptions`, a new completion reuses stale models/base URLs, bypassing the call-scoped normalization expected by providers such as `OpenAIProvider` (packages/core/src/providers/openai/OpenAIProvider.ts:360-418).
- **Provider cache reuse (REQ-SP4-003)**: Concrete providers rely on module-level caches (`runtimeClientCache`, `modelParams`, `currentModel`) declared at top-level (e.g., `OpenAIProvider.ts:49-70`, `AnthropicProvider.ts:28-51`, `GeminiProvider.ts:46-78`). When a runtime without OAuth tokens invokes the provider after an OAuth-enabled session, the cached client carries the prior token and sidesteps new runtime configuration, causing auth mismatches.
- **Runtime instrumentation drift (REQ-SP4-004/REQ-SP4-005)**: `LoggingProviderWrapper` keeps constructor-supplied `config` and omits runtime identifiers when `ProviderManager.updateProviderWrapping()` (packages/core/src/providers/ProviderManager.ts:170-216) reuses the wrapper. During CLI resets via `resetCliProviderInfrastructure` (`packages/cli/src/runtime/runtimeSettings.ts:210-267`), telemetry still emits the old `runtimeId`, breaking isolation audits and hindering REQ-SP4-005 verification.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001 -->
### Failure Call Flow - Missing Settings Service
1. CLI command triggers `ensureRuntimeServices()` (packages/cli/src/runtime/runtimeSettings.ts:112-170) without calling `activateIsolatedRuntimeContext`.
2. `ProviderManager` constructor defers to `resolveInit()` which selects `getActiveProviderRuntimeContext()` because no runtime was passed (ProviderManager.ts:75-117).
3. `BaseProvider.generateChatCompletion()` pulls options from `AsyncLocalStorage`; when empty, `resolveSettingsService()` falls through to `getSettingsService()` (BaseProvider.ts:96-133).
4. Completion succeeds using global credentials, masking isolation gaps and violating REQ-SP4-001 expectations that missing runtime settings should hard fail.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-002 -->
### Failure Call Flow - Stale Config Injection
1. `ProviderManager.updateProviderWrapping()` (ProviderManager.ts:170-216) wraps an existing provider with `LoggingProviderWrapper`, passing current `config`.
2. Later runtime switch updates `config` on the registry (`runtimeSettings.ts:210-267`), but existing wrapper retains the old instance property (`LoggingProviderWrapper` constructor parameter `config` at line 48).
3. `generateChatCompletion()` merges options with stale config, so `OpenAIProvider.createClient()` consumes outdated `baseURL` and `apiKey`, leading to misrouted requests and violating REQ-SP4-002.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-003 -->
### Failure Call Flow - OAuth Token Leakage
1. OAuth-enabled runtime acquires token via `AuthPrecedenceResolver` (BaseProvider.ts:54-93) and caches it within provider-specific state (`GeminiProvider.ts:1371-1450` via `runtimeClientCache` entries).
2. Runtime isolation test resets CLI runtime but reuses the same provider instance from the manager pool (`ProviderManager.providers` map, ProviderManager.ts:33-69).
3. Subsequent CLI invocation without OAuth context retrieves the cached client/token, bypassing `AuthPrecedenceResolver` and failing REQ-SP4-003 expectations for per-call token derivation.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005 -->
### Failure Call Flow - Runtime Instrumentation Drift
1. CLI test harness invokes `resetCliProviderInfrastructure` (packages/cli/src/runtime/runtimeSettings.ts:210-267) expecting a fresh `ProviderManager` and wrapper set.
2. `ProviderManager.updateProviderWrapping()` (packages/core/src/providers/ProviderManager.ts:170-216) retains the previous `LoggingProviderWrapper`, including constructor-captured `config` and cached telemetry metadata.
3. `LoggingProviderWrapper.generateChatCompletion()` (packages/core/src/providers/LoggingProviderWrapper.ts:41-84) logs the stale `runtimeId` and `config`, masking the new runtime context and breaching REQ-SP4-004/REQ-SP4-005 auditing requirements.

## Pain Points
- BaseProvider fallback enables leak from global singleton into runtimes (violates REQ-SP4-001, REQ-SP4-003).
- Provider caches (`runtimeClientCache`, `modelParams`, `currentModel`) persist beyond call; need call-scoped resolution (REQ-SP4-002).
- Logging wrapper/provider manager rely on constructor-config values (`this.config` captured once), leading to stale state when runtime switches (REQ-SP4-004) and preventing runtime reset paths from emitting fresh telemetry (REQ-SP4-005).
- CLI isolation tests rely on runtime registry; changes must preserve `resetCliProviderInfrastructure`, `activateIsolatedRuntimeContext`, etc. (REQ-SP4-005).

## Target State
- `BaseProvider.resolveSettingsService()` throws when neither active call context nor runtime-supplied service is available.
- Concrete providers accept call-normalized options with injected `settings`, `config`, and runtime metadata; they no longer maintain caches beyond `AsyncLocalStorage`.
- Logging wrapper ensures each call passes `options.config` and `options.settings` explicitly to providers and emits per-call runtime metadata for telemetry compliance, satisfying @requirement:REQ-SP4-004 and @requirement:REQ-SP4-005 (requires wrapper/manager adjustments).
- CLI runtime registry automatically injects settings/config during provider invocation; tests confirm isolation with new failure modes.

<!-- @plan:PLAN-20251023-STATELESS-HARDENING.P01 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005 -->
## Risk Matrix
| Risk | Requirement | Impact | Mitigation |
| --- | --- | --- | --- |
| Missing fallback guard triggers CLI command crashes | REQ-SP4-001 | User-perceived outage when runtime setup skipped | Add explicit error path + CLI preflight check for `settings` injection |
| OAuth edge propagation through cached clients | REQ-SP4-002 & REQ-SP4-003 | Tokens leak across runtimes; potential unauthorized access | Purge module-level caches, bind tokens to call scope with `AsyncLocalStorage` |
| CLI runtime registry regressions when resetting providers | REQ-SP4-004 & REQ-SP4-005 | Test harness fails to reinitialize logging + providers, breaking `resetCliProviderInfrastructure` | Provide explicit teardown hook and verify wrapper re-wraps using fresh config |
