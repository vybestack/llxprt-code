# Feature Specification: Stateless Provider Runtime

## Purpose

Implement a provider runtime architecture where each agent (main CLI session or future subagent) owns its own settings/configuration context. Providers become stateless executors that receive all runtime inputs per call, eliminating implicit singleton dependencies and enabling multiple concurrent runtimes without cross-talk.

## Architectural Decisions

- **Pattern**: Dependency-injected runtime context; providers remain thin adapters over vendor SDKs.
- **Technology Stack**: TypeScript (Node.js 20.x), existing provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`), Vitest for testing.
- **Data Flow**:
  1. CLI bootstrap constructs `SettingsService` instance → registers it as the active runtime context → passes the same instance into `Config`.
     (Future subagents will construct their own `SettingsService`/`Config` pairs and supply them directly when invoking providers—no global registration required.)
  2. `Config` + `SettingsService` handed to `ProviderManager` factory.
  3. `geminiChat` (and future orchestrators) resolve request inputs from `SettingsService`/`Config` and pass them to providers on each `generateChatCompletion` invocation.
  4. Providers construct API requests using the provided runtime context, returning streaming `IContent`.
- **Integration Points**:
  - `SettingsService` creation/injection flow.
  - Provider constructors (OpenAI, Anthropic, Gemini, OpenAIResponses).
  - `BaseProvider` and `IProvider` signatures.
  - CLI commands (`/model`, `/provider`, `/profile`), CLI bootstrap (`gemini.tsx`), and profile manager.
  - Prompt system (`getCoreSystemPromptAsync`).

## Project Structure

```
project-plans/statelessprovider/
  specification.md
  analysis/
    domain-model.md
    pseudocode/
      base-provider.md
      provider-invocation.md
      cli-runtime.md
  plan/
    00-overview.md
    01-analysis.md
    01a-analysis-verification.md
    ...
```

Runtime code changes will modify existing modules in `packages/core/src` and `packages/cli/src`.

## Technical Environment

- **Type**: CLI tool (LLxprt Code)
- **Runtime**: Node.js 20.x
- **Dependencies**: Existing provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`), internal `SettingsService`, `ProviderManager`, Vitest test suite.

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature
- `packages/cli/src/gemini.tsx` – CLI bootstrap must construct the runtime settings/config pair and provider manager without globals.
- `packages/cli/src/ui/commands/{modelCommand,providerCommand,profileCommand}.ts` – Command handlers update settings/config directly instead of provider instance setters.
- `packages/core/src/core/geminiChat.ts` – Prepares per-call provider inputs, passes `SettingsService`/`Config` into `generateChatCompletion`.
- `packages/core/src/core/client.ts` – Maintains the runtime `Config` and forwards the associated `SettingsService`.
- `packages/core/src/providers/*Provider.ts` – Consume runtime context per call instead of accessing global state.
- `packages/core/src/config/profileManager.ts` – Loads/saves profiles using injected `SettingsService`.
- `packages/core/src/core/prompts.ts` – Builds prompts using explicit provider/model inputs.

### Existing Code To Be Replaced
- Singleton `getSettingsService()` usage in providers, `Config`, CLI, and utilities.
- Provider-level setters/getters (`setModel`, `getCurrentModel`, `setModelParams`, etc.).
- Global `getProviderManager()` cache in `packages/cli/src/providers/providerManagerInstance.ts`.
- Prompt helper reliance on settings singleton.

### User Access Points
- `/provider`, `/model`, `/profile save|load` commands.
- CLI flags (`--provider`, `--model`, `--profile-load`, `--key`, `--baseurl`).
- Chat loop interactions via `geminiChat` and `GeminiClient`.

### Migration Requirements
- Profile serialization/deserialization remains version 1 but must map onto the new injected settings flow.
- CLI start-up must migrate from using provider setters to direct settings mutations.
- Tests relying on `getSettingsService()` must be updated to construct their own instances.

## Formal Requirements

- [REQ-SP-001] Providers must receive `SettingsService` and `Config` per invocation and may not read/write the singleton.
  - [REQ-SP-001.1] `generateChatCompletion` signature updated across all providers.
  - [REQ-SP-001.2] Providers remove `setModel`, `getCurrentModel`, `setModelParams`, `setToolFormatOverride`, `getToolFormat`, etc.; callers configure state exclusively through the injected `SettingsService`.
  - [REQ-SP-001.3] `BaseProvider` helper accessors such as `getModel()`/`getModelFromSettings()` are deleted; provider implementations derive model/tool parameters from the `SettingsService` argument supplied to `generateChatCompletion`.
- [REQ-SP-002] `SettingsService` becomes instantiable and is injected into `Config`/runtime components.
  - [REQ-SP-002.1] Provide a runtime-context helper that tracks the active `SettingsService`/`Config` pair so the CLI can preserve its singleton semantics while allowing additional agents to register their own instances.
- [REQ-SP-003] CLI runtime constructs and retains a single `SettingsService`/`Config` pair for the session; no global provider manager instances.
- [REQ-SP-004] `getCoreSystemPromptAsync` accepts explicit provider/model/additionalPrompt arguments; no internal settings lookups.
- [REQ-SP-005] Profile save/load paths (`ProfileManager`, CLI commands, `--profile-load`) operate on injected `SettingsService` data and update settings/config without provider setters.
- [REQ-SP-INT-001] Integration with existing commands and chat loop preserves current user workflows (provider/model switching, profile management).
- [REQ-SP-INT-002] Backward compatibility for profile schema v1 maintained (no breaking format changes).

## Data Schemas

Existing profile schema (version 1) remains:

```typescript
interface Profile {
  version: 1;
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
}
```

No new fields introduced in this phase; additional prompt data will be deferred.

## Example Data

```json
{
  "version": 1,
  "provider": "openai",
  "model": "gpt-5",
  "modelParams": {
    "temperature": 0.7,
    "max_tokens": 2000
  },
  "ephemeralSettings": {
    "base-url": "https://api.openai.com/v1",
    "auth-key": "sk-live-...",
    "streaming": "enabled"
  }
}
```

## Constraints

- Providers must remain compatible with existing OAuth flows and retry handling.
- No new global singletons introduced.
- Tests must be updated to create per-test `SettingsService` instances.
- Backward compatibility: existing profiles load without modification.

## Performance Requirements

- No measurable regression in provider call latency (existing retry logic intact).
- Provider initialization should not create extra SDK clients unnecessarily (reuse caches when auth/baseURL unchanged).
- CLI bootstrap latency should remain comparable after constructing explicit runtime services.
