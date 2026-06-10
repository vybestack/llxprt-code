# project-plans/issue1588/execution-tracker.md

Plan ID: PLAN-20260608-ISSUE1588

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 0.5 | P0.5 | [ ] | - | - | - | N/A | Preflight verification before implementation |
| 01 | P01 | [ ] | - | - | - | [ ] | Dependency/domain analysis and move classification |
| 01a | P01a | [ ] | - | - | - | [ ] | Analysis verification |
| 02 | P02 | [ ] | - | - | - | [ ] | Contract-first pseudocode |
| 02a | P02a | [ ] | - | - | - | [ ] | Pseudocode verification |
| 02b | P02b | [ ] | - | - | - | [ ] | Integration contract definition |
| 02c | P02c | [ ] | - | - | - | [ ] | Integration contract verification |
| 03 | P03 | [ ] | - | - | - | [ ] | Decoupling Stubs and Settings-Owned Type Boundaries |
| 03a | P03a | [ ] | - | - | - | [ ] | Decoupling Stub Verification |
| 03b | P03b | [ ] | - | - | - | [ ] | Transparent No-Op Adapter and Config Wiring (no production code changes) |
| 03c | P03c | [ ] | - | - | - | [ ] | Transparent no-op adapter verification |
| 04 | P04 | [ ] | - | - | - | [ ] | Settings package behavioral and boundary tests |
| 04a | P04a | [ ] | - | - | - | [ ] | Settings package TDD verification |
| 04b | P04b | [ ] | - | - | - | [ ] | Vertical-slice integration TDD (**core only**; provider/CLI deferred to P07) |
| 04c | P04c | [ ] | - | - | - | [ ] | Vertical-slice integration TDD verification (core only) |
| 05 | P05 | [ ] | - | - | - | [ ] | Settings package implementation and code moves |
| 05a | P05a | [ ] | - | - | - | [ ] | Settings package implementation verification (P04b core pass gate NOT run here — deferred to P06a) |
| 06 | P06 | [ ] | - | - | - | [ ] | Core Runtime/Config Implementation |
| 06a | P06a | [ ] | - | - | - | [ ] | Core Integration Implementation Verification (includes P04b pass gate) |
| 07 | P07 | [ ] | - | - | - | [ ] | Consumer migration integration tests |
| 07a | P07a | [ ] | - | - | - | [ ] | Consumer migration TDD verification |
| 08 | P08 | [ ] | - | - | - | [ ] | Consumer migration implementation (requires refreshed import inventory first) |
| 08a | P08a | [ ] | - | - | - | [ ] | Consumer migration implementation verification (P04b core pass gate + P07 provider/CLI pass gates) |
| 09 | P09 | [ ] | - | - | - | [ ] | Cleanup and no-shim removal |
| 09a | P09a | [ ] | - | - | - | [ ] | Cleanup semantic verification |
| 10 | P10 | [ ] | - | - | - | [ ] | Full repository verification suite |
| 10a | P10a | [ ] | - | - | - | [ ] | Final semantic review |

## Completion Markers

