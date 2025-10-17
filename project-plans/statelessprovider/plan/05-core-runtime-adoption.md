# Phase 05: Core Runtime Adoption

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P05`

## Prerequisites

- Required: Phase 04a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P04a" project-plans/statelessprovider/analysis/verification/P04-interface-report.md`
- Expected artifacts: Provider interface adapters and runtime context helpers (P03, P04).

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/BaseProvider.ts`
  - Replace direct singleton reads/writes (`getSettingsService()`) with data sourced from the injected runtime context passed via `generateChatCompletion`.
  - Ensure constructor no longer persists API keys or other values into the global settings instance; callers must seed the desired runtime settings explicitly.
  - Normalize incoming options by validating required settings (model, auth) and keep existing SDK client/OAuth caches on the provider instance for reuse.
- `packages/core/src/providers/{openai,anthropic,gemini,openai-responses}/*.ts`
  - Update implementations to consume the normalized options object (settings/config/extras) and remove any lingering singleton access.
- `packages/core/src/auth/precedence.ts`
  - Allow an injected `SettingsService` reference (threaded through `BaseProvider`) so auth resolution is scoped to the active runtime.
- `packages/core/src/config/config.ts`
  - Replace direct singleton usage with the injected `SettingsService` (leveraging the context helpers from P03).
  - Ensure existing constructor signatures remain valid by defaulting to the current singleton when a service is not passed.
  - Route `getProviderManager`, `setProviderManager`, and ephemeral setting helpers through the new context.
- `packages/core/src/providers/ProviderManager.ts`
  - Accept a `ProviderRuntimeContext` (or the discrete `Config` + `SettingsService`) during construction.
  - Remove internal calls to `getSettingsService()`; use the injected context instead.
  - Maintain current logging/token tracking behaviour.
- `packages/core/src/providers/LoggingProviderWrapper.ts`
  - Ensure provider metrics, token accumulation, and model lookups draw from the injected `Config`/runtime context instead of direct provider getters.
- `packages/core/src/providers/openai/getOpenAIProviderInfo.ts`
  - Introduce context-aware fallbacks so helper calls can read the active model without depending on provider instance state (full migration in P07).
- `packages/cli/src/providers/providerManagerInstance.ts`
  - Refactor to expose a `createProviderManager(context: ProviderRuntimeContext)` factory.
  - Retain a thin compatibility wrapper that calls `createProviderManager` with the default runtime for existing imports.
- `packages/core/src/core/geminiChat.ts`
  - Update orchestration to use the new `generateChatCompletion` options object, passing the runtime context explicitly.
  - Ensure retry/streaming logic remains unchanged.
- `packages/core/src/core/client.ts`
  - Lazily construct `GeminiChat` instances with the injected settings service from config.
  - Provide a migration path for any public APIs that previously relied on the singleton.
- `packages/core/src/core/prompts.ts`
  - Update `getCoreSystemPromptAsync` to accept explicit provider/model parameters supplied by the caller (no singleton access).
  - Adjust callers touched above to pass the required information.
- `packages/core/src/index.ts`
  - Export newly introduced factories/types so CLI and external consumers can adopt them.

### Files to Create / Update Tests

- `packages/core/src/core/__tests__/geminiChat.runtime.test.ts`
  - Add coverage ensuring the orchestrator passes the runtime context and still handles retries/tools correctly.
- `packages/core/src/providers/__tests__/providerManager.context.test.ts`
  - Verify manager construction with explicit contexts and legacy wrapper.
- Update or add provider-focused tests (e.g., `packages/core/src/providers/BaseProvider.test.ts`, provider-specific suites) to exercise context-driven model/base-url/auth resolution.

### Constraints

- CLI and core must continue to function end-to-end after this phase.
- Do **not** remove provider setters/getters yet; they remain until P09.
- Any compatibility wrappers introduced must be clearly marked for future removal.
- Provider-level OAuth caches/managers may remain shared as today; ensure the refactor only scopes settings/model data, not OAuth state.

### Required Markers

Add plan/requirement/pseudocode annotations to modified sections, e.g.:

```typescript
/**
 * @plan PLAN-20250218-STATELESSPROVIDER.P05
 * @requirement REQ-SP-001
 * @pseudocode provider-invocation.md lines X-Y
 */
```

## Verification Commands

```bash
npm run typecheck
npm test -- --runTestsByPath packages/core/src/core/__tests__/geminiChat.runtime.test.ts packages/core/src/providers/__tests__/providerManager.context.test.ts packages/core/src/providers/BaseProvider.test.ts packages/core/src/providers/integration/multi-provider.integration.test.ts
```

## Manual Verification Checklist

- [ ] Config constructor works with and without an injected `SettingsService`.
- [ ] ProviderManager no longer reads global settings directly.
- [ ] `geminiChat` hands settings/config through the new options object and streaming still succeeds.
- [ ] `getCoreSystemPromptAsync` has no hidden singleton dependency.
- [ ] All callers provide provider/model arguments when requesting the core system prompt.
- [ ] Compatibility wrapper documented for later removal (P09).
- [ ] Credential/base-url precedence respects per-runtime settings without leaking through the singleton helpers.
- [ ] OAuth resolution honours the injected settings service.
- [ ] Provider constructors avoid mutating shared SettingsService state.
- [ ] LoggingProviderWrapper reports metrics/model data without relying on legacy provider getters.
- [ ] Provider instances retain cached clients/auth state, and option normalization validates required inputs before API calls.

## Success Criteria

- Core runtime uses injectable context while preserving functionality.
- Unit/integration tests updated in this phase pass.
- External API surface remains backward compatible.

## Failure Recovery

1. Revert affected files if regressions occur.
2. Reconcile context wiring with pseudocode and retry implementation.
3. Re-run verification commands and update report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P05.md`

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/config/config.ts
- packages/core/src/providers/ProviderManager.ts
- packages/core/src/providers/BaseProvider.ts
- packages/core/src/providers/{openai,anthropic,gemini,openai-responses}/*.ts
- packages/core/src/auth/precedence.ts
- packages/cli/src/providers/providerManagerInstance.ts
- packages/core/src/core/geminiChat.ts
- packages/core/src/core/client.ts
- packages/core/src/core/prompts.ts
- packages/core/src/index.ts
- packages/core/src/core/__tests__/geminiChat.runtime.test.ts
- packages/core/src/providers/__tests__/providerManager.context.test.ts
Verification:
- <paste outputs>
```
