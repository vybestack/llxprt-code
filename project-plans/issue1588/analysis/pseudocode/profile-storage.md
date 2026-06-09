# Pseudocode: Profile And Storage Migration

Plan ID: PLAN-20260608-ISSUE1588

## Interface Contracts

Inputs:

- Profile names
- `SettingsService` instances
- Existing profile JSON files under `~/.llxprt/profiles`
- Existing storage path helper callers in core, providers, CLI
- Final-architecture.md Storage seam and LLXPRT_DIR resolution decisions

Outputs:

- Same profile JSON files and data
- Same storage paths (`~/.llxprt` not `~/.claude`)
- No settings-to-core import
- `Storage` class with `// @storage-seam` marker for future extraction

## Numbered Pseudocode

01: READ current `modelParams.ts` profile-related exports — all 13 symbols: `AuthConfig`, `AuthConfigSchema`, `ModelParams`, `EphemeralSettings`, `LoadBalancerSubProfileConfig`, `LoadBalancerConfig`, `StandardProfile`, `LoadBalancerProfile`, `Profile`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`
02: MOVE ALL symbols from `modelParams.ts` to settings package profile types module (`packages/settings/src/profiles/types.ts`)
03: INCLUDE all 13 symbols listed in line 01 — no symbols remain in core
04: DELETE `packages/core/src/types/modelParams.ts` entirely — no symbols remain in core, no compatibility shim
05: REMOVE core index re-export of `./types/modelParams.js`
06: REMOVE core `package.json` subpath export `./types/modelParams.js` if present
07: UPDATE core/providers/CLI consumers of moved profile types to import from `@vybestack/llxprt-code-settings` root or `@vybestack/llxprt-code-settings/profiles/types.js`
08: MOVE `Storage` class to `packages/settings/src/storage/Storage.ts` with `// @storage-seam: This module is a candidate for future extraction to packages/storage` marker
09: PRESERVE every static method signature and path result — `getGlobalLlxprtDir()`, `getMcpOAuthTokensPath()`, `getGlobalSettingsPath()`, `getInstallationIdPath()`, `getProviderAccountsPath()`, `getGoogleAccountsPath()`, `getUserCommandsDir()`, `getUserSkillsDir()`, `getGlobalMemoryFilePath()`, `getUserPoliciesDir()`, `getSystemSettingsPath()`, `getSystemPoliciesDir()`, `getGlobalTempDir()`, instance `getLlxprtDir()`, `getProjectTempDir()`, `ensureProjectTempDirExists()`, `getProjectRoot()`, `getHistoryDir()`, `getWorkspaceSettingsPath()`, `getProjectCommandsDir()`, `getProjectSkillsDir()`, `getProjectTempCheckpointsDir()`, `getExtensionsDir()`, `getExtensionsConfigPath()`, `getHistoryFilePath()`
10: PRESERVE `LLXPRT_DIR = '.llxprt'` constant — moves with Storage, NOT imported from core/tools
11: MOVE `Storage` tests to `packages/settings/src/storage/__tests__/Storage.test.ts`
12: UPDATE Storage tests to assert `~/.llxprt` paths, NOT `~/.claude`
13: ADD `Storage` and `LLXPRT_DIR` to settings package public API exports in `src/index.ts`
14: MOVE `ProfileManager` to `packages/settings/src/profiles/ProfileManager.ts`
15: UPDATE `ProfileManager` imports to settings-owned `SettingsService`, `Storage`, and profile types — all from local settings package paths
16: UPDATE core internal `ProfileManager` consumers: `subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts`, `configBaseCore.ts` — change relative imports to settings package import
17: PRESERVE `saveProfile` behavior for standard profiles — saves `Profile` JSON to `~/.llxprt/profiles/<name>.json`
18: PRESERVE `saveLoadBalancerProfile` behavior for load balancer profiles — validates version, referenced profiles, and no LB-to-LB references
19: PRESERVE `loadProfile` — reads from `~/.llxprt/profiles/<name>.json`, validates required fields, rejects LB-to-LB references recursively
20: PRESERVE `listProfiles`, `deleteProfile`, `profileExists` behaviors unchanged
21: PRESERVE `save` method exporting current `SettingsService` state into a profile
22: PRESERVE `load` method importing profile data into `SettingsService`
23: USE temp filesystem/home isolation in tests rather than real user files — mock `os.homedir()` in tests
24: ASSERT saved JSON content equals current expected profile shape
25: ASSERT loading profile applies provider, model, model params, and ephemeral settings
26: VERIFY `LLXPRT_DIR` constant equals `'.llxprt'` without importing from core/tools — `configBaseCore.ts` defines its own local constant
27: MOVE `ProfileManager` tests to `packages/settings/src/profiles/__tests__/ProfileManager.test.ts`
28: UPDATE `ProfileManager` test imports to settings-package local paths
29: VERIFY `Storage.ts` has no imports from `SettingsService`, `ProfileManager`, or `settingsRegistry` — Storage uses only `path`, `os`, `fs`, `crypto` from Node.js built-ins
30: VERIFY `ProfileManager.ts` imports `SettingsService` from local settings path, not from core
31: RUN scans for core relative ProfileManager imports: `rg -n "from.*config/profileManager" packages/core/src` — must be zero after migration
32: RUN scans for core modelParams type imports: `rg -n "modelParams" packages/core/src/index.ts packages/core/package.json` — must be zero after migration
33: RUN scans for core Storage relative imports: `rg -n "from.*config/storage" packages/core/src` — must be zero after migration
34: RUN settings profile/storage tests
35: RETURN profile/storage extraction complete

## Anti-Pattern Warnings

- DO NOT change profiles path to `~/.claude/profiles`. The path is `~/.llxprt/profiles` and stays that way.
- DO NOT move `ProfileManager` while importing profile types from core. All profile types must be in `packages/settings/src/profiles/types.ts` before or concurrent with `ProfileManager` move.
- DO NOT omit `save` and `load`; CodeRabbit's method list was incomplete. Full method list: `saveProfile`, `saveLoadBalancerProfile`, `loadProfile`, `listProfiles`, `deleteProfile`, `profileExists`, `save`, `load`.
- DO NOT create a new `packages/storage` unless the plan is explicitly re-scoped. Storage stays as an internal module of settings with `// @storage-seam` marker.
- DO NOT import `LLXPRT_DIR` from `memoryTool.ts` or `configBaseCore.ts` inside `Storage.ts`. `Storage.ts` defines its own `LLXPRT_DIR = '.llxprt'` constant.
- DO NOT import `SettingsService` from core inside `Storage.ts`. Storage is self-contained and uses only Node.js built-in modules.
- DO NOT leave `modelParams.ts` as a shim (re-exporting from settings). Delete it entirely in P09.
- DO NOT leave core re-exports of any moved profile/model type symbols. Remove all re-exports from `packages/core/src/index.ts` and remove `./types/modelParams.js` subpath export from core `package.json`.
- RUNTIME ISOLATION: `Storage.ts` has zero imports from any settings service, registry, or profile code — it uses only Node.js built-ins (`path`, `os`, `fs`, `crypto`). This independence makes future extraction to `packages/storage` clean. `ProfileManager.ts` imports `SettingsService` from settings-package local path (same package, acceptable). Neither `Storage.ts` nor `ProfileManager.ts` import from core runtime context or provider types.
