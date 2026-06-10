# Plan: Extract Settings Package

Plan ID: PLAN-20260608-ISSUE1588
Generated: 2026-06-08
Total Phases: 12 plus verification phases
Requirements: REQ-SET-001, REQ-DEP-001, REQ-PROF-001, REQ-REG-001, REQ-SVC-001, REQ-CONS-001, REQ-TEST-001

## Critical Reminders

Before implementing ANY production phase:

1. Complete preflight verification in `plan/00a-preflight-verification.md` and populate `analysis/preflight-results.md`.
2. Verify integration contracts in `analysis/integration-contract.md`.
3. Write integration/behavioral tests before implementation.
4. Preserve behavior: this is a refactor, not a feature addition.
5. Do not modify `.llxprt/`.
6. Do not create core compatibility shims for moved settings APIs.

## Execution Model

Execute phases sequentially. Use typescriptexpert for implementation phases and typescriptreviewer for verification phases. Do not skip phase numbers. Do not combine phases. P03b creates minimal adapter/config wiring stubs that P04b integration tests depend on; P06 replaces those stubs with full implementation.

## Refactoring Strategy

1. Verify current code and package assumptions.
2. Classify settings/profile/storage ownership and dependency blockers.
3. Establish settings-owned contracts/types before moving implementation.
4. Scaffold `packages/settings` following `packages/providers` conventions.
5. Move settings service, registry, singleton management, profile manager, storage, and tests.
6. Update core runtime/config integration to consume settings package.
7. Update providers, CLI, and other consumers to import settings directly.
8. Remove old core files and exports with no compatibility shims.
9. Run full verification and smoke test.

## Required Supporting Artifacts

Implementation agents must read:

- `specification.md`
- `analysis/final-architecture.md`
- `analysis/dependency-audit.md`
- `analysis/settings-move-map.md`
- `analysis/consumer-import-matrix.md`
- `analysis/behavioral-regression-matrix.md`
- `analysis/integration-contract.md`
- `analysis/anti-shim-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/phase-verification-matrix.md`
- `analysis/call-site-migration-matrix.md`
- all files under `analysis/pseudocode/`

## Key Behavioral Contracts

