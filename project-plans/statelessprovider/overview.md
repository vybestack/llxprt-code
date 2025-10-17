# Provider Runtime Refactor Overview

This document captures the direction for decoupling provider implementations from global state. It explains the motivation, the target architecture, and the areas that must evolve. The content is intentionally high-level; it gives enough context to design execution plans without prescribing step-by-step work.

## Goals
- Make providers stateless so they do not own mutable settings or configuration.
- Replace the singleton `SettingsService` with per-runtime instances so subagents can carry independent profiles.
- Push the full invocation context into each `generateChatCompletion` call (settings, config, optional prompt additions), keeping OAuth caches as the only provider-local state.
- Preserve provider-specific system prompt handling while letting callers inject additional prompt material (e.g., for `/subagent` flows).

## Current Pain Points
- Providers (`OpenAI`, `Anthropic`, `Gemini`) read and write via `getSettingsService()` which exposes a process-wide singleton.
- Providers expose `setModel`, `setModelParams`, and related mutators that duplicate logic already present in settings management, making it hard to reason about precedence.
- `Config` is also a singleton-style dependency, so every agent/subagent shares user memory, auth hints, and logging toggles.
- `getCoreSystemPromptAsync` reaches back into the singleton settings service to determine the active provider, preventing alternate runtimes.

## Target Providers
- Providers receive everything they need on each invocation:
  ```ts
  async *generateChatCompletion(
    contents: IContent[],
    tools:
      | Array<{
          functionDeclarations: Array<{
            name: string;
            description?: string;
            parametersJsonSchema?: unknown;
          }>;
        }>
      | undefined,
    settings: SettingsService,
    config: Config,
    extras?: {
      additionalPrompt?: string;
      overrides?: { streaming?: boolean; maxTokens?: number; /* future */ };
    },
  ): AsyncIterableIterator<IContent>;
  ```
- `settings` supplies the authoritative model, tool overrides, retry knobs, and any ephemeral settings.
- `config` remains required so providers can access user memory, auth mode, and helper utilities (e.g., Gemini OAuth support).
- `extras.additionalPrompt` reserves the slot for future `/subagent` integrations; it will be unused during the initial refactor.
- Providers still shape prompts differently (Anthropic vs OpenAI vs Gemini), but they do so using the arguments above. They no longer mutate global state or expose setters.
- Runtime helpers such as `BaseProvider.getModel()` are removed; implementations read model/tool overrides straight from the injected `SettingsService`.

## Settings and Config
- `SettingsService` becomes instantiable. Whoever spins up an agent constructs one (optionally seeded from a profile) and keeps the reference. The CLI maintains an “active” runtime via context helpers for backward compatibility, while future subagents pass their own instances directly to the providers they invoke.
- `Config` accepts a `SettingsService` instance in its constructor. Any helper that queries or updates settings does so through the injected reference—no internal creation or fallback to globals.
- Runtime components (CLI, subagents, tests) build their own `SettingsService`/`Config` pairs. Passing different instances automatically isolates state.
- A lightweight runtime-context helper maintains the *active* pair for the core CLI so existing code can keep calling `getSettingsService()`. Subagents will bypass the helper and supply their own pairs directly when invoking providers.
- The CLI entrypoint creates and registers the runtime pair used for the interactive session; future task/subagent runners will create additional pairs and thread them through invocation options without touching global state.

## Prompt Service
- `getCoreSystemPromptAsync` takes explicit inputs (provider name, model, optional additional prompt, user memory) instead of fetching the active provider from settings. Prompt construction remains centralized, but callers are responsible for providing context.
- Providers decide how the core prompt and `additionalPrompt` combine (e.g., Anthropic’s OAuth flow wraps it in `<system>` tags, Gemini supplies `systemInstruction`).

## Callers and Runtime
- `geminiChat` and any other supervisor gather the needed invocation inputs:
  - Resolve the model, tool format, and overrides by reading `settings`.
  - Pull user memory and auth hints from `config`.
  - Optionally compute or transform an `additionalPrompt` string.
  - Call the provider with the assembled arguments.
- `ProviderManager`, `LoggingProviderWrapper`, tests, and utilities stop using provider getters/setters. When they need to report or mutate active models, they go straight to `settings`.
- New provider manager factories take the runtime `Config` (and thus `SettingsService`) as an argument; there is no global `getProviderManager()` instance.

## Authentication
- OAuth caching and client reuse can stay on the provider instances. Those caches depend only on auth tokens and base URLs, not on the values moved into `settings`.
- Providers still receive `OAuthManager` through construction; they simply rely on settings/config at call time for everything else.

## Multi-Agent and Subagent Support
- Subagents create fresh `SettingsService` and `Config` instances (seeded from profiles or parent snapshots) and may reuse provider classes. Because providers are stateless, the same class can serve multiple runtimes concurrently as long as each call supplies the correct settings/config pair.
- Any per-subagent augmentations (custom prompt, tool availability) ride through `additionalPrompt` or by mutating the subagent’s `settings` before invoking providers.

## Areas to Update
- `SettingsService` construction and export strategy.
- `Config` constructor and any helper methods that still fetch the singleton settings service.
- Provider constructors, which no longer need `config` at instantiation time but still accept `OAuthManager` and static options.
- Provider method signatures and the removal of stateful getters/setters.
- Invocation sites (chat engine, tool runners, wrapper layers, tests) so they pass `settings`, `config`, and optional extras explicitly.
- Prompt helper signature to avoid hidden singleton access.
- Provider manager bootstrap code in the CLI so it no longer caches a singleton and instead receives the runtime pair explicitly.

With these structural changes, providers operate purely on the runtime data supplied by the caller. This sets up the codebase for robust subagent support, makes provider behaviour deterministic, and collapses multiple configuration paths into a single source of truth.
