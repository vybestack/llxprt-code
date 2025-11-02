# Stateless Provider Hardening – Phase 4 Overview

## Context
- Prior stateless-provider passes removed most global singletons, but core providers still retain hidden state through `BaseProvider` fallbacks and per-instance caches.
- `BaseProvider.resolveSettingsService()` silently falls back to the legacy singleton, so any call path that omits `options.settings` can leak into process-wide settings.
- Individual providers (Anthropic, Gemini, OpenAI, OpenAI Responses) keep mutable fields such as `currentModel`, `modelParams`, or `defaultConfig`, leading to cross-runtime bleed and inconsistent behaviour for subagents.

## Problem Statement
- Providers must act as pure functions of the invocation context. Any retained model, auth, or settings state contradicts the stateless architecture needed for concurrent runtimes and subagents.
- Current implementations still:
  - Cache models/params on provider instances (`GeminiProvider`, `OpenAIProvider`).
  - Query settings via singleton fallbacks (`AnthropicProvider`, `OpenAIResponsesProvider`, `BaseProvider` helpers).
  - Access user memory via constructor-captured `Config` instead of the call-scoped config (`AnthropicProvider`, `OpenAIResponsesProvider`).
- These gaps risk configuration leakage between runtimes, especially for automated workers and future subagent orchestration.

## Objectives
1. Eliminate singleton fallbacks inside `BaseProvider` so providers fail fast when invoked without an explicit runtime context.
2. Remove provider-level caches for models and model parameters; hydrate all such data from `NormalizedGenerateChatOptions`.
3. Refactor Anthropic/OpenAI Responses flows to consume user memory, model info, and parameters exclusively through call-scoped options.
4. Ensure logging wrappers and provider manager pass the resolved `Config`/`SettingsService` downstream every time, without relying on stored copies.

## Out of Scope
- OAuth caching behaviour (remains intentionally stateful).
- Broader CLI runtime registry changes already handled in Plan v2/v3.

## Success Criteria
- All providers derive model, base URL, and params solely from the `GenerateChatOptions` payload and immediately-fetched `SettingsService` data.
- Removing the legacy singleton (`getSettingsService()`) fallback does not break tests; instead, callers surface missing-runtime errors.
- Parallel runtimes (CLI + subagent test harness) no longer see cross-talk in provider model, params, or user memory.