- **Singleton semantics**: `registerSettingsService()` in settings package stores service in settings-owned state ONLY, does NOT create core `ProviderRuntimeContext`. Core adapter in `settingsRuntimeAdapter.ts` bridges context creation. `providerRuntimeContext.ts` does NOT import or call settings-package functions — the adapter is the sole bridge. See BVE-06a through BVE-06d in `analysis/behavioral-regression-matrix.md` and integration contract IC-02 in `analysis/integration-contract.md`. Full call-site migration matrix in `analysis/call-site-migration-matrix.md`.
- **modelParams.ts deletion**: The entire file is deleted in P09. All symbols move to settings. No symbols remain in core. See `analysis/settings-move-map.md` "Final State Of modelParams.ts" section.
- **Root-barrel import migration**: All moved symbols imported from `@vybestack/llxprt-code-core` (not just deep paths) must be migrated. Root imports are the default and preferred style for consumers; subpath imports are allowed only with specific justification. See "Root-Barrel Import Inventory" in `analysis/consumer-import-matrix.md`.
- **Integration-first TDD (P04b)**: Vertical-slice integration tests are written after stubs exist (P03 + P03b) and before settings implementation (P05). Integration tests live in owning consumer packages, NOT in `packages/settings`. P03b provides minimal adapter/config wiring stubs AND providers/CLI path aliases + dependencies so P04b tests can compile. Each P04b vertical-slice test names the exact production entrypoint/function/class and import path being exercised; tests must fail if production consumer wiring is absent, not merely if a settings class is unimplemented. See `plan/04b-vertical-slice-integration-tdd.md`.
- **Settings `index.ts` barrel decision**: `packages/settings/src/index.ts` is the public API barrel file. It is verified to exist independently from `packages/settings/index.ts` (which re-exports `./src/index.js`). Tests and consumers use root imports (`@vybestack/llxprt-code-settings`) as the preferred style. Subpath imports are allowed with documented justification.
- **Settings source layout**: `SettingsService.ts` lives at `packages/settings/src/settings/SettingsService.ts`, consistent with subpath export `./settings/SettingsService.js` → `./dist/src/settings/SettingsService.js`. Other modules follow the same `src/settings/`, `src/profiles/`, `src/storage/` layout. The barrel file `packages/settings/src/index.ts` is the public API barrel (separate from `packages/settings/index.ts` which re-exports `./src/index.js`). Both files must be verified to exist.
- **Built-runtime verification**: ESM dynamic import (`node --input-type=module -e "await import(...)"`) is used for all built-runtime export verification. The settings package is `type: "module"`; `require()` does not work. **Prerequisite**: `npm install` and full workspace build (`npm run build`) must be complete before built-runtime verification. Verification MUST validate package exports against the actual `package.json` export map AND confirm that each declared `dist/src/...` file exists on disk.
- **CLI settingsSchema import guard**: `packages/settings` MUST NOT import `packages/cli`'s `settingsSchema`. The settings registry and CLI settings schema are separate concerns — the registry provides runtime validation/metadata while the CLI schema provides user-facing JSON schema generation. Schema/doc scripts (`scripts/generate-settings-schema.ts`, `scripts/generate-settings-doc.ts`) are CLI-owned and remain in CLI. This is verified as part of the unified settings package boundary check.
- **a2a-server verification**: a2a-server's lack of direct settings dependency must be verified with actual scan output at preflight and at P08, not just assumed. See `analysis/dependency-audit.md` a2a-server section for verification commands.
- **Internal storage seam**: `packages/settings/src/storage/Storage.ts` defines an internal boundary seam via `LLXPRT_DIR` constant and `Storage` class interface. This seam is documented so future extraction to `packages/storage` is not blocked. The seam consists of: (1) `Storage` class with clear public API surface (global/settings/accounts/profiles path helpers), (2) `LLXPRT_DIR` constant as a self-contained value not imported from core/tools, (3) no imports from settings service/registry inside Storage. Future storage extraction would move only `Storage.ts` and `Storage.test.ts` to a new package without touching settings service/registry internals.
- **Compression strategy preflight values**: Preflight MUST record the exact current `COMPRESSION_STRATEGIES` values from `packages/core/src/core/compression/types.ts` and settings registry tests MUST assert them as literal values (`'middle-out'`, `'top-down-truncation'`, `'one-shot'`, `'high-density'`) without importing from core compression.
- **Adapter idempotency**: `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` have defined idempotency and single-owner semantics. `providerRuntimeContext.ts` does NOT import settings-package functions. See `plan/06-core-integration-stub.md` Adapter Idempotency And Call-Count Tests section and `analysis/call-site-migration-matrix.md` Adapter Permitted Bridge Scan Logic section. The adapter bridge scan uses an **enforcing** Node.js script (exits nonzero on violation), not prose/grep with manual inspection.
- **P04b pass gates**: P04b core integration test is rerun as a pass gate in P06a and P08a to verify that implementation phases maintain the core→settings cross-package contract. The pass gate is NOT run in P05a because P05a verifies settings-package internals only — at that point the core adapter (`settingsRuntimeAdapter.ts`) is still a no-op stub, so the P04b test would always fail on the stub rather than on settings implementation. Provider/CLI vertical-slice integration tests are written in P07 (deferred from P04b because they require consumer migration to pass) and are rerun as pass gates in P08a only. **P04b tests exercise the adapter module directly** (import and call `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext`), not the configConstructor production path. The configConstructor production call-site switch is a P06 task.
- **Import inventory refresh**: A complete refreshed import inventory (including providers deep imports, all workspaces including `packages/lsp`, dynamic imports, vi.mock paths) is required before P08 begins. The call-site migration matrix in `analysis/call-site-migration-matrix.md` is lifecycle-only (getSettingsService/registerSettingsService/resetSettingsService call sites) and does NOT constitute the full import inventory.
- **Root vs subpath import preference**: Root imports (`@vybestack/llxprt-code-settings`) are preferred for SettingsService, registry, and types. Subpath imports (`@vybestack/llxprt-code-settings/profiles/ProfileManager.js`) are acceptable for consumers that import specific modules. Both styles are valid; the anti-shim policy prohibits re-exports from core, not subpath usage from settings.
- **@vybestack/llxprt-code-settings root public API export list**: The canonical list of public exports from the settings package root barrel (`packages/settings/src/index.ts`) is maintained in `analysis/final-architecture.md` Public API Surface section and `analysis/package-metadata-constraints.md`. Verification phases must check against this canonical list, not ad-hoc partial lists.
- **Behavioral CLI test requirement**: After import migration, at least one behavioral CLI-owned test or executable/root entrypoint test must verify CLI settings/profile/startup paths work. Static import guards are supplemental only and cannot be the sole verification mechanism. The CLI smoke test (`node scripts/start.js --profile-load synthetic`) qualifies as a **deterministic** behavioral test — it uses `--profile-load synthetic` for reproducible profile loading.
- **@types/node in settings devDependencies**: `packages/settings/package.json` MUST include `@types/node` in `devDependencies` (matching existing core/providers convention) because Storage and ProfileManager use Node filesystem (`fs`, `fs/promises`), `os`, `path`, and `crypto` modules.
- **P03b compile-only adapter module**: P03b creates a transparent no-op adapter module (`settingsRuntimeAdapter.ts`). It does NOT wire configConstructor to call the adapter — that production call-site switch is deferred to P06. This avoids breaking all existing config construction tests with a throwing stub. P04b tests exercise the adapter module directly (not through configConstructor). See `plan/03b-minimal-adapter-wiring.md`.
- **P04b asserts intended behavior, not stub behavior**: P04b integration tests assert that `activateSettingsRuntimeContext` registers a settings service and `getSettingsService()` returns it. Tests fail against P03b no-op stubs because assertion failures occur (service not registered, context not created). Tests do NOT verify `NotYetImplemented` errors — they verify intended behavior. When P06 implements real behavior, the same tests pass. See `plan/04b-vertical-slice-integration-tdd.md`.
- **Expected-failing TDD verification**: All phases with expected-failing tests (P04, P04b, P07) must use capture-and-assert logic that exits 0 only when: (1) the test runner exits nonzero, (2) no module-resolution errors appear, and (3) expected behavioral assertion failure patterns are present. Bare `|| true` or `rg` commands that return exit 1 when clean are forbidden. P04b verification does NOT grep for `NotYetImplemented`.
- **Enforcing zero-scan pattern**: Every scan that expects zero matches must use capture-and-check-empty (`VAR=$(rg ...); test -z "$VAR" && echo OK || { echo FAIL:; echo "$VAR"; exit 1; }`). Bare `rg` commands that exit 1 on empty output are forbidden.
- **Reusable boundary verification script**: A checked-in `scripts/check-settings-boundary.js` script consolidates repeated inline boundary scan snippets. All verification phases should reference this script instead of duplicating shell snippets. **Created in P03 as a mandatory artifact** alongside the settings package scaffold. P03 must create the script, verify it runs (exits 0 when settings has no forbidden imports/deps), and commit it. Later phases MUST use this script instead of drifting inline scans. See `analysis/boundary-verification-script.md`.
- **Canonical symbol blocklist**: Moved-symbol scans use the canonical blocklist from `analysis/anti-shim-policy.md` which lists all symbols including `LoadBalancerConfig` and `LoadBalancerSubProfileConfig`. Phases must not use ad-hoc partial blocklists.
- **Schema/docs verification**: After any phase that touches CLI schema imports or tsconfig/vitest aliases used by schema/docs scripts (P03b, P05, P05a), run `npm run schema:settings` and `npm run docs:settings` to verify no path-resolution regressions.
- **P05 @plan marker guidance**: When copying code during P05, add `@plan PLAN-20260608-ISSUE1588.P05` markers only at the file level (e.g., `/** @plan PLAN-20260608-ISSUE1588.P05 */`). Do NOT add `@plan` markers to every method in copied files — this creates noisy churn in unchanged legacy code. Markers belong at file/class level and in new/modified methods.
- **TypeScript/Vitest path alias strategy**: All consumer packages use standardized tsconfig path aliases: root resolves to `../settings/index.ts` (source entrypoint), wildcard resolves to `../settings/src/*`. CLI vitest config has root and subpath aliases resolving to settings source via `workspaceAliasPlugin` with `resolveTsSource` (`.js`-to-`.ts` conversion), matching the existing providers/core precedent. See `plan/03b-minimal-adapter-wiring.md` Standardized TypeScript Path Alias Strategy section.
- **Build ordering**: Root build must order `settings -> core -> providers -> cli`. After P03 workspace registration, root build scripts must be verified for correct ordering by inspecting `scripts/build.js` and running verification commands. See `analysis/package-metadata-constraints.md` Root Build Ordering Verification section.
- **Deterministic workspace graph checks**: Two separate checks with different scopes: (1) production dependency cycle detection over `dependencies` only (dev dependency cycles are development-only and non-blocking); (2) settings forbidden-dependency check over both `dependencies` and `devDependencies` (dev deps can still pull forbidden packages into settings build/test). These two checks MUST NOT be merged or conflated — they have different scopes and different failure conditions. Run after P05, P06, P08, and P09. See `analysis/dependency-audit.md` Deterministic Workspace Dependency Graph Checks section.
- **P07 boundary scans are inventory/report-only**: P07 old-import scans MUST NOT exit 1 on non-empty results. They document current state for P08 migration. Zero enforcement begins in P08/P08a/P09.
- **P04 red-phase capture-and-assert**: P04 settings-package TDD verification must use capture-and-assert logic that exits 0 only when: (1) nonzero test exit, (2) no module-resolution errors, and (3) expected behavioral/stub failure patterns are present. Bare `|| true` or `rg` commands that return exit 1 on empty are forbidden.
- **P03b transparent no-op adapter**: P03b creates a compile-only transparent no-op adapter module (`settingsRuntimeAdapter.ts`). It does NOT wire configConstructor — no production code paths call the adapter after P03b, so all existing tests pass unchanged. There is no blast-radius concern because the adapter is never called in production. configConstructor production wiring is deferred to P06.
- **Symbol-by-symbol move map**: Every symbol currently in `packages/core/src/types/modelParams.ts` has a documented destination in `packages/settings/src/profiles/types.ts` and is verified deleted from core in P09. See `analysis/settings-move-map.md` Symbol-by-Symbol Move Map section.
- **Post-build stale export scans**: After P09 cleanup, verify `packages/core/dist/` declarations and JS have no moved settings/Storage/ProfileManager/modelParams exports (including `DiagnosticsInfo` and all settings type exports). See `plan/09a-cleanup-no-shims-verification.md` and `plan/10a-final-semantic-review.md`.
- **Temporary duplicate policy (P05)**: Code is copied into settings package while old core files remain until P09. Old core files do NOT forward/import from settings (they are original code, not shims). Consumers are not broken before migration. P09 deletes all old core files and forbids shims. See `plan/05-settings-package-impl.md` Temporary Duplicate Policy section.
- **Settings test constraint**: Settings package tests MUST NOT import consumer packages, even as dev-only fixtures. See `analysis/consumer-import-matrix.md` Import Style Decision section.
- **Generated schema/docs**: `scripts/generate-settings-schema.ts` and `scripts/generate-settings-doc.ts` import from CLI-owned `settingsSchema.js`, NOT from settings registry. Ownership stays with CLI scripts. Schema/docs verification must run after any phase that touches CLI schema imports or tsconfig/vitest aliases used by those scripts, not only in P10. See `analysis/package-metadata-constraints.md` Generated Schema/Docs Scripts section.
- **LLXPRT_CONFIG_DIR/memoryTool coupling resolution**: Settings `Storage.ts` owns its own `LLXPRT_DIR = '.llxprt'` constant. Core `configBaseCore.ts` defines a local `const LLXPRT_DIR = '.llxprt'` (replacing the import from `memoryTool.ts`). Tests prove identical paths without cross-package imports. See `analysis/dependency-audit.md` Blocker 5a and `plan/06-core-integration-stub.md` LLXPRT_CONFIG_DIR / MemoryTool Coupling Resolution section.
- **SettingsService event behavior tests**: P04 settings package tests must explicitly test each event name and payload: `'change'` event from `set(key, value)` with correct key/value, `'provider-change'` event from `setProviderSetting(provider, key, value)` with provider/key/value details, `'cleared'` event from `clear()`, and `onSettingsChanged`/`'settings_changed'` behavior (including whether it is an alias for `'change'` or a separate event). Broad "changed events" wording is insufficient — tests must assert exact event names and payload shapes.
- **Storage method ownership classification**: All `Storage` static/instance methods are classified with ownership categories in `analysis/behavioral-regression-matrix.md` BVE-05. Non-settings methods (policies, skills, MCP auth, installation ID, history/temp) are temporarily in settings with documented `@storage-seam` markers and justification for future extraction to `packages/storage`.
- **providerRuntimeContext replacement type**: `ProviderRuntimeContextInit.settingsService` is typed as `ProviderRuntimeSettingsService` (a core-owned minimal structural interface with `get`, `set`, `on`, `clear` methods). `createProviderRuntimeContext({})` without `settingsService` is no longer valid. All call sites must provide a settings service. See `analysis/final-architecture.md` ProviderRuntimeSettingsService section.
- **Reusable boundary verification script**: `scripts/check-settings-boundary.js` is the authoritative enforcement mechanism for P08/P09/P10 boundary checks. It covers 20 checks including: old package deep imports, root-barrel moved-symbol imports (using canonical blocklist from `analysis/anti-shim-policy.md` including type-only and multiline imports), relative core settings/storage/profile imports, vi.mock paths, dynamic imports, package metadata dependencies, providerRuntimeContext settings-agnostic rule, no `packages/storage`, no core shim exports, and settingsRuntimeAdapter single-owner bridge scan with alias/multiline/wrapper-aware logic. Inline grep snippets in P08/P09/P10 are replaced with `node scripts/check-settings-boundary.js` invocations.
- **No `packages/storage` verification**:
- **`providerRuntimeContext.ts` ownership decision**: `providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` or settings-package singleton functions. It is settings-agnostic. The sole bridge between settings and runtime context is `settingsRuntimeAdapter.ts`. This decision resolves the contradiction from review-09: `providerRuntimeContext.ts` is not an adapter, not a bridge, and must not import or construct `SettingsService` from settings. Scans from P06 onward enforce this by checking for `SettingsService`, `registerSettingsService`, `resetSettingsService`, `getSettingsService`, and `from.*@vybestack/llxprt-code-settings` in `providerRuntimeContext.ts`.  
  **Replacement type**: `ProviderRuntimeContextInit.settingsService` is typed as `ProviderRuntimeSettingsService` (a core-owned minimal structural interface with methods core needs: `get`, `set`, `on`, `clear`). `createProviderRuntimeContext({})` without a `settingsService` is no longer valid — callers must provide one. The adapter provides one via `activateSettingsRuntimeContext(s)`. See `analysis/final-architecture.md` ProviderRuntimeSettingsService section for full definition.
