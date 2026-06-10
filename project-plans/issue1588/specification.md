# Feature Specification: Extract Settings Package

Plan ID: PLAN-20260608-ISSUE1588
Issue: #1588 - Extract packages/settings
Generated: 2026-06-08

## Purpose

Refactor the settings, profile, and configuration-persistence foundation out of `packages/core` into a dedicated `packages/settings` workspace package. This is an architectural refactoring for the package-extraction sequence that already produced `packages/providers` in issue #1584. The purpose is to make settings a foundation package that core, CLI, providers, and other packages consume without creating a circular dependency.

This plan preserves runtime behavior. It does not add new end-user settings behavior, change profile file formats, or broaden into the CLI god-object decomposition that the issue explicitly treats as a precondition for later work.

## Architectural Decisions

- **Pattern**: package-boundary refactoring with contract-first migration, no compatibility shims, and integration-first verification.
- **Technology Stack**: TypeScript strict mode, Node.js >=20, npm workspaces, existing `scripts/build_package.js`, Vitest.
- **Package Name**: `@vybestack/llxprt-code-settings`, matching existing repository package names (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`). CodeRabbit's `@anthropic/claude-code-settings` examples are incorrect for this repository.
- **Dependency Direction**: `settings` is a foundation package. Allowed production dependencies are `core -> settings`, `providers -> settings`, `cli -> settings`, and `a2a-server -> settings` as needed. `settings -> providers`, `settings -> tools`, and `settings -> cli` are forbidden. `settings -> core` is also forbidden to keep the package cycle-free.
- **Storage Decision**: No `packages/storage` workspace exists today. This issue will move the current `Storage` class into `packages/settings/src/storage/Storage.ts` as an internal storage boundary and document the future extraction seam. The plan MUST NOT add a dependency on a nonexistent package.
- **Profile Type Ownership**: Profile JSON types used by `ProfileManager` move from core-owned `modelParams.ts` into settings-owned profile/model parameter types, or are split so settings owns `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, and related type guards. Core and providers import these types from settings after migration. This prevents `settings -> core`.
- **Settings Singleton Ownership**: `settingsServiceInstance.ts` moves to `packages/settings` as package-owned settings instance management. Core runtime context must stop owning the settings singleton. Runtime context remains in core and registers/activates settings through settings package APIs instead of settings importing core runtime context.
- **Compression Registry Decoupling**: `settingsRegistry.ts` must stop importing `COMPRESSION_STRATEGIES` from core compression. Inline or locally own the compression strategy values in settings and update registry tests accordingly.
- **CLI God Object Scope**: CLI settings schema/runtime settings are not migrated until the god-object decomposition prerequisite exists. This plan must still inventory those files and add explicit future-work gates so implementers do not silently ignore the issue text.
- **No Compatibility Shims**: Existing imports are updated to `@vybestack/llxprt-code-settings`. Core must not retain wrapper files or deep re-export shims for moved settings code. This follows the issue1584 extraction policy and the acceptance criterion that existing imports are updated.

## Project Structure

```text
project-plans/issue1588/
  specification.md
  execution-tracker.md
  analysis/
    dependency-audit.md
    final-architecture.md
    integration-contract.md
    package-metadata-constraints.md
    settings-move-map.md
    consumer-import-matrix.md
    behavioral-regression-matrix.md
    anti-shim-policy.md
    preflight-results-template.md
    phase-verification-matrix.md
    pseudocode/
      package-boundary.md
      settings-service.md
      profile-storage.md
      consumer-migration.md
      verification.md
  plan/
    00-overview.md
    00a-preflight-verification.md
    01-analysis.md
    01a-analysis-verification.md
    02-pseudocode.md
    02a-pseudocode-verification.md
    02b-integration-contract.md
    02c-integration-contract-verification.md
    03-decoupling-stub.md
    03a-decoupling-stub-verification.md
    03b-minimal-adapter-wiring.md
    03b-minimal-adapter-wiring-verification.md
    04-settings-package-tdd.md
    04a-settings-package-tdd-verification.md
    04b-vertical-slice-integration-tdd.md
    04b-vertical-slice-integration-tdd-verification.md
    05-settings-package-impl.md
    05a-settings-package-impl-verification.md
    06-core-integration-stub.md
    06a-core-integration-stub-verification.md
    07-consumer-migration-tdd.md
    07a-consumer-migration-tdd-verification.md
    08-consumer-migration-impl.md
    08a-consumer-migration-impl-verification.md
    09-cleanup-no-shims.md
    09a-cleanup-no-shims-verification.md
    10-full-verification.md
    10a-final-semantic-review.md
```

## Technical Environment

- **Type**: TypeScript monorepo package-boundary refactoring.
- **Runtime**: Node.js >=20.
- **Package Manager**: npm workspaces in project verification commands. Root `package.json` declares `packageManager: pnpm` but all project scripts use `npm` and `package-lock.json` exists. This plan uses `npm` consistently; do not use `pnpm install` which would create lockfile churn.
- **Build**: `node ../../scripts/build_package.js` inside workspace packages.
- **Testing**: Vitest, package-specific scripts, root verification suite.
- **Existing Related Packages**: `core`, `providers`, `cli`, `a2a-server`, `test-utils`, `vscode-ide-companion`, `lsp`.

## Integration Points

### Existing Code That Will Use The Extracted Package

- `packages/core/src/runtime/providerRuntimeContext.ts` - creates runtime contexts with `SettingsService`.
- `packages/core/src/config/configBaseCore.ts` - stores settings service, profile manager, and storage fields.
- `packages/core/src/config/configConstructor.ts` - creates settings service and registers it.
- `packages/core/src/config/configTypes.ts` - exposes config-constructor type shapes that include settings.
- `packages/core/src/index.ts` and `packages/core/index.ts` - currently export settings/profile/storage APIs and must remove moved exports or point consumers to the new package only where allowed by policy.
- `packages/providers/src/**` - production and tests import `SettingsService`, settings registry, and settings service instance APIs from core deep paths today.
- `packages/cli/src/**` - commands, config bootstrap, profile logic, and runtime wiring use settings/profile/storage directly or through core config.
- `packages/a2a-server/src/**` - config storage access must continue to work through core config while settings storage moves.

### Existing Code To Be Replaced Or Removed

- `packages/core/src/types/modelParams.ts`
- `packages/core/src/settings/types.ts`
- `packages/core/src/settings/SettingsService.ts`
- `packages/core/src/settings/settingsRegistry.ts`
- `packages/core/src/settings/settingsServiceInstance.ts`
- `packages/core/src/settings/index.ts`
- `packages/core/src/config/storage.ts`
- `packages/core/src/config/profileManager.ts`
- settings/profile/storage exports in `packages/core/src/index.ts`, `packages/core/index.ts`, and `packages/core/package.json` subpath exports.
- Core re-exports of moved profile/model types from `packages/core/src/index.ts` (`export * from './types/modelParams.js'` or equivalent).
- Core `package.json` subpath export `./types/modelParams.js` if present.
- Direct consumer imports of `@vybestack/llxprt-code-core/settings/*`, `@vybestack/llxprt-code-core/config/storage.js`, and `@vybestack/llxprt-code-core/config/profileManager.js`.
- Root-barrel imports of moved symbols from `@vybestack/llxprt-code-core` (e.g., `import { SettingsService } from '@vybestack/llxprt-code-core'`).
- Dynamic imports (`import('@vybestack/llxprt-code-core').then(...)`) and `vi.mock` paths referencing old core settings/config paths.

### User Access Points Preserved

- CLI startup through `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`.
- Profile load/save/list/delete behavior and profile files under `~/.llxprt/profiles`.
- `/set`, provider selection, provider auth precedence, model/base URL resolution, and settings-backed provider behavior.
- Existing tests that exercise settings registry validation, profile persistence, storage path resolution, and provider settings behavior.

### Migration Requirements

- Add `packages/settings` to root workspaces and package lock metadata.
- Add `@vybestack/llxprt-code-settings` dependencies to packages that import settings directly.
- Update TypeScript references and path aliases consistent with `packages/providers` conventions.
- Move tests with the code they verify, then add integration tests proving consumers use the new package through real paths.
- Remove old core source files and exports after consumers are migrated.

## Formal Requirements

[REQ-SET-001] Settings Package Boundary
  [REQ-SET-001.1] Settings service, settings types, settings registry, and settings service instance management MUST live in `packages/settings` after migration.
  [REQ-SET-001.2] Profile management and current config storage path/persistence helpers MUST live in `packages/settings` until a dedicated storage package exists.
  [REQ-SET-001.3] `packages/settings` MUST expose a clean public API through `@vybestack/llxprt-code-settings` and package subpath exports only where intentionally documented.

[REQ-DEP-001] Cycle-Free Dependency Direction
  [REQ-DEP-001.1] `packages/settings` MUST NOT depend on `packages/providers`, `packages/tools`, or `packages/cli`.
  [REQ-DEP-001.2] `packages/settings` MUST NOT depend on `packages/core`; core consumers must import settings package APIs instead.
  [REQ-DEP-001.3] Production package dependencies MUST NOT form a package cycle.

[REQ-PROF-001] Profile And Storage Behavior Preservation
  [REQ-PROF-001.1] Profile files MUST remain under `~/.llxprt/profiles` with existing JSON formats preserved.
  [REQ-PROF-001.2] `ProfileManager` methods `saveProfile`, `saveLoadBalancerProfile`, `loadProfile`, `listProfiles`, `deleteProfile`, `profileExists`, `save`, and `load` MUST keep current observable behavior.
  [REQ-PROF-001.3] `Storage` path helpers MUST return the same paths as before.

[REQ-REG-001] Settings Registry Behavior Preservation
  [REQ-REG-001.1] Registry validation, normalization, parsing, aliases, completion options, protected keys, provider config keys, and direct setting specs MUST preserve existing behavior.
  [REQ-REG-001.2] `compression.strategy` allowed values MUST match current compression strategy values without importing core compression.
  [REQ-REG-001.3] Registry tests MUST fail if the extracted registry omits existing keys or changes validation semantics.

[REQ-SVC-001] SettingsService Behavior Preservation
  [REQ-SVC-001.1] `SettingsService` MUST preserve provider/global settings reads and writes, provider switching, settings changed events, current profile name handling, profile import/export, and clearing behavior.
  [REQ-SVC-001.2] Settings service instance APIs MUST remain usable by runtime code while living in settings package and without importing core runtime context. Settings `registerSettingsService()` MUST NOT create core `ProviderRuntimeContext`. Core-owned adapter code in `settingsRuntimeAdapter.ts` MUST bridge context creation where needed. `providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` or settings-package singleton functions — it stays settings-agnostic.
  [REQ-SVC-001.3] Runtime context activation MUST not leak settings across isolated runtime contexts.
  [REQ-SVC-001.4] Calling `registerSettingsService()` when no `ProviderRuntimeContext` exists MUST store the service in settings-package state only. `getSettingsService()` MUST return that service.

[REQ-CONS-001] Consumer Migration
  [REQ-CONS-001.1] Core, providers, CLI, a2a-server, and tests MUST import moved settings/profile/storage APIs from `@vybestack/llxprt-code-settings` after migration.
  [REQ-CONS-001.2] Core package deep settings/config exports for moved files MUST be removed or rejected by no-shim verification.
  [REQ-CONS-001.3] Existing CLI and provider behavior MUST remain reachable through current runtime paths.
  [REQ-CONS-001.4] Root-barrel imports of moved symbols from `@vybestack/llxprt-code-core` MUST be migrated to `@vybestack/llxprt-code-settings`. Core MUST NOT re-export moved symbols from its root barrel after P09.
  [REQ-CONS-001.5] `vi.mock` paths and dynamic `import()` calls referencing old core settings/config paths MUST be updated to settings package paths.
  [REQ-CONS-001.6] `packages/core/src/types/modelParams.ts` MUST be deleted. All moved profile/model type consumers MUST import from settings package.

[REQ-TEST-001] Behavioral Refactoring Verification
  [REQ-TEST-001.1] Tests MUST be behavioral and fail if the implementation is removed, not only if import paths change.
  [REQ-TEST-001.2] Integration tests MUST verify real package boundaries and key consumer flows before implementation changes, including vertical-slice integration tests written after stubs exist and before implementation per PLAN.md integration-first requirements.
  [REQ-TEST-001.3] Full repository verification and smoke command are required before check-in.

## Data Schemas

No user-facing data schema changes are intended. Settings-owned profile types must represent the existing profile JSON shapes:

```typescript
export interface StandardProfile {
  version: 1;
  type?: 'standard';
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
  loadBalancer?: LoadBalancerConfig;
  auth?: AuthConfig;
}

export interface LoadBalancerProfile {
  version: 1;
  type: 'loadbalancer';
  policy: 'roundrobin' | 'failover';
  profiles: string[];
  provider: string;
  model: string;
  modelParams: ModelParams;
  ephemeralSettings: EphemeralSettings;
}

export type Profile = StandardProfile | LoadBalancerProfile;
```

## Constraints

- This is a refactor: no intentional behavior changes.
- No `packages/settings -> packages/core` dependency.
- No `packages/settings -> packages/providers`, `packages/settings -> packages/tools`, or `packages/settings -> packages/cli` dependency.
- No backward compatibility wrappers from core to settings.
- Do not implement unrelated god-object decomposition in this issue. Inventory and fence CLI-only settings code that is blocked by that prerequisite.
- Do not create `SettingsServiceV2`, `ProfileManagerNew`, `StorageCompat`, or parallel implementations.
- Do not modify `.llxprt/` contents.
- TDD and integration-first verification are mandatory for production changes.

## Performance Requirements

- Settings package extraction must not add duplicate registry initialization or global singleton work on startup.
- Profile/storage path helpers must remain synchronous where currently synchronous.
- Provider request paths must not add per-call package-boundary overhead beyond normal method calls/import resolution.
