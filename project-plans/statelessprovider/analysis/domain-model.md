# Domain Analysis – Stateless Provider Runtime

<!-- @plan:PLAN-20250218-STATELESSPROVIDER.P01 @requirement:REQ-SP-001 -->

## Runtime Context Entities

- **SettingsServiceInstance**
  - Represents an in-memory, per-agent settings store.
  - Holds provider settings, global settings, ephemeral overrides.
  - Must expose profile import/export without relying on singletons.
- **ConfigInstance**
  - Wraps CLI/runtime configuration and references a specific `SettingsServiceInstance`.
  - Provides user memory, auth mode, file services, and `ProviderManager` access.
  - No longer responsible for creating its own settings service.
- **ProviderManagerRuntime**
  - Created per runtime using injected `ConfigInstance`.
  - Owns provider registrations (OpenAI, Anthropic, Gemini, OpenAIResponses).
  - Must always hand runtime settings/config to providers when invoking `generateChatCompletion`.

## Provider Behaviors

- **Stateless Providers**
  - Each provider call must resolve model/tool settings from the supplied `SettingsServiceInstance`.
  - OAuth caches remain internal; all other mutable state removed.
  - Legacy helpers (`getModel`, provider-specific setters/getters) eliminated so implementations directly query the injected settings instance.
- **Prompt Assembly**
  - Providers request system prompts via `getCoreSystemPromptAsync(providerName, model, userMemory, additionalPrompt?)`.
  - `additionalPrompt` reserved for future subagent context (unused initially).

## CLI Command Interactions

- `/provider`, `/model`, `/profile save`, `/profile load`
  - Mutate `SettingsServiceInstance` and `ConfigInstance` directly.
  - No dependencies on provider setters/getters.
- `--profile-load`
  - Bootstraps runtime by importing profile data into a freshly constructed `SettingsServiceInstance`.
  - Rehydrates model/params/ephemeral settings before providers are invoked.

## Profile Lifecycle

- Profiles remain version 1 JSON files under `~/.llxprt/profiles`.
- Loading:
  - Parse JSON → populate `SettingsServiceInstance` → update `ConfigInstance`.
- Saving:
  - Export from `SettingsServiceInstance` → write to disk.
- No format changes required; ensure compatibility with new runtime wiring.

## Prompt Service

- `getCoreSystemPromptAsync` now requires explicit context parameters:
  - `providerName`, `model`, optional `tools`, optional `additionalPrompt`, `userMemory`.
- Removes dependency on `getSettingsService()` singleton.

## Error & Edge Cases

- Missing profile fields → descriptive errors (existing behavior preserved).
- Providers invoked without configured model → default model resolved via settings/config.
- CLI commands invoked before runtime initialization → guard clauses ensure services exist.

## Integration Touchpoints

- `packages/core/src/core/geminiChat.ts` – orchestrates provider calls with new signature.
- `packages/core/src/core/client.ts` – constructs chat loops with injected runtime pair.
- `packages/cli/src/providers/providerManagerInstance.ts` – becomes factory returning per-runtime manager.
- `packages/core/src/providers/BaseProvider.ts` – loses `getModel`/`getBaseURL` coupling to settings singleton.
