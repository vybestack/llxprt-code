# Plan: Complete OS-standard path migration for OAuth and global state (Issue #2606)

**Issue:** https://github.com/vybestack/llxprt-code/issues/2606 (labels: `oauth`, `security`)
**Branch:** `issue2606`
**Audit basis:** `research/wrongpaths.md` (whole-repository audit, 2026-07-20, 29 confirmed clusters: P1–P8 production, G1–G5 tooling, T1–T7 tests, D1–D9 docs). Do not modify or delete `research/wrongpaths.md`.
**Rules:** `dev-docs/RULES.md` — behavioral TDD is mandatory (RED → GREEN → REFACTOR), no mock theater, no `any`, immutable data, explicit dependencies. Every phase below lists failing behavior tests to write FIRST.

---

## 1. Normative path contract (already implemented, now enforced everywhere)

The single path authority is `Storage` in `packages/storage/src/config/storage.ts`
(re-exported by `packages/settings/src/storage/Storage.ts` as `@vybestack/llxprt-code-settings` → `Storage`; also importable directly from `@vybestack/llxprt-code-storage`).

| Category | Helper | Override precedence | Linux / macOS / Windows default |
| --- | --- | --- | --- |
| Config (user-editable) | `Storage.getGlobalConfigDir()` | `LLXPRT_CONFIG_HOME` → platform | `~/.config/llxprt-code` / `~/Library/Preferences/llxprt-code` / `%APPDATA%\llxprt-code\Config` |
| Data (app-managed durable) | `Storage.getGlobalDataDir()` | `LLXPRT_DATA_HOME` → `LLXPRT_CONFIG_HOME` → platform | `~/.local/share/llxprt-code` / `~/Library/Application Support/llxprt-code` / `%LOCALAPPDATA%\llxprt-code\Data` |
| Cache | `Storage.getGlobalCacheDir()` | `LLXPRT_CACHE_HOME` → `LLXPRT_CONFIG_HOME` → platform | `~/.cache/llxprt-code` / `~/Library/Caches/llxprt-code` / `%LOCALAPPDATA%\llxprt-code\Cache` |
| Log/state (ephemeral) | `Storage.getGlobalLogDir()` | `LLXPRT_LOG_HOME` → `LLXPRT_CONFIG_HOME` → platform | `~/.local/state/llxprt-code` / `~/Library/Logs/llxprt-code` / `%LOCALAPPDATA%\llxprt-code\Log` |

Intentional, non-defect references that MUST be preserved:

- Workspace-local `<workspace>/.llxprt` (instance methods `new Storage(dir).*`).
- `Storage.getLegacyLlxprtDir()` (`~/.llxprt`) — startup-migration input and bounded exclusion sentinel ONLY.
- `~/.gemini/extensions` — read-only compatibility root.
- Historical documents (`project-plans/`, `docs/plans/`, `docs/release-notes/`, `docs/merge-notes/`, `packages/core/analysis/`, `CHANGELOG.md`, `research/`), test fixtures with injected temp paths, and the repository's own `.llxprt/` directory (NEVER touch it).

---

## 2. Architectural decisions (binding for the implementer)

**AD1 — One central typed path contract; no duplicated platform algorithms.**
All global-path knowledge lives in `packages/storage/src/config/storage.ts`. This plan ADDS three typed statics and REMOVES one wrong one:

```ts
// packages/storage/src/config/storage.ts

/**
 * App-managed user (global) extensions. Data category.
 * <data>/extensions — mirrors pathMigration's DATA_ENTRIES('extensions').
 */
static getUserExtensionsDir(): string {
  return path.join(Storage.getGlobalDataDir(), 'extensions');
}

/**
 * Directory holding the global memory/context files (LLXPRT.md variants and
 * .LLXPRT_SYSTEM). Config category — these files are directly user-editable
 * and pathMigration's CONFIG_ENTRIES already copies them here.
 * Filenames are owned by @vybestack/llxprt-code-tools (contextFileName is
 * runtime-configurable); Storage owns only the directory.
 */
static getGlobalMemoryDir(): string {
  return Storage.getGlobalConfigDir();
}

/**
 * OAuth advisory locks (refresh/auth). Ephemeral runtime state → log/state
 * category, honoring LLXPRT_LOG_HOME → LLXPRT_CONFIG_HOME → platform log.
 * Contains no credentials.
 */
static getOAuthLocksDir(): string {
  return path.join(Storage.getGlobalLogDir(), 'oauth', 'locks');
}
```

