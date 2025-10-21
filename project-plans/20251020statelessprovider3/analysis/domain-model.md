# Domain Analysis: Stateless Provider Bootstrap Repairs

## @plan:PLAN-20251020-STATELESSPROVIDER3.P01 Foundations

### Key Actors
- **CLI Bootstrap Flow** (`scripts/start.js`, `loadCliConfig`) – responsible for preparing runtime services before the UI mounts.
- **Runtime Settings Helpers** (`runtimeSettings.ts`) – apply provider/profile state and expose slash command APIs.
- **OAuth Manager** (`oauth-manager.ts`) – clears cached clients when auth state changes.
- **Profile Manager** (`ProfileManager` in core) – loads persisted profiles from disk.

### Current Pain Points
1. `loadCliConfig()` merges profile ephemerals before the provider manager is attached to the config instance, so provider-specific settings like `base-url` fall on the floor.
2. `runtimeSettings.applyProfileSnapshot()` assumes `providerManager.getActiveProvider()` succeeds, which breaks when the provider wasn’t ready.
3. `OAuthManager.clearProviderAuthCaches()` writes `provider.authMode = 'none'` directly on logging-wrapped providers, leading to the `authMode` error.

### Desired Flow
```
parse CLI args → create runtime context → register provider manager
→ load profile (guarded) → apply to runtime → emit warnings if provider missing
```

### Integration Requirements Mapping
- [REQ-SP3-001] touches `scripts/start.js`, `loadCliConfig`.
- [REQ-SP3-002] touches `runtimeSettings.applyProfileSnapshot`, `/profile` command path.
- [REQ-SP3-003] touches `OAuthManager.clearProviderAuthCaches`.
- [REQ-SP3-004] requires integration tests in `packages/cli/src/integration-tests`.

### Risks
- Changing bootstrap ordering could regress default startup; mitigate with integration tests that cover both profile and non-profile launches.
- Guarding provider lookups must not mask legitimate configuration mistakes; ensure warnings surface to the UI.
- Wrapper-aware OAuth clearing must keep conversation logging intact; unwrap only when necessary.
