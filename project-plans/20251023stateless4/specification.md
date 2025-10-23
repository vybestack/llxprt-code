# Plan: Stateless Provider Hardening Phase 4

Plan ID: PLAN-20251023-STATELESS-HARDENING
Generated: 2025-10-23
Total Phases: 11
Requirements: REQ-SP4-001, REQ-SP4-002, REQ-SP4-003, REQ-SP4-004, REQ-SP4-005

## Purpose
- Harden provider infrastructure so every invocation is scoped to the supplied runtime context, eliminating singleton fallbacks.
- Remove lingering per-instance caches and constructor-captured state that violate stateless provider guarantees.
- Guarantee logging and provider management layers propagate call-scoped settings/configuration without retaining mutable defaults.
- Validate CLI multi-runtime isolation after changes to ensure concurrent runtimes remain independent.

## Architectural Decisions
- **Pattern**: Enforce stateless provider guards that fail fast when `GenerateChatOptions` omit `settings` or `config`, requiring explicit runtime-scoped services before execution (DR-001, DR-002).
- **Technology Stack**: Leverage Node.js AsyncLocalStorage and `NormalizedGenerateChatOptions` helpers so model parameters, auth tokens, and configuration are resolved per call and discarded immediately after use (DR-002).
- **Data Flow**: Require ProviderManager and LoggingProviderWrapper to request and inject fresh runtime services on every invocation, propagating call-scoped context without constructor caches (DR-003).
- **Integration Points**: Keep the CLI runtime registry as the orchestration layer while extending isolation tests to validate stateless behaviour across concurrent runtimes (DR-004).

## Project Structure

```plaintext
packages/
  core/
    src/
      providers/
        BaseProvider.ts
        ProviderManager.ts
        logging/
          LoggingProviderWrapper.ts
    test/
      providers/
        runtimeIsolation.test.ts
        runtimeSettings.test.ts
  cli/
    src/
      runtime/
        index.ts
        registry/
          RuntimeRegistry.ts
    test/
      runtime/
        multiRuntimeIsolation.test.ts
docs/
  project-plans/20251023stateless4/
    specification.md
    analysis/
      pseudocode/
```

## Technical Environment
- **Type**: CLI Tool + Library surfaces consumed by CLI and service runners.
- **Runtime**: Node.js 20.x (aligns with workspace `engines.node`).
- **Dependencies**: Vitest for testing, AsyncLocalStorage in Node core, existing provider SDK clients (Anthropic, OpenAI, Gemini) as already declared in `packages/core/package.json`.
- **Hosting**: Executed within LLxprt CLI and local development environments; no remote services are introduced by this phase.

## Integration Points

### Existing Code That Will Use This Feature
- `packages/core/src/providers/BaseProvider.ts` – invokes runtime normalization guards before delegating provider calls.
- `packages/core/src/providers/ProviderManager.ts` – injects per-call runtime metadata and ensures wrappers stay stateless.
- `packages/core/src/providers/logging/LoggingProviderWrapper.ts` – consumes normalized options when emitting instrumentation.
- `packages/cli/src/runtime/registry/RuntimeRegistry.ts` – coordinates runtime contexts consumed by providers during CLI sessions.

### Existing Code To Be Replaced/Adjusted
- Provider implementations under `packages/core/src/providers/{anthropic,gemini,openai,openai-responses}/` – remove constructor caches and per-instance defaults.
- `packages/core/src/providers/BaseProvider.ts` helper methods – eliminate fallback usage of `getSettingsService()` and legacy runtime peek utilities.
- `packages/core/src/providers/logging/LoggingProviderWrapper.ts` – drop stored configuration members in favor of per-call data.

### User Access Points
- CLI commands that spin up provider runtimes via `packages/cli/src/runtime` (e.g., `llxprt chat --provider X`).
- Programmatic invocations of `ProviderManager.generateChatCompletion` used by service integrations.

### Migration Requirements
- Remove any references to `peekActiveProviderRuntimeContext` in downstream code before enabling guards.
- Ensure provider-specific tests generate runtime contexts explicitly rather than relying on constructor defaults.
- Update CLI runtime fixtures to supply settings/config objects during initialization.

## Data Schemas
```typescript
// NormalizedGenerateChatOptions (subset relevant to stateless enforcement)
const NormalizedGenerateChatOptionsSchema = z.object({
  settings: z.object({
    getProviderSettings: z.function().returns(z.object({}))
  }),
  config: z.object({
    getEphemeralSettings: z.function().returns(z.object({
      model: z.string(),
      baseURL: z.string().url().optional()
    }))
  }),
  resolved: z.object({
    model: z.string(),
    authToken: z.string(),
    providerKey: z.string()
  }),
  userMemory: z.object({
    getProfile: z.function().returns(z.promise(z.object({})))
  })
});
```

## Example Data
```json
{
  "resolved": {
    "model": "gpt-4.1-mini",
    "authToken": "runtime-token-abc123",
    "providerKey": "openai"
  },
  "settings": {
    "getProviderSettings": "function -> { temperature: 0.2, maxTokens: 1024 }"
  },
  "config": {
    "getEphemeralSettings": "function -> { model: \"gpt-4.1-mini\", baseURL: null }"
  },
  "userMemory": {
    "getProfile": "async function -> Promise.resolve({ tenant: \"acme\" })"
  }
}
```

## Requirements
- **REQ-SP4-001**: BaseProvider must require call-supplied `SettingsService`/runtime context; remove `getSettingsService()` fallback and raise descriptive errors when missing.
- **REQ-SP4-002**: Provider implementations (Anthropic, Gemini, OpenAI, OpenAI Responses) must operate without per-instance caches for models/params/auth; rely on `NormalizedGenerateChatOptions`.
- **REQ-SP4-003**: Providers must consume call-scoped `config` and runtime metadata instead of constructor-captured values, ensuring stateless behaviour across invocations.
- **REQ-SP4-004**: LoggingProviderWrapper and ProviderManager must always pass the active call’s settings/config into wrapped providers, avoiding stored defaults and ensuring wrapper instrumentation remains stateless.
- **REQ-SP4-005**: CLI runtime registry and multi-runtime isolation tests must confirm no regression—parallel runtimes maintain isolated settings/models/profile data after hardening.

## Constraints
- Do not modify production behaviour outside the providers/runtime scope; OAuth caching remains stateful.
- Preserve existing telemetry/logging semantics while restructuring runtime propagation.
- Maintain current public API signatures for providers and runtime helpers.
- Testing must rely on existing toolchain (Vitest) and avoid network calls; use mocks/stubs where necessary.
- Avoid introducing additional long-lived AsyncLocalStorage contexts beyond the per-call scope defined in this plan.

## Performance Requirements
- Per-call runtime normalization must complete within 5ms in local benchmark runs to avoid regressing CLI responsiveness.
- Provider instantiation for each call must reuse underlying HTTP clients when supplied via call options; constructing new clients should add <10% latency versus cached approach.
- Memory usage must remain bounded per invocation with no retained references once the call resolves.

## Success Criteria
- Providers throw explicit errors when invoked without runtime settings/config.
- No provider retains mutable state between calls; caches removed or scoped per-call.
- Logging wrapper instrumentation functions with call-injected context; ProviderManager re-wrap maintains statelessness.
- CLI runtime isolation tests (`runtimeIsolation.test.ts`, `runtimeSettings.test.ts`, profile application tests) pass without modifications besides planned updates.
- Documentation (`PLAN` artifacts) trace implementation to requirements with `@plan:PLAN-20251023-STATELESS-HARDENING.PNN` and `@requirement:REQ-SP4-00X` markers.
