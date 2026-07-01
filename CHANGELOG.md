# Changelog

## [Unreleased]

### Removed

- Removed the discontinued Qwen OAuth provider. Qwen discontinued its OAuth free tier on 2026-04-15; the OAuth flow, device-flow implementation, and all OAuth wiring have been removed. Qwen models remain reachable via **API key** through Alibaba Cloud DashScope (OpenAI-compatible endpoint `https://dashscope.aliyuncs.com/compatible-mode/v1`, environment variable `DASHSCOPE_API_KEY`). The `qwen` and `qwenvercel` aliases are now API-key-only. Users should obtain a DashScope API key (or use an OpenRouter API key) instead of `/auth qwen enable`. OAuth providers are now three: Gemini, Anthropic, and Codex.

### Added

- Added **Claude Sonnet 5** (`claude-sonnet-5`) to the model menu: it is now selectable in the profile-create wizard, appears in the Anthropic provider model list (both OAuth and default paths), and resolves correct max output tokens (128K), context window (200K subscription default; 1M is API-only/plan-gated), and token limits. The "latest" sonnet alias logic now tracks Sonnet 5, and adaptive thinking / `effort` wiring covers it (#2289).
- Async task execution: Launch subagents with `async=true` to run in background (#244)
- `check_async_tasks` tool for model to query async task status
- `/tasks list` command to show all async tasks
- `/task end <id>` command to cancel async tasks
- `task-max-async` setting to limit concurrent async tasks (default: 5)
- Auto-trigger notifications when async tasks complete

### Changed

- The Anthropic provider's default model is now **Claude Opus 4.8** (`claude-opus-4-8`), aligning `getDefaultModel()` with the `anthropic` alias config (`anthropic.config` already declared `claude-opus-4-8` as its `defaultModel`) (#2289).
- `AnthropicProvider.getLatestClaude4Model()` was renamed to `getLatestClaudeModel()` so the helper tracks the newest release of each tier (e.g. Sonnet 5) rather than a single generation. The old name is retained as a deprecated alias delegating to the new method and will be removed in a future release (#2289).

### Migration

- Direct consumers constructing `AuthPrecedenceResolver` and expecting it to resolve named auth keys must pass `providerKeyStorage` in the constructor options or use core's `createAuthPrecedenceResolver()` factory. The CLI profile flow already resolves named keys to concrete provider API keys before provider construction.
- LLxprt Code has moved to the [Bun](https://bun.sh) runtime. Node-compatible install/run UX is preserved — the npm (`npm install -g @vybestack/llxprt-code`), npx, and Homebrew flows are unchanged from the user's perspective. Bun is now required under the covers to power execution. When Bun is not found on `PATH` (and the bundled `node_modules/.bin/bun` dependency is unavailable), the launcher prints an error instructing the user to reinstall dependencies (`npm install`) or install Bun directly from https://bun.sh. TypeScript source (`.ts`) is shipped directly — there is no `dist/` compilation step and no esbuild bundling step. `tsc --noEmit` is used solely for type-checking during development. vitest is retained as the test runner. On Windows, the `node-pty` module has a known terminal resize race condition; under Bun the runtime handles this generically, but users encountering terminal sizing issues should ensure they are on a recent Bun version with a compatible terminal emulator.

### Removed

- Removed `--experimental-ui` flag and `@vybestack/llxprt-ui` (OpenTUI) package. The Ink-based terminal UI is now the sole UI. Development will focus on improving the existing Ink UI.
- Removed `@vybestack/llxprt-ui` from npm publishing pipeline and CI/CD workflows.
- Renamed `oldui-*` scripts and documentation to remove legacy naming (the "old UI" distinction is no longer needed).

## [0.5.3] - 2025-10-28

### Changed

- CLI runtime guard warnings now route through `packages/cli/src/runtime/messages.ts`, so every `MissingProviderRuntimeError` / `ProviderRuntimeNormalizationError` includes remediation steps (activate isolated runtime, register provider infrastructure, rerun profile bootstrap) and requirement markers (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- `ensureStatelessProviderReady()` and related helpers emit strict guard failures instead of silently falling back, aligning CLI behaviour with the stateless enforcement contract (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-003).
- Provider cache toggles and LLXPRT\_\* compatibility flags are removed from the CLI messaging path, reinforcing that providers must instantiate clients per invocation (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-002).

### Documentation

- Added `docs/release-notes/2025-10.md` summarizing the stateless enforcement, CLI guard changes, and migration checklists (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-002 @requirement:REQ-SP4-003 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- Updated `dev-docs/codex-workers.md` and `dev-docs/RULES.md` so coordinators know stateless operations are mandatory, legacy LLXPRT flags are gone, and all edits must flow through runtime-aware helpers (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).

### Migration

- Coordinators should bootstrap every worker via `activateIsolatedRuntimeContext()` / `registerCliProviderInfrastructure()` and drop any reliance on legacy singleton helpers before executing tests or edits (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005).
- CLI users encountering `MissingProviderRuntimeError` should follow the remediation steps embedded in the guard output and review `dev-docs/codex-workers.md` for stateless workflows (@plan:PLAN-20251023-STATELESS-HARDENING.P10 @requirement:REQ-SP4-001 @requirement:REQ-SP4-003).

### Verification

- `rg "PLAN-20251023-STATELESS-HARDENING.P10" docs dev-docs packages/cli/src/runtime`
- `pnpm lint packages/cli`

## [0.5.2] - 2025-10-25

### Changed

- OpenAI provider now instantiates a fresh API client for every call, drops the temporary runtime caches, and retains `clearClientCache()` solely as a compatibility no-op (PLAN-20251023-STATELESS-HARDENING.P09 / REQ-SP4-002).
- OpenAI stateless regression tests now assert that repeated invocations within the same runtime still create new clients, matching the hardened runtime guard expectations.
- ProviderManager documentation references stateless guard enforcement so downstream providers and CLI helpers no longer rely on singleton `getSettingsService()` fallbacks.

### Documentation

- Updated `docs/cli/runtime-helpers.md` with a "Stateless guard behaviour" section describing the CLI runtime registry, normalization guard, and `MissingProviderRuntimeError` escalation path.
- Extended `docs/core/provider-interface.md` with explicit stateless runtime requirements covering per-call instantiation, `options.resolved` usage, and legacy cache-helper handling.

### Verification

- `rg "getSettingsService" packages/core/src/providers` → matches limited to Vitest suites validating guard behaviour; no production providers import the singleton helper.
- `rg "runtimeClientCache" packages/core/src/providers` → (no matches)
- `pnpm lint`

## [0.5.1] - 2025-10-20

### Added

- Runtime-scoped authentication guide and migration article (`docs/migration/stateless-provider-v2.md`) covering PLAN-20251018-STATELESSPROVIDER2 upgrades.
- Q4 2025 release notes outlining provider runtime changes and CLI scope helpers.

### Changed

- Architecture, settings, CLI runtime helper, and provider runtime context documentation now describe scoped auth caches, nested runtime orchestration, and OAuth manager registration.
- `CHANGELOG.md` entry summarises stateless provider v2 deliverables and migration expectations.

### Migration

- Follow the [Stateless Provider v2 migration guide](docs/migration/stateless-provider-v2.md) alongside the earlier [Stateless Provider migration guide](docs/migration/stateless-provider.md) to adopt runtime-scoped auth.

## [0.5.0] - 2025-10-18

### Added

- Stateless provider runtime powered by `ProviderRuntimeContext`, enabling multiple concurrent contexts (CLI + subagents).
- CLI runtime helper documentation and APIs for provider switching, profile management, and diagnostics.
- Migration guide and release notes for PLAN-20250218-STATELESSPROVIDER.

### Changed

- Providers now receive runtime-scoped `SettingsService`, `Config`, and metadata through `GenerateChatOptions`.
- CLI commands route all provider mutations through `runtimeSettings` helpers to preserve context isolation.
- Documentation refreshed across architecture, settings, core, and CLI sections to describe the stateless model.

### Deprecated

- Provider methods `setConfig`, `clearState`, `clearAuth`, and `clearAuthCache` are deprecated and scheduled for removal in the next minor release.
- Legacy helpers that assumed a singleton `SettingsService` now throw when no runtime is registered.

### Migration

1. Create a `ProviderRuntimeContext` during bootstrap and register it with `setActiveProviderRuntimeContext()`.
2. Replace direct calls to `getSettingsService()` with `getCliRuntimeServices()` or the runtime provided in `GenerateChatOptions`.
3. Update subagent or automation workflows to spawn isolated contexts before mutating provider state.
4. Review the [Stateless Provider migration guide](docs/migration/stateless-provider.md) for detailed examples and verification commands.

### Verification

- `npm run lint -- --cache`
- `npm run typecheck`
- `npm run test`