REMOVE `Storage.getGlobalMemoryFilePath()` (`<data>/memory.md`). It has zero production consumers (verified: only its own definition and `pathMigration`'s unrelated legacy `memory.md` DATA entry, which stays as an archival copy rule). Keeping a wrong helper invites misuse.

Rejected alternative: per-package local fixes at each call site — rejected because the audit shows the split re-appears wherever the algorithm is re-derived (`keyring-token-store.ts` re-implemented the config algorithm; `secure-store.ts` captured raw `env-paths`). Central helpers make category changes single-point.

**AD2 — OAuth credentials: keyring primary, encrypted fallback under canonical data (P7).**
No change to keyring-first behavior. `SecureStore` default `fallbackDir` becomes `path.join(Storage.getGlobalDataDir(), 'secure-store', serviceName)` resolved **at construction time** (not module load). `packages/storage/src/secure-store/secure-store.ts` imports `Storage` from `../config/storage.js` (same package — `provider-key-storage.ts` already does exactly this; no layering or cycle issue since `storage.ts` imports nothing from `secure-store/`). Delete the module-level `const platformPaths = envPaths(...)` in `secure-store.ts` if it becomes unused (line 36; only remaining use is line 272). All default-constructed consumers inherit the fix with no call-site change: `packages/core/src/auth-factories.ts` (OAuth tokens), `packages/cli/src/config/extensions/settingsStorage.ts` (extension secrets), `packages/core/src/tools/tool-key-storage.ts` (tool keychain).

**AD3 — OAuth advisory locks: log/state category, injected from the composition root (P8).**
`packages/auth` is a true leaf (only dependency: `zod`) and therefore CANNOT import Storage. Today it duplicates the platform-config algorithm (`getPlatformConfigDir`/`getLockDir`, `keyring-token-store.ts:46-75`). Decision:

- Make `lockDir` REQUIRED in `KeyringTokenStore`'s constructor options (same pattern as the existing required `secureStore` — constructor throws with a message directing callers to `createKeyringTokenStore()`).
- DELETE `getPlatformConfigDir()` and `getLockDir()` from `packages/auth/src/keyring-token-store.ts` entirely (satisfies "no duplicate platform path algorithm remains").
- `packages/core/src/auth-factories.ts#createKeyringTokenStore()` passes `lockDir: Storage.getOAuthLocksDir()`.
- Category choice is log/state (issue directive: "OAuth locks use canonical log/state via central Storage and LLXPRT_LOG_HOME precedence"). The migration map's legacy `locks` DATA entry (`~/.llxprt/locks`) is a different, archival artifact — leave `pathMigration.ts` category sets untouched.
- NO migration of existing lock files: they are advisory, ephemeral (30 s stale threshold). Accepted, documented risk: during a version upgrade, an old-version process and a new-version process briefly use different lock dirs and could refresh concurrently once; OAuth refresh endpoints tolerate this.

**AD4 — Global memory: ONE category (config), one reader/writer path, legacy only via explicit migration (P5).**
Current state is a three-way split: migration copies `LLXPRT.md`/`.LLXPRT_SYSTEM` to **config**; `MemoryTool` writes via `CoreStorageServiceAdapter.getLLXPRTDir()` → **data**; every reader (`loadGlobalMemory`, `loadCoreMemory`, `loadServerHierarchicalMemory`, `prompts.loadCoreMemoryContent`, CLI `/memory add core.global`) reads **legacy `~/.llxprt`**. Canonical decision: **config**, because (a) these files are directly user-editable (semantic role = config), and (b) the shipped migration already copied users' files to config — choosing data would orphan migrated files a second time.

Mechanics:

- Rename `IStorageService.getLLXPRTDir()` → `getGlobalMemoryDir()` (`packages/tools/src/interfaces/IStorageService.ts`; only consumer is `memoryTool.ts`). `CoreStorageServiceAdapter` implements it as `Storage.getGlobalMemoryDir()` (config).
- In `packages/tools/src/tools/memoryTool.ts`: delete `getDefaultGlobalLlxprtDir()`; make the `storageService` parameter of `getGlobalCoreMemoryFilePath()` REQUIRED (`storageService: Pick<IStorageService, 'getGlobalMemoryDir'>`). Project-scope helpers unchanged.
- Core/CLI call sites pass a shared adapter: export `const coreStorageServiceAdapter = new CoreStorageServiceAdapter()` (module-level singleton in `CoreStorageServiceAdapter.ts`) and use it in `memoryDiscovery.ts`, `prompts.ts`, `memoryCommand.ts`.
- `memoryDiscovery.ts` reader changes:
  - `loadGlobalMemory()`: read `path.join(Storage.getGlobalMemoryDir(), filename)` for each configured filename.
  - `findGlobalAndWorkspacePaths()` / `loadServerHierarchicalMemory()`: global file = `path.join(Storage.getGlobalMemoryDir(), llxprtMdFilename)`; upward traversal must EXCLUDE both the canonical global file AND the legacy file `path.join(Storage.getLegacyLlxprtDir(), filename)` so that a surviving `~/.llxprt/LLXPRT.md` is not resurrected as a "workspace" file when walking through `$HOME`. Keep the loop guard `currentDir !== path.join(resolvedHome, LLXPRT_DIR)` semantics via `Storage.getLegacyLlxprtDir()` with a `// legacy-exclusion (migration-only contract)` comment.
  - `findUpwardLlxprtFiles()` (JIT subdirectory flow): same dual exclusion.
  - `loadCoreMemory()`: `getGlobalCoreMemoryFilePath(coreStorageServiceAdapter)`.
- `packages/core/src/core/prompts.ts#loadCoreMemoryContent` and `packages/cli/src/ui/commands/memoryCommand.ts` (`core.global` branch): pass the adapter; update the stale doc comment at `prompts.ts:228-231`.
- **One-time reconciliation migration** (compatibility for memories the shipped adapter wrote into data): new function `reconcileGlobalMemory(destinations: MigrationDestinations): MigrationResult` in a new file `packages/cli/src/config/memoryReconciliation.ts`, orchestrated from `runStartupMigrationWithPath()` in `pathMigration.ts` following the existing `repairProfiles` pattern:
  - Own marker `.memory-reconcile-complete.json` (version 1) in `destinations.dataDir`, written only when ≥1 file was reconciled; benign no-op does not stamp (mirrors repair-marker semantics).
  - For each of `['LLXPRT.md', '.LLXPRT_SYSTEM']`: if `<data>/<file>` exists: when `<config>/<file>` is absent → copy to config then rename source to `<data>/<file>.migrated-to-config`; when both exist → append the data file's full content to the config file (separated by a single blank line) then rename the source likewise. Never delete; never overwrite config content.
  - Skipped entirely when `LLXPRT_CONFIG_HOME` is set (consistent with `runStartupMigration()`'s existing skip).
  - Known bounded limitation (document in code + docs): users with a custom `contextFileName` whose tool-saved global memories landed under `<data>/<custom>.md` must move that one file manually; the reconciliation covers the default filenames only because startup migration runs before settings are loaded.
- `MIGRATION_MARKER_VERSION` stays 1; legacy `CONFIG_ENTRIES`/`DATA_ENTRIES` sets unchanged.

**AD5 — User extensions: data category everywhere (P3/P4).**

- `packages/cli/src/config/extension.ts#ExtensionStorage.getUserExtensionsDir()` returns `Storage.getUserExtensionsDir()` (drop `new Storage(os.homedir())`). This transitively fixes install/update destinations (`getExtensionDir`), `rootAwareResolver.getExtensionRoots()[0]`, and all `ExtensionEnablementManager` construction sites (extension.ts:884/901/949/968, `cliSessionBootstrap.ts:131`) — enablement state `extension-enablement.json` moves with it, and the already-shipped migration of legacy `~/.llxprt/extensions` → `<data>/extensions` (DATA_ENTRIES) delivers migrated state to exactly this location.
- `loadUserExtensions()` (extension.ts:237-248) stops scanning `loadExtensionsFromDir(os.homedir())`; instead scan exactly two roots: `ExtensionStorage.getUserExtensionsDir()` and `path.join(os.homedir(), COMPAT_EXTENSIONS_DIRECTORY_NAME)`. Add a small internal helper (e.g. `loadExtensionsFromRoots(roots: string[], workspaceDir: string)`) reusing `readExtensionDirEntries`/`loadExtension`; `loadExtensionsFromDir(dir)` remains for workspace scanning only.
- Keep the `getWorkspaceExtensions` guard returning `[]` when `workspaceDir === homedir()` (now it also prevents legacy `~/.llxprt/extensions` from resurfacing as workspace extensions).
- `packages/a2a-server/src/config/extension.ts#loadExtensions` (line 448): replace `loadExtensionsFromDir(os.homedir(), workspaceDir)` with scanning `[Storage.getUserExtensionsDir(), path.join(os.homedir(), '.gemini/extensions')]` (import `Storage` from `@vybestack/llxprt-code-storage` — already a direct dependency). Mirror the CLI helper shape; preserve workspace-before-user precedence and `folderTrust` gating.

**AD6 — A2A settings/env parity with CLI (P1/P2).**

- `packages/a2a-server/src/config/settings.ts`: user settings path = `Storage.getGlobalSettingsPath()`; DELETE the deprecated `USER_SETTINGS_DIR` / `USER_SETTINGS_PATH` constants (no importers outside the file) and the `homedir()` import if unused. Workspace path `<workspace>/.llxprt/settings.json` and the folderTrust merge rules are unchanged.
- `packages/a2a-server/src/config/config.ts#findEnvFile` (line 338): replace ONLY the LLxprt-specific home fallback `homedir()/.llxprt/.env` with `path.join(Storage.getGlobalConfigDir(), '.env')` — identical to CLI (`packages/cli/src/config/settings.ts:346`). Keep the project-local upward `.llxprt/.env` traversal and the generic `~/.env` fallback.

**AD7 — PromptInstaller: no implicit home default (P6).**
Delete `DEFAULT_BASE_DIR` (`'~/.llxprt/prompts'`) from `packages/core/src/prompt-config/prompt-installer.ts` and its re-export in `prompt-config/index.ts:41`. `install`, `uninstall`, `validateInstallation`, and the backup path (lines 118/371/453/808) REQUIRE a resolved `baseDir: string`; a `null`/empty value throws `Error('PromptInstaller requires a resolved baseDir; use PromptService which supplies Storage.getGlobalConfigDir()/prompts')`. Do NOT import Storage into the installer (the normal `PromptService` already resolves `path.join(Storage.getGlobalConfigDir(), 'prompts')`, `prompt-service.ts:62`). Update the stale comment in `prompt-config/defaults/index.ts:11-14`.

**AD8 — Scripts never touch real `~/.llxprt` (G1–G5).**
Shell/JS tooling resolves canonical paths by shelling into the hoisted `env-paths` package rather than re-implementing the algorithm; override precedence is honored explicitly:

- `scripts/telemetry_utils.js` (G1): `OTEL_DIR = <logDir>/tmp/<projectHash>/otel` where `logDir = LLXPRT_LOG_HOME || LLXPRT_CONFIG_HOME || require('env-paths')('llxprt-code',{suffix:''}).log`. Update `docs/telemetry.md:110,151` accordingly (Phase 9).
- `scripts/verify-oauth-integration.sh` (G2): DELETE. It fabricates plaintext tokens under the real `${HOME}/.llxprt/oauth` and verifies a superseded file-token contract; real coverage is the keyring-token-store behavioral suites plus the new lock/fallback tests in Phases 1–2. Remove any references to it.
- `shell-scripts/cache-baseline-test.sh` (G3): `DEBUG_DIR="${LLXPRT_DEBUG_DIR:-${LLXPRT_LOG_HOME:-${LLXPRT_CONFIG_HOME:-$(node -p "require('env-paths')('llxprt-code',{suffix:''}).log")}}/debug}"` (explicit-arg override wins; never clear a directory the user did not opt into).
- `shell-scripts/codex-call.sh`, `codex-models.sh`, `codex-oauth.sh` (G4): `AUTH_DIR="${CODEX_AUTH_DIR:-${LLXPRT_DATA_HOME:-$(node -p "require('env-paths')('llxprt-code',{suffix:''}).data")}/codex-auth}"`; `chmod 700` after `mkdir -p`; print a "contains live credentials" warning.
- `shell-scripts/issue489-acceptance-test.sh` (G5): profiles from `${LLXPRT_CONFIG_HOME:-$(node -p ...config)}/profiles`, debug from log/state as in G3.

**AD9 — User-visible text is category-aware, not legacy (D9 + T6/T7).**
Generated help/schema/error text stops naming `~/.llxprt`. Runtime OAuth storage-error remediation names the real mechanism ("OS keyring / encrypted fallback in the LLxprt data directory"), not a legacy config path. `schemas/settings.schema.json` is REGENERATED (`npm run schema:settings`), never hand-edited.

**AD10 — Repository guard with explicit allowlist.**
New `scripts/check-legacy-paths.ts` + `npm run lint:legacy-paths`, wired into CI next to `lint:cli-boundary` (`.github/workflows/ci.yml:265` area) and `scripts/lint-all.sh`. Narrow scope: home-anchored legacy patterns in ACTIVE surfaces only (see Phase 10 for the precise pattern set, scanned trees, and allowlist format). Workspace-relative `.llxprt` never matches (not home-anchored). Historical trees and tests are excluded from v1 scanning; test hygiene is enforced by the T1–T7 rewrites instead.

---

## 3. Phases

Conventions for every phase:

- **RED:** add/modify the listed behavior tests FIRST; run the package suite and confirm the new tests FAIL for the stated reason (missing helper → compile error counts as RED for contract-shape tests, but every phase must also include at least one runtime behavior RED).
- **GREEN:** implement the minimal change; re-run the suite.
- Tests use REAL components with temp dirs + `LLXPRT_*_HOME` env overrides (save/restore `process.env` in `beforeEach`/`afterEach` exactly like `packages/storage/src/config/storage.test.ts:269-337`). Mock ONLY infrastructure (e.g. an in-memory `KeyringAdapter` via the existing `keyringLoader` injection point). Never assert mock invocations; assert files on disk / returned values.
- Package verify commands are listed per phase; the full gate is Phase 10.

### Phase 1 — Storage contract + SecureStore fallback (P7; foundation for all later phases)

**Files:**
- `packages/storage/src/config/storage.ts` (add `getUserExtensionsDir`, `getGlobalMemoryDir`, `getOAuthLocksDir`; delete `getGlobalMemoryFilePath`)
- `packages/storage/src/config/storage.test.ts`
- `packages/storage/src/secure-store/secure-store.ts` (constructor default `fallbackDir`; drop module-level `platformPaths` if unused)
- `packages/storage/src/secure-store/secure-store.fallback.test.ts`

**RED tests (write first):**
1. `storage.test.ts`: `getUserExtensionsDir()` = `<LLXPRT_DATA_HOME>/extensions` when the override is set; ends with the platform data path + `/extensions` when unset; honors the `LLXPRT_CONFIG_HOME` compat fallback when only that is set.
2. `storage.test.ts`: `getGlobalMemoryDir()` equals `getGlobalConfigDir()` under no override, `LLXPRT_CONFIG_HOME` override, and default-platform cases.
3. `storage.test.ts`: `getOAuthLocksDir()` = `<LLXPRT_LOG_HOME>/oauth/locks`; falls back to `LLXPRT_CONFIG_HOME` then the platform log dir.
4. `secure-store.fallback.test.ts`: with `LLXPRT_DATA_HOME=<tmp>` and a keyring loader that returns `null` (forcing fallback), `set()` creates the envelope file under `<tmp>/secure-store/<service>/` and `get()` round-trips it. Second test: only `LLXPRT_CONFIG_HOME` set → file under it. Third test: env var changed AFTER construction does not move an existing instance's fallback dir (construction-time resolution). Existing native-default tests (`secure-store.fallback.test.ts:607-683`) must keep passing unchanged.

**GREEN:** implement AD1 + AD2. `getGlobalMemoryFilePath` removal is compile-verified by `npm run typecheck` (no consumers exist).

**Verify:** `npm run test -w packages/storage && npm run typecheck`

### Phase 2 — OAuth advisory locks (P8) + OAuth error guidance (part of D9/T6)

**Files:**
- `packages/auth/src/keyring-token-store.ts` (require `lockDir`; delete `getPlatformConfigDir`/`getLockDir`)
- `packages/auth/src/oauth-errors.ts` (STORAGE_ERROR / FILE_PERMISSIONS remediation text)
- `packages/core/src/auth-factories.ts` (pass `lockDir: Storage.getOAuthLocksDir()`; import `Storage` from `@vybestack/llxprt-code-settings` as `CoreStorageServiceAdapter` does)
- Tests: `packages/auth/src/__tests__/keyring-token-store.test.ts`, `keyring-token-store.di.test.ts`, `keyring-token-store.integration.test.ts` (audit which already inject `lockDir`; add/adjust), `packages/auth/src/__tests__/oauth-errors.spec.ts:63-70`, `packages/providers/src/auth/__tests__/codex-oauth-provider.test.ts:149-150` (rename/describe token-store behavior, drop `~/.llxprt/oauth/codex.json` wording), and a new core-level factory behavior test (e.g. `packages/core/src/auth-factories.lockdir.test.ts`).

**RED tests:**
1. Auth unit: constructing `KeyringTokenStore({ secureStore })` WITHOUT `lockDir` throws an error naming `createKeyringTokenStore()`.
2. Auth behavior: with `lockDir: <tmp>`, a token save/refresh path creates `<provider>-refresh.lock` inside `<tmp>` (assert real file existence during `withRefreshLock`-style flow using the real store + in-memory keyring adapter).
3. Core factory behavior: with `LLXPRT_LOG_HOME=<tmp>` and `LLXPRT_DATA_HOME=<tmp2>`, `createKeyringTokenStore()` operations create lock files under `<tmp>/oauth/locks` and (fallback path) envelopes under `<tmp2>/secure-store/llxprt-code-oauth` — proves cross-package override precedence end-to-end with zero legacy writes (also assert `~/.llxprt/oauth` was NOT created under a faked `HOME`).
4. `oauth-errors.spec.ts`: remediation for STORAGE_ERROR/FILE_PERMISSIONS mentions the OS keyring and the LLxprt data directory; asserts it does NOT contain the string `~/.llxprt`.

**GREEN:** implement AD3 + new remediation copy: e.g. `'Check that the OS keyring is unlocked and that the LLxprt data directory is writable (see docs/reference/application-directories.md).'`

**Compatibility:** none beyond the documented transient dual-lock window (AD3). Legacy `<config>/oauth/locks` directories become inert; do not clean them up.

**Verify:** `npm run test -w packages/auth && npm run test -w packages/core && npm run test -w packages/providers && npm run typecheck`

### Phase 3 — Global memory unification (P5, T4) + reconciliation migration

**Files:**
- `packages/tools/src/interfaces/IStorageService.ts` (rename `getLLXPRTDir` → `getGlobalMemoryDir`)
- `packages/tools/src/tools/memoryTool.ts` (use renamed method; delete `getDefaultGlobalLlxprtDir`; require `storageService` in `getGlobalCoreMemoryFilePath`)
- `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts` (implement rename → `Storage.getGlobalMemoryDir()`; export `coreStorageServiceAdapter` singleton)
- `packages/core/src/utils/memoryDiscovery.ts` (`loadGlobalMemory`, `findGlobalAndWorkspacePaths`, `searchUpwardForLlxprtMd`, `findUpwardLlxprtFiles`, `loadCoreMemory`, `loadServerHierarchicalMemory`)
- `packages/core/src/core/prompts.ts` (`loadCoreMemoryContent` + comment 228-231)
- `packages/cli/src/ui/commands/memoryCommand.ts` (`core.global` branch)
- NEW `packages/cli/src/config/memoryReconciliation.ts` + orchestration hook in `packages/cli/src/config/pathMigration.ts` (`runStartupMigrationWithPath`)
- Tests: `packages/tools/src/tools/memoryTool.test.ts` (provider rename), `packages/core/src/utils/memoryDiscovery.subfunctions.test.ts:157-197,577-625` (rewrite), NEW `packages/cli/src/config/memoryReconciliation.test.ts`, NEW cross-component test (see RED 5).

**RED tests:**
1. `memoryDiscovery` behavior (temp `LLXPRT_CONFIG_HOME=<cfg>`, faked `HOME=<home>` via existing homedir-mock pattern): `loadGlobalMemory()` returns content of `<cfg>/LLXPRT.md`; a file at `<home>/.llxprt/LLXPRT.md` is NOT included.
2. Upward traversal: with cwd `<home>/projects/x` and files at `<home>/.llxprt/LLXPRT.md` + `<cfg>/LLXPRT.md`, hierarchical load includes the config file exactly once and never the legacy file; a genuine workspace file `<home>/projects/x/.llxprt/LLXPRT.md` still loads.
3. `loadCoreMemory()` reads `<cfg>/.LLXPRT_SYSTEM`; legacy `<home>/.llxprt/.LLXPRT_SYSTEM` ignored.
4. `memoryTool` (tools pkg): saving scope `global` and `core.global` with an injected real `IStorageService` whose `getGlobalMemoryDir()` returns `<tmp>` writes `<tmp>/LLXPRT.md` / `<tmp>/.LLXPRT_SYSTEM`; compile-level: `getGlobalCoreMemoryFilePath()` without argument no longer typechecks (adjust callers in tests).
5. Cross-component round trip (core, no mock theater): using `CoreStorageServiceAdapter` + real `MemoryTool.performAddMemoryEntry` to save a fact with global scope under `LLXPRT_CONFIG_HOME=<cfg>`, then `loadGlobalMemory()` returns it — the exact regression from the audit ("a memory saved through the production tool can be absent from the next session").
6. `memoryReconciliation.test.ts`: (a) `<data>/LLXPRT.md` present, `<cfg>/LLXPRT.md` absent → content appears at config path, source renamed `*.migrated-to-config`, marker written; (b) both present → config content preserved with data content appended after it, source renamed; (c) second run is a no-op; (d) unreadable source → `error: true`, no marker; (e) nothing to reconcile → no marker, no error; (f) `LLXPRT_CONFIG_HOME` set → skipped.

**GREEN:** implement AD4 exactly.

**Compatibility:** legacy `~/.llxprt` remains a read source ONLY inside `pathMigration` and the traversal-exclusion sentinel; `cli.tsx`'s failure fallback (setting `LLXPRT_CONFIG_HOME` to the legacy dir) keeps working because memory now resolves through the config category, which that fallback redirects coherently.

**Verify:** `npm run test -w packages/tools && npm run test -w packages/core && npm run test -w packages/cli && npm run typecheck`

### Phase 4 — User extensions (P3/P4, T2/T3)

**Files:**
- `packages/cli/src/config/extension.ts` (`ExtensionStorage.getUserExtensionsDir`, `loadUserExtensions`, new `loadExtensionsFromRoots` helper, comment fixes)
- `packages/cli/src/config/extensions/rootAwareResolver.ts` (roots now come from the fixed `ExtensionStorage.getUserExtensionsDir()` — verify no other home assumptions)
- `packages/a2a-server/src/config/extension.ts` (user-scope roots per AD5)
- Tests: shared setup in `packages/cli/src/config/extension.test.ts:113-127`, `extension.part2.test.ts:112-122`, `extension.part3.test.ts:114-124`, `extension.part4.test.ts:125-135`, `extension.skills.test.ts:54-65`, `extensions/update.test.ts:81-94` — introduce ONE test helper (e.g. `packages/cli/src/config/extensions/testPaths.ts` or extend the existing setup util) that sets `LLXPRT_DATA_HOME` to a temp dir and returns `<tmp>/extensions`; `packages/a2a-server/src/config/extension.test.ts:87-99,635-666`.

**RED tests:**
1. CLI: with `LLXPRT_DATA_HOME=<tmp>`, `installOrUpdateExtension` places the extension under `<tmp>/extensions/<name>` and `loadUserExtensions()` discovers it; uninstall via `resolvePhysicalRegistrationDirByIdentifier` removes from the same root.
2. CLI compat: an extension present only in `<home>/.gemini/extensions` is still discovered (compat root), and one under legacy `<home>/.llxprt/extensions` is NOT (post-migration contract).
3. CLI workspace: `<workspace>/.llxprt/extensions` continues to load when trusted; `getWorkspaceExtensions(homedir())` returns `[]`.
4. Enablement: disabling an extension writes `extension-enablement.json` under `<tmp>/extensions` and is honored by `loadExtensions`.
5. A2A: same discovery matrix (user via `LLXPRT_DATA_HOME`, `.gemini` compat, workspace precedence, `folderTrust:false` gating user-only).
6. Cross-component: the path CLI installs into equals the path A2A scans (both `Storage.getUserExtensionsDir()`), asserted by installing with the CLI helper and loading with the A2A loader in one test (place in `packages/a2a-server` test or an integration-level CLI test using the shared helper).

**GREEN:** implement AD5.

**Compatibility:** already-migrated users: startup migration copied `~/.llxprt/extensions` → `<data>/extensions`; discovery now looks exactly there. Users who installed extensions AFTER migration (into legacy via the old bug): their extension dirs remain under `~/.llxprt/extensions`; migration will NOT re-run (marker v1 present). Document remediation in `docs/extension.md` ("re-run `llxprt extensions install`" or manual copy); do NOT add a second extension-specific migration pass (low population, destructive-merge risk; explicit user action is safer).

**Verify:** `npm run test -w packages/cli && npm run test -w packages/a2a-server && npm run typecheck`

### Phase 5 — A2A settings + global .env (P1/P2, T1)

**Files:**
- `packages/a2a-server/src/config/settings.ts`
- `packages/a2a-server/src/config/config.ts` (`findEnvFile` line 338 only)
- Tests: `packages/a2a-server/src/config/settings.test.ts:25-132` (rewrite user-scope cases), plus new `.env` fallback cases in the a2a config test file.

**RED tests:**
1. With `LLXPRT_CONFIG_HOME=<tmp>` and `<tmp>/settings.json` present, `loadSettings(workspace)` returns those user settings (no `~/.llxprt` fixture involved).
2. Workspace `<ws>/.llxprt/settings.json` still overrides user values; folderTrust elevation/restriction rules unchanged (re-assert the existing matrix against the new user path).
3. `findEnvFile`: with no project `.env` anywhere and `<config>/.env` present (via `LLXPRT_CONFIG_HOME`), it is returned; a project `<ws>/.llxprt/.env` still wins; generic `~/.env` remains the last fallback.
4. Compile/API: importing `USER_SETTINGS_PATH` fails (constants removed) — adjust any test importing them.

**GREEN:** implement AD6.

**Verify:** `npm run test -w packages/a2a-server && npm run typecheck`

### Phase 6 — PromptInstaller explicit baseDir (P6, T5)

**Files:** `packages/core/src/prompt-config/prompt-installer.ts`, `packages/core/src/prompt-config/index.ts`, `packages/core/src/prompt-config/defaults/index.ts` (comment), tests `packages/core/src/prompt-config/prompt-installer.test.ts:208-215,426-430,510-514`.

**RED tests:**
1. `install(null as never, ...)` / empty-string baseDir rejects with the explicit error (assert message mentions requiring a resolved baseDir).
2. `install(<tmp>, defaults)` creates `REQUIRED_DIRECTORIES` under `<tmp>` and installs defaults there (real FS in temp dir).
3. `uninstall`/`validateInstallation` against `<tmp>` behave as before with explicit dir; remove assertions on `.llxprt/prompts`.
4. Existing `PromptService` behavior tests still green (service supplies `<config>/prompts`).

**GREEN:** implement AD7.

**Verify:** `npm run test -w packages/core && npm run typecheck`

### Phase 7 — Maintainer/verification scripts (G1–G5)

**Files:** `scripts/telemetry_utils.js`; DELETE `scripts/verify-oauth-integration.sh`; `shell-scripts/cache-baseline-test.sh`; `shell-scripts/codex-call.sh`; `shell-scripts/codex-models.sh`; `shell-scripts/codex-oauth.sh`; `shell-scripts/issue489-acceptance-test.sh`.

These are not vitest-covered; verification is behavioral-by-command (run each, assert no legacy dir creation):

```bash
node -e "const {OTEL_DIR}=await import('./scripts/telemetry_utils.js');console.log(OTEL_DIR)"   # must print a log-category path; repeat with LLXPRT_LOG_HOME=/tmp/x
HOME=$(mktemp -d) bash -n shell-scripts/cache-baseline-test.sh                                  # syntax check
HOME=$(mktemp -d) LLXPRT_LOG_HOME=/tmp/llx-log bash shell-scripts/cache-baseline-test.sh --dry-run 2>/dev/null || true
test ! -e "$HOME/.llxprt"   # inside a faked-HOME run of each script's path-resolution preamble
grep -rn 'HOME}/.llxprt\|HOME/.llxprt\|~/.llxprt' scripts/ shell-scripts/ | grep -v node_modules   # expect zero active hits
```

(If `telemetry_utils.js` is CJS, use `require` in the probe; match the file's current module style when editing.) The Phase 10 guard also covers these trees permanently.

**GREEN:** implement AD8. Preserve each script's existing CLI arguments and outputs otherwise.

### Phase 8 — Generated help/schema/API text + test-double hygiene (D9, T6-remainder, T7)

**Files:**
- `packages/cli/src/config/settingsSchema.ts:177-185` → `'Reference to a saved profile name (profiles live in the LLxprt config directory).'`
- `packages/cli/src/config/yargsOptions.ts:224-227` → `'Load a sandbox profile from the sandboxes directory in your LLxprt config directory (<config>/sandboxes/<name>.json).'`; `:347-350` → `'Dump request body to the dumps directory in your LLxprt cache directory on API errors.'`
- `packages/settings/src/settings/registry/registry-entries-2.ts:167-175,240-245` → same category-neutral phrasing (dumps → cache; tool prompts → `<config>/prompts/tools/**`).
- Regenerate `schemas/settings.schema.json`: `npm run schema:settings` (never hand-edit).
- `packages/agents/src/api/control/authState.ts:19-23`, `packages/agents/src/app-services/profiles.ts:11-15`, `packages/agents/src/tools/task.ts:745-750` → replace `~/.llxprt/...` with category phrasing ("the configured subagents directory", "provider-keys under the LLxprt data directory / OS keychain").
- `packages/core/src/config/subagentManager.ts:52-70`, `packages/core/src/config/types.ts:1-12` → comment updates (config-category subagents/profiles).
- DELETE `packages/providers/src/auth/migration.ts` (dead export advertising obsolete `~/.llxprt/oauth/*.json` as "standardized"; zero call sites — remove its export from any index barrel and its test file if one exists).
- T7 fixes: `packages/cli/src/config/logging/loggingConfig.test.ts:14-39,377-378` — test the REAL production config default (or an injected temp path) instead of a self-invented `MockExtendedConfig` with a legacy default; `packages/core/src/policy/persistence.test.ts:541-550` — rename the case to describe `Storage.getUserPoliciesDir()` and use a neutral injected temp path, not a `~/.llxprt` label.

**RED tests:**
1. New micro behavior test (cli): the yargs help text for `sandbox-profile-load` and `dumponerror` does not contain `~/.llxprt` (string assertion on the exported options object — real object, no mocks).
2. Schema check: after regeneration, `grep -c '~/.llxprt' schemas/settings.schema.json` returns 0 (encode as a unit test reading the JSON, or fold into the Phase 10 guard scan of `schemas/`).
3. Reworked loggingConfig/persistence tests fail against current stale text first where applicable.

**Verify:** `npm run schema:settings && git diff --stat schemas/ && npm run test -w packages/cli -w packages/core -w packages/settings -w packages/agents -w packages/providers && npm run typecheck`

### Phase 9 — Documentation (D1–D8)

1. **NEW central reference `docs/reference/application-directories.md`:** the four-category table (mirroring `storage.ts` doc comments verbatim for Linux/macOS/Windows), override precedence (`LLXPRT_CONFIG_HOME`, `LLXPRT_DATA_HOME`, `LLXPRT_CACHE_HOME`, `LLXPRT_LOG_HOME`, compat fallbacks), workspace-local `.llxprt` scope, the legacy `~/.llxprt` migration story (input only; removal note printed by migration), OAuth storage (keyring primary, encrypted fallback `<data>/secure-store/llxprt-code-oauth`, locks `<log>/oauth/locks`), and a shell snippet to print effective paths (e.g. `node -p "require('env-paths')('llxprt-code',{suffix:''})"` plus the override note). Link it from `docs/index.md` §Reference (after line 80).
2. **Sweep every maintained-doc citation in the audit inventory table** (`research/wrongpaths.md` §"Maintained-document citation inventory": 44 files with exact lines — treat that table as the authoritative checklist; check each line off). Rules: user-editable artifacts → config phrasing + link to the reference page; conversations/history/extensions/credential-fallback → data; dumps → cache; debug/tmp/checkpoints/locks → log/state; keep `<project>/.llxprt/...` examples; never publish `rm ~/.llxprt/...` as canonical cleanup; D7: Windows secure-store paths corrected to `%LOCALAPPDATA%\llxprt-code\Data\secure-store\...`; D8: rewrite `docs/gemini-cli-tips.md:90-100` linking as a one-time legacy-import technique; D5: rewrite `docs/tools/memory.md` after Phase 3 lands (global = `<config>/LLXPRT.md`, `<config>/.LLXPRT_SYSTEM`; project rows unchanged; explicit legacy-import note).
3. Historical documents (`docs/plans/`, `project-plans/`, release notes, `dev-docs/cherrypicking.md`'s historical narrative EXCEPT its line 96 active guidance, which the audit lists — fix that line) are NOT rewritten.

**Verification:** run the Phase 10 guard over `docs/` + `dev-docs/`; manually spot-check `docs/cli/configuration.md:29,1651,1657` (highest-impact file). `npm run format` (prettier covers markdown).

### Phase 10 — Guard, allowlist, fresh audit, full gate

**Guard `scripts/check-legacy-paths.ts`** (TypeScript, run with bun like `check-cli-import-boundary.ts`):

- **Patterns (regex, case-sensitive):** `~/.llxprt`, `$HOME/.llxprt`, `${HOME}/.llxprt`, `%USERPROFILE%\.llxprt`, `homedir()` joined with `'.llxprt'`/`LLXPRT_DIR`/`LLXPRT_CONFIG_DIR` (single-line heuristic: `homedir\(\)[^\n]{0,80}(\.llxprt|LLXPRT_DIR|LLXPRT_CONFIG_DIR)` and the reverse order), and `os.homedir(), LLXPRT_DIR`-style `path.join` forms.
- **Scanned trees:** `packages/*/src/**` (excluding `**/*.test.ts`, `**/*.spec.ts`, `**/__tests__/**`, `**/test-utils/**`), `scripts/**`, `shell-scripts/**`, `docs/**`, `dev-docs/**`, `schemas/**`, root `README.md`/`CONTRIBUTING.md`.
- **Hard-excluded trees:** `docs/plans/**`, `docs/release-notes/**`, `docs/merge-notes/**`, `project-plans/**`, `research/**`, `packages/core/analysis/**`, `CHANGELOG.md`, `.llxprt/**`, `node_modules`, `dist`, `bundle`.
- **Allowlist file `scripts/legacy-path-allowlist.json`:** array of `{ "path": string, "pattern"?: string, "reason": string }`. Seed entries (each with a reason string naming the contract):
  - `packages/storage/src/config/storage.ts` (defines `getLegacyLlxprtDir` — migration-only helper),
  - `packages/cli/src/config/pathMigration.ts`, `packages/cli/src/config/legacyCopyEngine.ts`, `packages/cli/src/config/legacyProfileNormalization.ts`, `packages/cli/src/config/memoryReconciliation.ts`, `packages/cli/src/cli.tsx` (migration orchestration/fallback),
  - `packages/core/src/code_assist/oauth-credential-storage.ts` (legacy credential migration probe),
  - `packages/core/src/utils/memoryDiscovery.ts` (legacy-exclusion sentinel lines only — prefer a `pattern` scoped entry),
  - `docs/reference/application-directories.md`, `docs/oauth-setup.md`, `docs/troubleshooting.md`, `docs/gemini-cli-tips.md`, `docs/tools/memory.md` (each explains the legacy path as migration input — scope with `pattern` where possible),
  - `CONTRIBUTING.md` (repo-local `.llxprt/` references are workspace-scope; note that workspace-relative matches shouldn't trigger anyway).
- Exit non-zero listing file:line:match for violations; print the allowlist reason when suppressing.
- **Wiring:** `package.json` → `"lint:legacy-paths": "bun scripts/check-legacy-paths.ts"`; add to `.github/workflows/ci.yml` beside `npm run lint:cli-boundary` (line ~265) and to `scripts/lint-all.sh`.
- **Guard self-test:** `scripts/tests/` (or wherever `npm run test:scripts` collects — mirror an existing check-script test if present; otherwise a fixture-driven invocation in the script's `--self-test` mode) proving: a home-anchored hit fails; a workspace-relative `.llxprt/settings.json` string passes; an allowlisted file passes with reason logged.

**Fresh whole-repo audit (manual, recorded in the PR description):** re-run the audit's search methodology and confirm every hit is allowlisted/intentional:

```bash
grep -rn --exclude-dir={node_modules,dist,bundle,.git,.llxprt} -E '(~|\$HOME|\$\{HOME\})/\.llxprt' . | grep -vE 'project-plans/|docs/plans/|docs/release-notes/|docs/merge-notes/|research/|analysis/|CHANGELOG'
grep -rn --include='*.ts' -E "homedir\(\).{0,80}(\.llxprt|LLXPRT_DIR)" packages/*/src | grep -v test | grep -v __tests__
npm run lint:legacy-paths
```

**Full gate (must all pass):**

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus a manual migration smoke: with `HOME` pointed at a fixture containing a populated `~/.llxprt` and empty XDG dirs, run the CLI once; assert config/data/cache/log dirs are populated per category, memory loads, and a second run is a no-op (`.migration-complete.json`, `.memory-reconcile-complete.json` honored).

---

## 4. Phase ordering & dependency notes

1 (storage foundation) → 2 (locks; needs `getOAuthLocksDir`) → 3 (memory; needs `getGlobalMemoryDir`) → 4 (extensions; needs `getUserExtensionsDir`) → 5 (A2A settings/env; independent of 3–4 but after 1) → 6 (prompt installer; independent, after 1) → 7 (scripts) → 8 (generated text/schema) → 9 (docs; after all behavior is final) → 10 (guard + audit + gate). Phases 5–7 may be parallelized by independent implementers; 8–10 are strictly last. Commit per phase with tests + implementation together (RULES.md).

---

## 5. Risks and ambiguities for the implementer to validate

1. **Memory reconciliation merge semantics (highest risk):** appending `<data>/LLXPRT.md` onto `<config>/LLXPRT.md` can duplicate facts if the same content exists in both. Acceptable (non-destructive) per AD4; if trivial, dedupe exact duplicate `- ` bullet lines inside the `## LLxprt Code Added Memories` section during append — but never drop non-identical content. Validate against a fixture captured from a real post-migration split.
2. **Custom `contextFileName` users:** reconciliation covers default filenames only (settings are not yet loaded at migration time). Documented limitation; confirm no test asserts otherwise.
3. **`IStorageService.getLLXPRTDir` rename:** it is exported from `@vybestack/llxprt-code-tools`; confirm via `grep -rn "getLLXPRTDir" packages --include="*.ts"` that no consumer outside `memoryTool.ts`/adapter/tests remains (verified at plan time). If an external-compat concern surfaces, keep a deprecated alias method delegating to the new name for one release.
4. **Upward-traversal edge cases (memoryDiscovery):** running the CLI with cwd inside `~/.llxprt` or inside the config dir; ensure exclusions don't hide genuinely workspace-local files in those unusual roots. Add targeted tests if behavior is ambiguous.
5. **Extension post-migration stragglers:** extensions installed into legacy after marker v1 (via the old bug) are NOT auto-recovered (AD5 compatibility note). Confirm docs remediation text; reconsider only if user reports demand an extensions-specific reconcile pass.
6. **Lock relocation upgrade window:** transient dual-lock possibility across versions (AD3). No code action; ensure the PR description mentions it.
7. **A2A `bun test` runner:** `packages/a2a-server` uses `bun test` (not vitest); write its new tests in the package's existing style/harness (check neighboring tests for `describe/it` + homedir/env fixtures before writing).
8. **Env-override save/restore discipline:** every new test touching `LLXPRT_*_HOME` must snapshot and restore `process.env` (pattern in `storage.test.ts`); leakage will destabilize unrelated suites, especially ones relying on the `LLXPRT_CONFIG_HOME` migration skip.
9. **Guard false positives:** docs legitimately mention `~/.llxprt` when explaining migration. Prefer `pattern`-scoped allowlist entries over whole-file entries so new stale guidance in those files still fails.
10. **`schemas/settings.schema.json` regeneration drift:** the generator may reformat unrelated entries; commit the full regenerated file and eyeball the diff for accidental semantic changes.
11. **`getGlobalLlxprtDir()` deprecated alias (storage.ts:152-160):** it aliases config and is marked deprecated. This plan leaves it (removal is out of scope); confirm no NEW usage is introduced, and the guard does not need to track it (it resolves canonically).