- **`packages/settings/src/index.ts` is the canonical root public API barrel**: This file is distinct from `packages/settings/index.ts` (which re-exports `./src/index.js`). Both must exist. `packages/settings/index.ts` MUST contain `export * from './src/index.js'` (or equivalent re-export). Verification phases must confirm both `packages/settings/index.ts` and `packages/settings/src/index.ts` exist, and that `packages/settings/index.ts` re-exports from `./src/index.js`. The root package export `.` resolves to `dist/index.js` which TypeScript compiles from `packages/settings/src/index.ts` via the barrel chain.
- **Test directory convention**: Settings package tests use `.test.ts` extension in co-located `__tests__` directories. Registry tests use `src/__tests__/settingsRegistry.test.ts` (co-located at the `src/` level, matching providers precedent). Other module tests use co-located directories: `src/settings/__tests__/SettingsService.test.ts`, `src/profiles/__tests__/ProfileManager.test.ts`, `src/storage/__tests__/Storage.test.ts`.
- **P08 import inventory commands**: P08 begins with a refreshed complete import inventory using canonical `rg -n` commands. These commands are documented inline in `plan/08-consumer-migration-impl.md`. Do not use ad-hoc alternatives. The complete inventory must cover: (1) root-barrel named imports of ALL moved symbols, (2) deep-path imports from `@vybestack/llxprt-code-core/settings/*` and `@vybestack/llxprt-code-core/config/(storage|profileManager)`, (3) type imports from `@vybestack/llxprt-code-core/types/modelParams`, (4) `vi.mock()` paths referencing old core settings/config paths, (5) dynamic `import()` calls referencing old core settings/config paths, (6) relative core imports of `config/storage` and `config/profileManager`, (7) relative core imports of `settings/` modules, (8) all workspaces including `packages/lsp`. See `analysis/consumer-import-matrix.md` for the complete core-relative Storage and Settings import inventories.
- **No-shim type blocklist**: All current core root settings type exports must be removed in P09: `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `SettingsService`, plus profile/model types. See `analysis/anti-shim-policy.md` Blocklist section.
- **Forbidden-import scans use enforcing logic**: All scans that must return zero matches use capture-and-check-empty or fail-on-nonempty patterns, never bare `|| true`. See `analysis/dependency-audit.md` Forbidden Import Scans section and `analysis/phase-verification-matrix.md` Boundary Scans section.
- **a2a-server dependency**: a2a-server does NOT need a direct settings dependency — it uses its own `Settings` interface, not core `SettingsService`. See `analysis/dependency-audit.md` a2a-server Dependency Clarification section.
- **Export map style**: Settings package subpath exports use `{types, import}` objects consistently, matching providers precedent. Verified by automated check. See `analysis/package-metadata-constraints.md` Export Map section.
- **Lockfile verification**: After every workspace/dependency change, `npm install` must produce only settings-related changes in `package-lock.json`. `git diff --stat package-lock.json` must show focused changes, not unrelated churn. No `pnpm-lock.yaml` must be created.

## CLI God-Object Deferral Inventory

The following CLI files/config areas are inventoried for deferral until god-object decomposition completes. They remain CLI-owned because they depend on CLI-specific god objects that cannot be cleanly separated in this issue:

| CLI Area | File(s) | Reason for Deferral |
|----------|---------|---------------------|
| CLI settings schema | `packages/cli/src/config/settingsSchema.ts` (or `.js`) | Used by root schema/docs generation scripts; CLI-specific schema definition, not settings-registry validation |
| CLI runtime settings wiring | `packages/cli/src/runtime/runtimeContextFactory.ts`, `packages/cli/src/runtime/runtimeAccessors.ts` | Core config delegation pattern; CLI startup wiring depends on CLI god objects |
| CLI config bootstrap | `packages/cli/src/config/postConfigRuntime.ts` | Uses local `getSettingsService()` wrapper, not direct singleton — requires broader CLI decomposition |
| CLI settings commands | `packages/cli/src/commands/settings*.ts` (if they exist) | Command-specific settings UI logic, depends on CLI command framework |

These files are out of scope for this issue. Consumer migration (P08) updates their imports of moved APIs to settings-package imports, but does NOT move the CLI-specific logic itself. A static import guard verifies that `packages/settings` does NOT import `settingsSchema` from CLI — schema/doc scripts intentionally remain CLI-owned.

## Explicit Scope Boundaries

In scope:

- New package `@vybestack/llxprt-code-settings`.
- Move settings service, registry, settings types, singleton management.
- Move storage path helper and profile manager.
- Move/split ALL profile/model parameter types from `packages/core/src/types/modelParams.ts` into settings (entire file deleted after extraction).
- Update consumer imports (deep paths, root barrel, dynamic imports, vi.mock paths).
- Update package metadata: tsconfig paths, vitest aliases, package.json dependencies, npm lockfile.
- Remove old core files, core root/deep exports, and `modelParams.ts` with no compatibility shims.

Out of scope unless plan is updated before coding:

- Creating `packages/storage`.
- Moving CLI-specific settings schema/runtime code that still depends on CLI god objects.
- Refactoring unrelated core `Config` god-object behavior.
- Adding backwards compatibility wrappers.

## Internal Storage Seam

`packages/settings/src/storage/Storage.ts` defines an internal boundary seam for future storage extraction. The seam consists of: (1) `Storage` class with a clear public API surface (global/settings/accounts/profiles path helpers), (2) `LLXPRT_DIR` constant as a self-contained value (`'.llxprt'`) not imported from core/tools, (3) no imports from settings service/registry inside Storage. Future extraction to `packages/storage` would move only `Storage.ts` and `Storage.test.ts` without touching settings service/registry internals. The `./storage/Storage.js` subpath export in `package.json` would simply become a new package's export.

## Package Manager Clarification

Root `package.json` declares `packageManager: pnpm` but project scripts and existing verification use `npm`, and `package-lock.json` exists. This plan uses `npm` consistently. Implementers must not run `pnpm install`, which would create lockfile churn. Preflight (P0.5) must record evidence of npm vs pnpm stance: existence of `package-lock.json`, absence of `pnpm-lock.yaml`, and that `npm run test` works from the root directory.

## Phase-Specific Verification Matrix

Use `analysis/phase-verification-matrix.md` for phase commands. P10 must run the full verification suite from project memory.
