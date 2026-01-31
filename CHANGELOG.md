# Changelog

## [Unreleased]

### Added

- Async task execution: Launch subagents with `async=true` to run in background (#244)
- `check_async_tasks` tool for model to query async task status
- `/tasks list` command to show all async tasks
- `/task end <id>` command to cancel async tasks
- `task-max-async` setting to limit concurrent async tasks (default: 5)
- Auto-trigger notifications when async tasks complete

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
