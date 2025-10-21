# Changelog

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