- [ ] All phases that change `packages/**` have `@plan` markers in changed code/tests
- [ ] All implemented requirements have `@requirement` markers
- [ ] Preflight results populated before P03
- [ ] No phases skipped
- [ ] Integration contracts verified before implementation
- [ ] Package dependency scans prove no cycle
- [ ] No core-to-settings compatibility shims remain
- [ ] Settings package tests do not import consumer packages (not even dev-only)
- [ ] Settings package tests verify ONLY settings-owned state (no core ProviderRuntimeContext assertions)
- [ ] Integration tests for core/providers/CLI consumption paths live in owning consumer packages
- [ ] Core-owned `settingsRuntimeAdapter.ts` provides `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext` with idempotency and single-owner semantics
- [ ] Adapter idempotency and call-count tests pass
- [ ] Single-owner scan: only `settingsRuntimeAdapter.ts` bridges both settings and runtime context calls
- [ ] `providerRuntimeContext.ts` does NOT import or call settings-package singleton functions
- [ ] Adapter permitted bridge scan passes (see `analysis/call-site-migration-matrix.md` for bridge classification)
- [ ] Call-site migration matrix in `analysis/call-site-migration-matrix.md` followed during P06/P08
- [ ] Settings package `package.json` includes mandatory subpath exports (`dist/src/...` paths matching providers build convention)
- [ ] Built-runtime ESM dynamic import verification passes for all documented exports
- [ ] P04b integration tests pass after P06a and P08a (pass gates) — P04b core test in P06a and P08a; P07 provider/CLI tests in P08a only
- [ ] Each P04b/P07 vertical-slice test names exact production entrypoint/import path and requires failure when consumer wiring is absent
- [ ] Providers and CLI have settings path aliases and dependencies before P04b/P07 (set in P03b)
- [ ] TypeScript path alias strategy standardized: root alias resolves to `../settings/index.ts` (source entrypoint), wildcard to `../settings/src/*` — consistent across core, providers, CLI
- [ ] CLI `vitest.config.ts` has settings root and subpath aliases that resolve to source (not stale dist)
- [ ] Refreshed full import inventory (including providers deep imports and all workspaces including `packages/lsp`) completed before P08
- [ ] P04b/P07 expected-failure output assertions prove behavioral/stub failures, not module resolution errors
- [ ] Settings package source layout consistent: `src/settings/SettingsService.ts` (not `src/SettingsService.ts`)
- [ ] P05 prerequisite: "Phase 04b verified" (P04b not P04ba)
- [ ] Schema/docs verification runs after any phase touching CLI schema imports or aliases (not only P10)
- [ ] No pnpm-lock.yaml created at any phase; package-lock.json present after workspace/dependency changes
- [ ] STUB/fraud scan returns zero in production source after P06
- [ ] Workspace test commands use workspace-relative paths (not root-absolute paths)
- [ ] Settings package test command runs nested profiles/storage tests (not just `src/__tests__`)
- [ ] Extended settings boundary checks scan all `packages/settings/**/*.ts(x)`, `package.json` (dependencies + devDependencies), `tsconfig.json`, `vitest.config.ts`
- [ ] `scripts/check-settings-boundary.js` exists, implements all 12 checks from `analysis/boundary-verification-script.md`, runs successfully (exits 0), and includes `LoadBalancerConfig`/`LoadBalancerSubProfileConfig` in root-barrel moved-symbol scan (check 8).
- [ ] P03 scaffold checklist fulfilled: package.json, tsconfig, index, src layout (including `src/index.ts` public API barrel), vitest config, workspace registration, exports, compilation, test command, forbidden dep/import checks, `scripts/check-settings-boundary.js` creation and verification
- [ ] `.llxprt/` directory unchanged throughout
- [ ] Temporary duplicate policy followed: no shims/forwarding from core to settings during P05-P08
- [ ] Root build ordering verified: settings builds before core/providers/CLI
- [ ] Profile/storage tests use real temp filesystem directories, not mock-only tests
- [ ] `npm run format` completion records resulting `git status --short` and `git diff --stat` output
- [ ] All rg scan commands for forbidden imports use `rg -n` capture-and-check-empty or `rg -q` fail/pass patterns (not `rg -c`). All `rg -c` instances replaced with `rg -n`.
- [ ] Built-runtime dynamic import verification requires `npm install` + workspace resolution + `npm run build` before running, and validates package exports against actual `package.json` export map and built files
- [ ] P04b integration test exercises `activateSettingsRuntimeContext` adapter path, not `configConstructor → registerSettingsService` (P03b does not wire configConstructor)
- [ ] P07 provider sentinel test uses settings-only sentinel mechanism, not old core singleton setup; post-P08 static import verification confirms `BaseProvider` imports `getSettingsService` from settings
- [ ] P07 CLI vertical-slice test: precise in-package temp-filesystem profile load test through CLI-owned import path, OR documented limitation with static import guards for `ProfileManager` and `Storage` CLI imports (not just smoke test)
- [ ] Unified settings boundary check script covers `packages/settings/**/*.ts(x)`, `package.json` (deps + devDeps), `tsconfig.json`, `vitest.config.ts` — reusable in all verification phases
- [ ] Settings `package.json` export map inlined in P03; every built export file verified to exist after build
- [ ] Symbol-by-symbol move map from `modelParams.ts` to settings destinations documented in analysis/settings-move-map.md
- [ ] P09 verifies `modelParams.ts` deletion, no core re-exports, and built-runtime dynamic import verification of all moved symbols
- [ ] Internal storage seam: `packages/settings/src/storage/Storage.ts` has no cross-module dependency on settings service/profile; future extraction documented
- [ ] `plan-marker` guidance for copied legacy code avoids noisy marker churn in unchanged methods
- [ ] Preflight records exact current `COMPRESSION_STRATEGIES` values from `packages/core/src/core/compression/types.ts` and registry tests assert them as literal strings without importing core compression
- [ ] P03 `passWithNoTests: true` required in settings vitest config (empty suite at P03 does not cause nonzero exit)
- [ ] CLI settingsSchema import guard: settings package does NOT import CLI settingsSchema; schema/docs scripts stay CLI-owned
- [ ] a2a-server dependency verified with actual scan/output at preflight and P08 (not just assumed)
- [ ] Package metadata checks use exact JSON dependency checks (Node.js require for local metadata reads) not regex-only patterns
- [ ] `predocs:settings` script updated to build settings before core (or uses full build) when core depends on settings
- [ ] Providers and CLI tsconfig include/references updated for settings source resolution in P03b (not just path aliases)
- [ ] Settings `vitest.config.ts` includes `passWithNoTests: true` so empty suite at P03 does not cause nonzero exit
- [ ] No CLI `settingsSchema` import guard in settings package (schema/docs scripts stay CLI-owned)
- [ ] a2a-server dependency verified with actual scan output confirming no direct settings imports needed
- [ ] Package metadata checks use exact JSON dependency checks (Node.js require) not regex-only
- [ ] Root build ordering: `packages/settings` inserted before `packages/core` in workspaces array, OR `scripts/build.js` modified; `predocs:settings` builds settings before core
- [ ] Providers/CLI tsconfig `include`/`references` updated for settings source resolution; CLI has `references: [{ path: "../settings" }]`
- [ ] Phase numbering uses clear sub-phase IDs; P06 named "Core Runtime/Config Implementation" not "Stubs"
- [ ] Call-site migration matrix marked as lifecycle-only scope; full import inventory completed before P08
- [ ] P04b core integration test pass gate NOT run in P05a (deferred to P06a after adapter implementation)
- [ ] P04b core test targets adapter contract directly (activateSettingsRuntimeContext → adapter → settings), NOT configConstructor production wiring
- [ ] Adapter bridge scan uses enforcing script logic (capture-and-check-empty), not prose/grep with manual inspection
- [ ] CLI vitest.config.ts alias uses workspaceAliasPlugin pattern with resolveTsSource, matching providers/core precedent
- [ ] Root build ordering verified with scripts/build.js inspection; settings builds before core/providers/CLI
- [ ] All forbidden-import scans use capture-and-check-empty or fail-on-nonempty logic (not bare `|| true`)
- [ ] P09 enforces deletion of `packages/core/src/settings`, `config/storage.ts`, `config/profileManager.ts`, `types/modelParams.ts` via `test ! -f` — not just `find | sort` report-only
- [ ] All zero-expected scans in P09/P09a/P10/P10a use capture-and-check-empty patterns (not bare `rg || echo OK` or `VARIABLE=$(... || echo "0"); test $VARIABLE -eq 0`)
- [ ] P04/P04a red-phase verification uses capture-and-assert logic (nonzero exit, behavioral failures present, no module resolution errors)
- [ ] Core root settings type exports in no-shim blocklist: ISettingsService, GlobalSettings, SettingsChangeEvent, ProviderSettings, UISettings, AdvancedSettings, EventListener, EventUnsubscribe, SettingsTelemetrySettings, getSettingsService, registerSettingsService, resetSettingsService, SETTINGS_REGISTRY, DiagnosticsInfo
- [ ] LLXPRT_CONFIG_DIR/memoryTool coupling resolved: settings owns its own constant, core defines local constant, tests prove identical paths without settings importing core/tools
- [ ] Deterministic workspace graph checks: production cycles checked over `dependencies` only; settings forbidden deps checked over `dependencies` AND `devDependencies`
- [ ] P03b creates compile-only transparent/no-op adapter: does NOT wire configConstructor (P06 owns production wiring)
- [ ] P04b core integration test exercises adapter module directly, NOT configConstructor production path
- [ ] P06 wires configConstructor → activateSettingsRuntimeContext() production call-site (P03b did not wire it)
- [ ] P06a is the first pass gate for production configConstructor/runtime wiring
- [ ] `providerRuntimeContext.ts` does NOT import or reference `SettingsService` or settings-package singleton functions — scan checks for both function names AND type/import references
- [ ] P07 old-import scans are inventory/report-only — they do NOT exit 1 on non-empty results during P07 (enforcement begins in P08/P08a/P09)
- [ ] a2a-server dependency clarification: no direct settings dependency needed (uses own Settings interface)
- [ ] Export map style verified: all subpaths use {types, import} objects consistently
- [ ] P04/P04a expected-failure output captured and checked for behavioral vs module-resolution errors
- [ ] P04b core test targets adapter contract directly (activateSettingsRuntimeContext → adapter → settings), NOT configConstructor production wiring (not ConfigBaseCore.settingsServiceInstance)
- [ ] Adapter bridge scan uses enforcing script logic (capture-and-check-empty), not prose/grep with manual inspection
- [ ] CLI vitest.config.ts alias uses workspaceAliasPlugin pattern with resolveTsSource, matching providers/core precedent
- [ ] Root build ordering verified with scripts/build.js inspection; settings builds before core/providers/CLI
- [ ] All forbidden-import scans use capture-and-check-empty or fail-on-nonempty logic (not bare `|| true`)
- [ ] Concrete file:../settings dependency metadata specified with section (dependencies)
- [ ] Import inventory counts recorded before and after P08 in completion marker
- [ ] package-lock.json diff verified after workspace registration (no unrelated churn)
- [ ] Post-build stale export scans: core dist has no moved settings/Storage/ProfileManager/modelParams exports (including DiagnosticsInfo and all settings type exports)
- [ ] Preflight records full modelParams.ts symbol list before move/delete
- [ ] `npm run test` passes
- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run format` passes
- [ ] `npm run build` passes
- [ ] `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` passes
