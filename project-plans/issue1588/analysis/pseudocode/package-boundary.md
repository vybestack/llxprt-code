# Pseudocode: Package Boundary

Plan ID: PLAN-20260608-ISSUE1588

## Interface Contracts

Inputs:

- Current root workspace package metadata
- Existing package conventions from `packages/providers`
- Moved settings/profile/storage source files
- Final-architecture.md dependency direction rules

Outputs:

- `packages/settings` workspace package
- Package exports and TypeScript references
- No settings package dependency on core/providers/cli/tools

## Numbered Pseudocode

01: READ root `package.json` workspace list
02: ASSERT `packages/settings` is absent before scaffold or already matches planned metadata
03: READ `packages/providers/package.json`, `tsconfig.json`, and `vitest.config.ts`
04: CREATE `packages/settings/package.json` using provider package conventions — name `@vybestack/llxprt-code-settings`, `type: "module"`, `main: "dist/index.js"`, `types: "dist/index.d.ts"`, `exports` with `{types, import}` objects for root and all subpaths (`./settings/SettingsService.js`, `./settings/settingsServiceInstance.js`, `./settings/settingsRegistry.js`, `./profiles/ProfileManager.js`, `./profiles/types.js`, `./storage/Storage.js`), `files: ["dist"]`, scripts matching providers (`build`, `lint`, `format`, `test`, `test:ci`, `typecheck`)
05: VERIFY `package.json` exports map uses `{types, import}` objects consistently for ALL subpath exports — run verification: `node -e "const p=require('./packages/settings/package.json'); for (const [k,v] of Object.entries(p.exports)) { if (typeof v === 'string') { console.error('FAIL: bare string export for', k); process.exit(1); } } console.log('OK: all exports use {types, import} objects');"`
06: SUBPATH exports use `dist/src/...` paths matching providers build convention (e.g., `"./settings/SettingsService.js": "./dist/src/settings/SettingsService.js"`)
07: VERIFY production dependencies include `zod` (verified required by `AuthConfigSchema` in `modelParams.ts`). Other dependencies only if preflight scan-plus-metadata assertion proves they are required
08: VERIFY `devDependencies` has no forbidden workspace packages (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-a2a-server`)
09: CREATE `packages/settings/tsconfig.json` extending root config — `outDir: "dist"`, `tsBuildInfoFile: "../../node_modules/.cache/tsbuildinfo/settings.tsbuildinfo"`, no references to core/providers/cli, `include` for `index.ts` and `src/**/*.ts`
10: ASSERT `packages/settings/tsconfig.json` has no references to core/providers/cli
11: CREATE `packages/settings/vitest.config.ts` with recursive test discovery (`src/**/__tests__/**`) and workspace alias handling for `@vybestack/llxprt-code-settings` self-resolution, following providers vitest config pattern
12: CREATE `packages/settings/index.ts` that re-exports `./src/index.js`
13: CREATE `packages/settings/src/index.ts` as package public API barrel, exporting `SettingsService`, `ISettingsService`, `GlobalSettings`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `SettingsChangeEvent`, `EventListener`, `EventUnsubscribe`, `DiagnosticsInfo`, `SettingsTelemetrySettings`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `ProfileManager`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `AuthConfig`, `AuthConfigSchema`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`, `Storage`, `LLXPRT_DIR`
14: CREATE `packages/settings/src/settings/SettingsService.ts` — moved from core
15: CREATE `packages/settings/src/settings/settingsServiceInstance.ts` — rewritten for settings-owned state
16: CREATE `packages/settings/src/settings/settingsRegistry.ts` — moved, with settings-owned compression strategy values
17: CREATE `packages/settings/src/types.ts` — moved from core settings types
18: CREATE `packages/settings/src/profiles/ProfileManager.ts` — moved from core config
19: CREATE `packages/settings/src/profiles/types.ts` — all symbols from `modelParams.ts` moved here
20: CREATE `packages/settings/src/storage/Storage.ts` — moved from core config, with `// @storage-seam: This module is a candidate for future extraction to packages/storage` marker
21: CREATE `packages/settings/src/profiles/__tests__/` directory for test discovery
22: CREATE `packages/settings/src/storage/__tests__/` directory for test discovery
23: CREATE `packages/settings/src/settings/__tests__/` directory for test discovery
24: ADD `packages/settings` to root `package.json` workspaces — INSERT `packages/settings` BEFORE `packages/core` in the workspaces array to ensure settings builds first
25: RUN `npm install` to update workspace metadata; VERIFY no `pnpm-lock.yaml` created
26: ADD `@vybestack/llxprt-code-settings` dependency to consumers that import it directly (core AND providers) — `"@vybestack/llxprt-code-settings": "file:../settings"` in `dependencies`
27: ADD TypeScript project references in consumers where current package conventions require them
28: ADD tsconfig.json `paths` aliases for `@vybestack/llxprt-code-settings` and `@vybestack/llxprt-code-settings/*` in downstream packages (providers, core, CLI — all in P03b)
29: ADD vitest workspace source alias plugin entries for settings in downstream packages with custom alias plugins (e.g., providers/vitest.config.ts, core/vitest.config.ts, cli/vitest.config.ts — in P03b)
30: VERIFY settings package builds before core: run `npm run build --workspace @vybestack/llxprt-code-settings` then verify core build succeeds
31: VERIFY `zod` is listed as a production dependency (`node -e "const p=require('./packages/settings/package.json'); if (!(p.dependencies||{})['zod']) { console.error('FAIL: zod missing'); process.exit(1); }"`)
32: VERIFY root `predocs:settings`, `schema:settings`, `docs:settings` scripts still work if they exist
33: VERIFY no `pnpm-lock.yaml` was created
34: RUN forbidden import/dep checks: settings source must not import core/providers/cli/tools/a2a-server; settings package.json must not list forbidden deps in dependencies OR devDependencies
35: RUN forbidden settings-to-core import scan: `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts'` must return zero matches
36: RUN package boundary dependency graph check using Node.js JSON parsing (not regex) for exact field comparison
37: IF settings package depends on core/providers/cli/tools THEN FAIL
38: IF core depends on providers as part of this work THEN FAIL
39: RETURN package boundary ready

## Anti-Pattern Warnings

- DO NOT name the package `@anthropic/claude-code-settings`. Use `@vybestack/llxprt-code-settings`.
- DO NOT add a dependency on nonexistent `packages/storage`. Storage stays as an internal module of settings with seam marker.
- DO NOT make `packages/settings` import `@vybestack/llxprt-code-core` — forbidden production dependency per final-architecture.md and package-metadata-constraints.md.
- DO NOT make `packages/settings` import `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-tools`, or `@vybestack/llxprt-code-a2a-server` — not even as devDependencies.
- DO NOT create core wrapper exports to preserve old import paths — those are forbidden compatibility shims per anti-shim-policy.md.
- DO NOT use bare string exports in `package.json` exports map — all exports must use `{types, import}` objects per providers precedent.
- RUNTIME ISOLATION: Settings package MUST NOT import or reference core runtime context (`providerRuntimeContext`). The `ProviderRuntimeSettingsService` structural interface lives in core, not settings. Settings-package singleton functions (`registerSettingsService`, `getSettingsService`, `resetSettingsService`) manage settings-package-owned state only — no `ProviderRuntimeContext` creation, no core side effects.
