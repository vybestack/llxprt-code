# Issue #2233 dead-code and dependency inventory

This report implements the evidence requirements in the accepted [inventory plan](./plan.md). It records candidates for later cleanup. It does not remove code, alter a package manifest, change a lockfile, add analysis configuration, or change a dependency.

## Scope and result

The analyzed revision is:

- Commit: `3549572206ac3d867027e286bec67ce02ee2bb3c`
- Commit date: `2026-08-26T21:16:56-03:00`
- Subject: `Stop retaining a compiled Ajv validator per tool call (Fixes #3361) (#3363)`
- Branch at analysis time: `issue2233`

The root `workspaces` array and an independent `packages/*/package.json` discovery both found the same 16 direct workspaces. No workspace was deferred.

Four source candidates met the plan's "definitely dead" threshold: two isolated files and two isolated exported symbols. Fifty-seven dependency declarations met the lower "cleanup candidate" threshold: two in the root manifest and 55 across eight workspaces. One additional locally unused file remains in the public API decision bucket because it is emitted and published as an importable deep subpath. No dependency was treated as a confirmed removal because this inventory did not edit manifests and rerun package behavior without it.

Raw outputs are in the gitignored `tmp/issue2233/` directory. They are analysis records and are not part of this deliverable.

## Baseline

| Check | Command | Result | Raw evidence |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` | Exit 0 | `tmp/issue2233/baseline-typecheck.log`, `baseline-typecheck.status` |
| Lint | `npm run lint` | Exit 0 | `tmp/issue2233/baseline-lint.log`, `baseline-lint.status` |

The analysis runtime was Node.js `v25.2.1`, npm `11.6.2`, Bun `1.3.14`, and TypeScript `5.8.3`.

## Method

### Tools and versions

| Tool | Version | Source | Purpose |
| --- | --- | --- | --- |
| ts-prune | `0.10.3` | Repository installation | TypeScript export and declaration candidates |
| depcheck | `1.4.7` | Repository installation | Manifest dependency candidates |
| Knip | `6.32.3` with TypeScript `5.8.3` | Pinned transient `npm exec` invocation | Files, exports, types, dependencies, binaries, and unresolved references |
| Madge | `8.0.0` | Pinned transient `npm exec` invocation | Import reachability and orphan-file candidates |

`npm list --depth=0 ts-prune depcheck` supplied the installed versions.

A first transient Knip attempt with `knip@5.63.1` failed before analysis with `TypeError: ts.getDefaultLibFilePath is not a function`. The recorded replacement pins both `knip@6.32.3` and `typescript@5.8.3`; that combination completed. The failed run remains in `tmp/issue2233/knip-version.log` as limitation evidence.

SHA-1 checks of `package.json`, `package-lock.json`, and `bun.lock` before and after all transient commands were identical. The empty diffs are recorded in `protected-hash-diff-after-version-tools.txt` and `protected-hash-diff-after-analysis.txt`.

### Repository commands

| Command | Exit | Interpretation |
| --- | ---: | --- |
| `./node_modules/.bin/ts-prune -p tsconfig.json` | 134 | Failed near the default 4 GB JavaScript heap limit |
| `NODE_OPTIONS=--max-old-space-size=12288 ./node_modules/.bin/ts-prune -p tsconfig.json` | 0 | Completed with 16,329 output lines in `tmp/issue2233/ts-prune-root-12gb.log` |
| `./node_modules/.bin/depcheck . --json` | 255 | Completed JSON report; depcheck uses a nonzero finding-sensitive exit |
| `npm exec --yes --package=knip@6.32.3 --package=typescript@5.8.3 -- knip --reporter json` | 1 | Completed JSON report; Knip uses exit 1 when findings exist |
| `npm exec --yes --package=madge@8.0.0 -- madge --orphans --extensions ts,tsx --ts-config tsconfig.json --exclude '(^|/)(dist\|[^/]+\.(test\|spec)\|__tests__)(/\|\.\|$)' packages` | 0 | Completed a test-file-filtered orphan pass; 2,238 files and 252 resolution warnings |

The Madge exclusion regular expression is shown with Markdown escapes. The test-file-filtered label means that the command excluded `dist`, `*.test.*`, `*.spec.*`, and `__tests__`. It did not exclude every `test/` directory, fixture, setup module, or test helper. The corrected repository log and status are `tmp/issue2233/madge-root-production-orphans.log` and `.status`.

### Package commands

Each of the following was run once for every package named in the coverage matrix:

```text
./node_modules/.bin/ts-prune -p packages/<package>/tsconfig.json
./node_modules/.bin/depcheck packages/<package> --json
npm exec --yes --package=knip@6.32.3 --package=typescript@5.8.3 -- knip --workspace packages/<package> --reporter json
npm exec --yes --package=madge@8.0.0 -- madge --orphans --extensions ts,tsx --ts-config packages/<package>/tsconfig.json --exclude '(^|/)(dist|[^/]+\.(test|spec)|__tests__)(/|\.|$)' packages/<package>
```

All ts-prune and test-file-filtered Madge package runs exited 0. All depcheck package runs exited 255 with complete JSON findings. All Knip package runs exited 1 with complete JSON findings. The corrected Madge command template is documented above, and its per-package logs, stderr, and statuses are under `tmp/issue2233/madge-production-package-<package>.*`. The original `package-tool-status-matrix.log` and original `madge-package-<package>.status` files retain the earlier unfiltered Madge command and must not be cited as the corrected invocation. The matrix and individual status files remain the command evidence for ts-prune, depcheck, and Knip.

### Manual checks

Tool candidates were checked against:

- Root and package `main`, `types`, `exports`, `bin`, `files`, and scripts.
- Root barrels and package `index.ts` barrels.
- Static imports, type-only imports, dynamic `import()` strings, and executable names.
- Cross-workspace imports and root-owned dependencies.
- Package tests, `test-bun`, fixtures, integration tests, evals, and test utilities.
- Build, release, schema, bundle, lint, and maintenance scripts.
- Tool, provider, OAuth, command, settings, and extension registries.
- VS Code activation and contribution metadata.
- Generated `dist`, bundle, snapshot, coverage, and lockfile paths.
- Optional and platform dependencies, including keyring, PTY, and Bun platform packages.
- Targeted whole-repository text searches and TypeScript structural reference searches for shortlisted symbols.

The whole-repository structural search has a 2,000-file budget. It returned partial results for some symbols, so exact text searches and narrower package checks supplied the decisive reference evidence. This limitation is why structural search alone was not used for any no-reference claim.

## Tool limitations

- **ts-prune:** It reports exports, including values used inside their own module, package barrels, test seams, and public declarations. The default-heap root run aborted. The 12 GB retry completed.
- **depcheck:** Workspace hoisting and root dependency ownership produce many false missing or unused reports. Package runs also reported parser failures in a declaration file, five agents tests, one providers boundary test, CLI and VS Code TypeScript configurations, and the built VS Code extension. Findings remained usable only after import and script checks.
- **Knip:** No project configuration was added. Auto-discovery did not understand several custom Bun runners and shared setup paths, so it listed many real tests, fixtures, scripts, and entrypoints as unused. The root report contains 3,180 files, 155 dependencies, 53 development dependencies, 6 unlisted dependencies, 50 unresolved references, 1,360 exports, 441 types, 4 enum members, 3 duplicate-export reports, and 10 binaries. These totals describe raw candidates, not removals.
- **Madge:** The first pass traversed built output and tests and was rejected for classification. The corrected test-file-filtered pass excluded `dist`, `*.test.*`, `*.spec.*`, and `__tests__`, but residual `test/` directories, fixtures, setup modules, and test helpers remained in scope. It also reported entrypoints, declarations, and independently launched modules as orphans. It emitted 252 resolution warnings at repository scope. An orphan row is only graph evidence.
- **Generated output:** Existing `dist`, bundle output, snapshots, lockfiles, and generated CLI files were inspected only to identify ownership. They were not used as source reachability proof.

## Workspace coverage

Legend: `yes` means the category received package-level tooling plus metadata or targeted checks. `limited` means the command completed but the named tool limitation applies.

| Workspace | Files | Exports, types, members | Dependencies | Import reachability | Package result |
| --- | --- | --- | --- | --- | --- |
| `a2a-server` | yes | yes | yes, limited | yes, limited | No definitely-dead item; local-use and entrypoint false positives confirmed |
| `agents` | yes | yes | yes, limited | yes, limited | No definitely-dead item; custom test runners and public API dominate raw findings |
| `auth` | yes | yes | yes | yes, limited | One test-only seam; `fast-check` dependency candidate |
| `cli` | yes | yes | yes, limited | yes, limited | Thirteen dependency declarations are cleanup candidates; six two-tool reports have concrete bundle, native-asset, or test evidence, and one needs manual ownership validation |
| `core` | yes | yes | yes, limited | yes, limited | Thirty-six dependency declarations are cleanup candidates; no definitely-dead source item accepted |
| `ide-integration` | yes | yes | yes | yes, limited | `fast-check` dependency candidate; LSP executable loading confirmed |
| `lsp` | yes | yes | yes, limited | yes, limited | `src/config.ts` is locally unused but remains a published deep-subpath compatibility decision; runtime executable dependency confirmed used |
| `mcp` | yes | yes | yes, limited | yes, limited | `src/auth/oauth-provider-dependencies.ts` definitely dead |
| `policy` | yes | yes | yes | yes, limited | `fast-check` dependency candidate; package export map retained for decision |
| `providers` | yes | yes | yes, limited | yes, limited | Two definitely-dead symbols; public and runtime registration findings retained for decision |
| `settings` | yes | yes | yes | yes, limited | `src/types.ts` definitely dead as a file; exported owning types remain used |
| `storage` | yes | yes | yes | yes, limited | Test-only seams and optional keyring loading confirmed |
| `telemetry` | yes | yes | yes, limited | yes, limited | Test-only fault injectors; OpenTelemetry ownership needs a separate decision |
| `test-utils` | yes | yes | yes | yes, limited | Workspace storage dependency candidate; test entrypoints confirmed |
| `tools` | yes | yes | yes | yes, limited | `html-to-text` dependency candidate; registry and public tool surfaces confirmed |
| `vscode-ide-companion` | yes | yes | yes, limited | yes, limited | Watch-script dependency mismatch; extension metadata and activation entrypoint confirmed |

## Findings

### 1. Definitely dead and safe to remove

These are source candidates, not removals performed by this issue.

#### MCP

| Candidate | Evidence | Contrary evidence checked | Confidence |
| --- | --- | --- | --- |
| `packages/mcp/src/auth/oauth-provider-dependencies.ts` and `MCPOAuthProviderDependencies` | Knip and both corrected Madge scopes report the file. Root and package ts-prune report the interface. Exact repository search finds its declaration only. | The file is absent from `packages/mcp/src/index.ts`, all intermediate auth barrels, and the package export map. No production, test, script, config, registry, docs, or dynamic import reference exists. Its imports are type-only and have no side effect. | High |

#### Settings

| Candidate | Evidence | Contrary evidence checked | Confidence |
| --- | --- | --- | --- |
| `packages/settings/src/types.ts` as a redundant re-export file | Knip and both corrected Madge scopes report the file. Root and package ts-prune report all ten re-exported types. Exact code search finds no consumer of this file. | The file comment advertises `@vybestack/llxprt-code-settings/types`, but `packages/settings/package.json` has no `./types` export. The package root barrel exports the same types directly from `profiles/types.ts` and `settings/settingsRegistry.ts`. Historical issue plans mention the path, but no active source, test, script, config, registry, or documentation import does. | High |

The later cleanup is the file only. The ten owning type declarations and their package-root exports remain used and are not candidates here.

#### Providers

| Candidate | Evidence | Contrary evidence checked | Confidence |
| --- | --- | --- | --- |
| `ProviderRuntimeScopeError` at `packages/providers/src/errors.ts:160` | Root and package ts-prune and package Knip report the class. Exact repository search finds only its declaration plus multiple historical planning and pseudocode references. Those historical references do not create live usage. | It is not re-exported from `packages/providers/src/index.ts` and `package.json` has no `./errors.js` subpath. No production, test, script, config, registry, or dynamic reference exists. Other declarations in `errors.ts` remain used, so only this class is a candidate. | High |
| `orUndefined` at `packages/providers/src/utils/falsyFallback.ts:42` | Root and package ts-prune and package Knip report the function. Exact repository search finds only its declaration. | It is absent from the package root barrel and export map. The same file's `firstTruthyString` remains used, so only `orUndefined` is a candidate. No production, test, script, config, registry, or dynamic reference exists. | High |

No other raw symbol or file finding met this bucket's threshold. In particular, same-module usage, tests, public exports, independent process entrypoints, and string registries prevented promotion.

### 2. Test-only usage

Test-only means the supporting behavior needs an explicit test-design decision before deletion.

#### Auth

- `_resetProcessStartTimeForTests` at `packages/auth/src/lock-owner.ts:264` is imported and called only by `packages/auth/src/__tests__/lock-owner.startTimeSource.spec.ts:10,30`. Package Knip reports the export. Structural reference analysis found the same one import and one call, with no production reference. It is not exported from the package root.
- `computeBackoffDelay` at `packages/auth/src/keyring-token-store.ts:86` is not dead. It is called by production code at line 227 and tested directly by `keyring-token-store.lock-recovery.test.ts`. Knip's unused-export result concerns the export surface, not the implementation.

#### CLI

- `createTestMergedSettings` at `packages/cli/src/config/settings.ts:40` is used by `skills-backward-compatibility.test.ts` and `ui/commands/skillsCommand.test.ts`, with no production call found. The function name and reference set identify it as a test seam. It is not a package-root API.
- Numerous `*-test-helpers.ts`, `test-utils`, fixture, and Bun test files were reported by Knip and Madge. The custom runners discover them outside those tools' default entry patterns. No file-level removal was accepted from that group.

#### Storage

- `resetKeychainGrantPersistenceForTesting` and `setKeychainGrantPersistencePlatformForTesting` at `packages/storage/src/secure-store/keychain-grant-persistence.ts:250,261` are used only by `packages/storage/test-bun/keychain-grant-persistence.bun.ts`. Structural analysis confirmed the first symbol's one test import and four test calls. They are absent from the package root and export map.
- Additional `*ForTesting` runtime-identity seams were left in this bucket until a later cleanup can evaluate whether moving them under a test entrypoint improves the boundary.

#### Telemetry

- `FaultInjectingPerfFilesystem` at `packages/telemetry/src/perf/PerfSink.ts:83` is used only by perf behavior tests.
- `FaultInjectingRetentionFilesystem` at `packages/telemetry/src/perf/retention.ts:152` is used only by retention and self-health behavior tests.
- `packages/telemetry/src/perf/index.ts` intentionally does not re-export either class, and its comment states that fault injectors stay package-private to tests. Knip reports both exports because they are exported from their defining modules.

No test-only item was classified as safe to remove. These seams support active behavioral tests.

### 3. Public API or exported surface requiring explicit decision

Repository non-use cannot establish external non-use.

#### LSP

- `packages/lsp/src/config.ts` is locally unused, but it is part of the published package output. `packages/lsp/tsconfig.build.json` compiles `src/**/*.ts`, `packages/lsp/package.json` publishes all of `dist` and has no restrictive export map, and the emitted `dist/config.d.ts` exports `LspServiceConfig` and `defaultLspServiceConfig`. Consumers can import that deep subpath.
- Exact repository searches found no live source, test, script, configuration, registry, dynamic import, or current documentation reference outside the defining and emitted files. This establishes local non-use, not safe removal. Compatibility evidence is required before changing the published deep subpath.
- This documentation-only issue does not propose an export-map or other manifest change.

#### Core, agents, providers, and tools

- `packages/core/package.json` exposes the root plus many subpaths, including history, runtime, telemetry, policy, image, debug mock, and test-utility modules. Root ts-prune and Knip report many names on this surface. Removal requires a compatibility decision even when no in-repository import exists.
- `packages/agents/package.json` exposes the root, `internals.js`, `app-service.js`, and `constants.js`. Knip's 147 package export candidates include internal helper exports and public-root names; those groups cannot be treated alike.
- `packages/providers/package.json` exposes the root plus auth, composition, runtime, tokenizer, provider, and type subpaths. Runtime composition is also selected through profile and provider state. Public subpaths need owner review before contraction.
- `packages/tools/package.json` exposes the root, utility subpaths, formatter subpaths, registry modules, and individual built-in tool modules. A tool can be invoked through its registered name without another source file importing its class directly.

#### Auth, policy, settings, storage, and telemetry

- Each package has a root barrel and an explicit export map. Auth flow and proxy subpaths, policy engine/config subpaths, settings services/profile/storage subpaths, storage secure-store/testing subpaths, and telemetry debug/perf/metric subpaths are compatibility surfaces.
- Test-flavored exported paths such as core test utilities, storage `./testing`, and debug mock modules may be candidates for a separate API-boundary decision. Their names are not proof that downstream consumers do not use them.

#### Entrypoint packages

- `packages/a2a-server/package.json` declares `main`, a `bin`, a `start` script, and published `dist` files. The package is private, but those metadata entrypoints are still internal runtime surfaces.
- Separately from the published LSP config deep subpath, `packages/lsp/package.json` declares `dist/main.js` as `main`; it is started by IDE integration rather than imported into the main graph.
- `packages/cli/index.ts` and `packages/cli/bin/llxprt.mjs` are executable surfaces.
- `packages/vscode-ide-companion/src/extension.ts` exports VS Code lifecycle functions selected by extension metadata.
- `packages/test-utils` is private, but its package root is consumed by workspace tests and remains a shared test API.

No public-surface item was promoted to definitely dead without package-publication checks and compatibility evidence. Root-barrel absence alone is insufficient when a package publishes importable deep subpaths.

### 4. Dynamic, registry, or config-driven usage requiring manual validation

#### LSP and IDE integration

- `packages/lsp/src/main.ts` is an independently launched process. `packages/ide-integration/src/lsp/lsp-entry-resolver.ts` resolves `@vybestack/llxprt-code-lsp`, and `lsp-service-client.ts` passes `LSP_BOOTSTRAP` as JSON. Madge reporting `src/main.ts` as an orphan is a confirmed graph limitation.
- `typescript-language-server` is a command string at `packages/lsp/src/service/server-registry.ts:54`. It is a runtime executable dependency even though Knip and depcheck do not see a TypeScript import.

#### CLI, agents, MCP, providers, and tools

- Tool availability flows through `ToolRegistry`, tool names, profile settings, MCP discovery, and package tool-name constants. Static import non-use is insufficient for individual built-in tools.
- Provider construction flows through manager registration, OAuth registration, profile names, runtime selection, and composition modules. Provider and OAuth candidates need runtime-owner validation.
- CLI command and extension loaders use file discovery, settings, and dynamic imports. Root scripts and integration tests also execute files that static entrypoint discovery missed.
- A2A command routes and command registry classes are registered by command name and server startup. Local command classes were not accepted as dead from Knip alone.

#### Storage and optional dependencies

- `packages/storage/src/secure-store/default-keyring-adapter.ts:347` dynamically imports `@napi-rs/keyring`. The optional dependency is platform and environment sensitive.
- PTY dependencies are selected by shell settings, platform, and runtime adapters. The root and CLI optional PTY packages and Bun platform packages are not cleanup candidates from static import output.

#### VS Code companion

- `packages/vscode-ide-companion/package.json` declares activation events, commands, menus, keybindings, and `main: ./dist/extension.cjs`. `src/extension.ts` registers those command strings. These are metadata-driven references.
- `src/ide-server.ts` registers MCP-facing tools by name. A static orphan report cannot resolve those protocol calls.

No dynamic or registry candidate was treated as confirmed removal.

### 5. Dependency cleanup candidates

Every row below is one manifest declaration. The 57 data rows, not the analyzer totals, supply the summary count: two root declarations plus 55 declarations across auth (one), CLI (13), core (36), IDE integration (one), policy (one), test-utils (one), tools (one), and the VS Code companion (one). All rows are candidates for a later manifest change and focused verification. Tool agreement and a declaration-only search do not establish safe removal.

Evidence labels used in the table:

- **R:** Root Knip and depcheck report the declaration. Exact tracked-source, test, script, bundle/build configuration, dynamic-string, package-metadata, and relevant generated-output searches found only manifests, lockfiles, and historical plans.
- **P:** Package Knip and depcheck report the declaration. Exact package searches across static and type imports, tests, scripts, bundle/build configuration, dynamic strings, and package metadata found no use.
- **X:** Evidence P applies, and a concrete active owner exists elsewhere. The named declaration is still a candidate only in the listed scope.
- **S:** The row has special ownership evidence described directly.

Follow-up labels set the minimum verification for a later manifest edit:

- **Root:** remove only the named root declaration, update both lockfiles through the repository package-manager procedure, run the full verification cycle, build and inspect the CLI bundle, and smoke an installed package. Root publication and workspace hoisting can hide missing package ownership, so a root-only source search is insufficient.
- **CLI:** remove only one row or one narrow CLI group, update both lockfiles, run CLI tests and typecheck, build the CLI package, run `bundle:cli`, and smoke the packed CLI in a non-hoisted install. Dependencies inlined into the bundle and dependencies left external need different ownership checks.
- **Core:** remove only one row or one narrow core group, update both lockfiles, run core tests, typecheck, and build, then run CLI/provider/tool consumers and the CLI bundle and installed-package checks. A sibling package's import does not justify a core declaration, while a hoisted install can hide a missing sibling declaration.

| Package and declaration | Kind | Evidence | Required follow-up |
| --- | --- | --- | --- |
| `package.json:234`, `@types/html-to-text` | development | R | Root |
| `package.json:333`, `html-to-text` | runtime | R | Root |
| `packages/auth/package.json:94`, `fast-check` | development | P | Auth tests, typecheck, lint, build, and repository verification. |
| `packages/cli/package.json:49`, `@anthropic-ai/sdk` | runtime | X: active imports are in `packages/providers/src/anthropic/`, and providers declares it. | CLI |
| `packages/cli/package.json:118`, `@babel/runtime` | development | P | CLI |
| `packages/cli/package.json:119`, `@testing-library/dom` | development | P | CLI |
| `packages/cli/package.json:134`, `dom-accessibility-api` | development | P | CLI |
| `packages/cli/package.json:87`, `gradient-string` | runtime | P | CLI |
| `packages/cli/package.json:88`, `highlight.js` | runtime | P | CLI |
| `packages/cli/package.json:91`, `ink-select-input` | runtime | P | CLI |
| `packages/cli/package.json:136`, `lz-string` | development | P | CLI |
| `packages/cli/package.json:95`, `mime-types` | runtime | X: active imports are in `packages/core/src/utils/fileUtils.ts` and `packages/tools/src/utils/fileUtils.ts`; both workspaces declare it. | CLI |
| `packages/cli/package.json:99`, `openai` | runtime | X: active imports are in `packages/providers/src/openai/` and `packages/providers/src/kimi/`, and providers declares it. | CLI |
| `packages/cli/package.json:137`, `pretty-format` | development | P | CLI |
| `packages/cli/package.json:102`, `sharp` | runtime | X: active imports are in `packages/tools/src/utils/imageDimensionBudget.ts` and `imageResize.ts`, and tools declares it. | CLI |
| `packages/cli/package.json:112`, `wrap-ansi` | runtime | P | CLI |
| `packages/core/package.json:576`, `@ai-sdk/openai` | runtime | X: `packages/providers/src/openai-vercel/vercelModelClient.ts` imports it, and providers declares it. Core model fixtures contain metadata strings but no module load. | Core |
| `packages/core/package.json:577`, `@anthropic-ai/sdk` | runtime | X: active imports are in `packages/providers/src/anthropic/`, and providers declares it. | Core |
| `packages/core/package.json:578`, `@ast-grep/lang-c` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:579`, `@ast-grep/lang-cpp` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:580`, `@ast-grep/lang-csharp` | runtime | X: no core import; the CLI bundle configuration externalizes it and CLI declares it. | Core |
| `packages/core/package.json:581`, `@ast-grep/lang-go` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:582`, `@ast-grep/lang-java` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:583`, `@ast-grep/lang-json` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:584`, `@ast-grep/lang-kotlin` | runtime | X: no core import; the CLI bundle configuration externalizes it and CLI declares it. | Core |
| `packages/core/package.json:585`, `@ast-grep/lang-php` | runtime | X: no core import; the CLI bundle configuration externalizes it and CLI declares it. | Core |
| `packages/core/package.json:586`, `@ast-grep/lang-python` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:587`, `@ast-grep/lang-ruby` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:588`, `@ast-grep/lang-rust` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:589`, `@ast-grep/lang-scala` | runtime | X: no core import; the CLI bundle configuration externalizes it and CLI declares it. | Core |
| `packages/core/package.json:590`, `@ast-grep/lang-swift` | runtime | X: no core import; the CLI bundle configuration externalizes it and CLI declares it. | Core |
| `packages/core/package.json:591`, `@ast-grep/napi` | runtime | X: `packages/tools/src/utils/ast-grep-utils.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:645`, `@types/debug` | development | P; core has no `debug` import or explicit type configuration for this package. | Core, including declaration-emission verification. |
| `packages/core/package.json:646`, `@types/diff` | development | P; core has no `diff` import or explicit type configuration for this package. | Core, including declaration-emission verification. |
| `packages/core/package.json:648`, `@types/html-to-text` | development | P; core has no `html-to-text` import or explicit type configuration for this package. | Core, paired experimentally with only the core runtime declaration. |
| `packages/core/package.json:650`, `@types/minimatch` | development | P; core has no `minimatch` import or explicit type configuration for this package. | Core, including declaration-emission verification. |
| `packages/core/package.json:598`, `ai` | runtime | X: active imports are in `packages/providers/src/openai-vercel/`, and providers declares it. | Core |
| `packages/core/package.json:600`, `ajv-formats` | runtime | P | Core |
| `packages/core/package.json:602`, `cheerio` | runtime | X: `packages/tools/src/tools/direct-web-fetch.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:603`, `diff` | runtime | X: active imports are in `packages/tools/src/`, and tools declares it. | Core |
| `packages/core/package.json:604`, `execa` | runtime | P | Core |
| `packages/core/package.json:605`, `fast-glob` | runtime | X: active imports are in `packages/tools/src/tools/`, and tools declares it. | Core |
| `packages/core/package.json:611`, `html-to-text` | runtime | P; relevant bundle and generated-output searches also found no use. | Core, paired experimentally with only the core type declaration. |
| `packages/core/package.json:612`, `https-proxy-agent` | runtime | P | Core |
| `packages/core/package.json:616`, `micromatch` | runtime | P | Core |
| `packages/core/package.json:655`, `msw` | development | P | Core tests and test runners, then Core. |
| `packages/core/package.json:656`, `nock` | development | P | Core tests and test runners, then Core. |
| `packages/core/package.json:619`, `node-fetch` | runtime | X: active imports are in `packages/tools/src/`, and tools declares it. | Core |
| `packages/core/package.json:620`, `open` | runtime | X: `packages/cli/src/ui/commands/docsCommand.ts` and `bugCommand.ts` import it, and CLI declares it. | Core |
| `packages/core/package.json:621`, `openai` | runtime | X: active imports are in `packages/providers/src/openai/` and `kimi/`, and providers declares it. | Core |
| `packages/core/package.json:629`, `turndown` | runtime | X: `packages/tools/src/tools/direct-web-fetch.ts` imports it, and tools declares it. | Core |
| `packages/core/package.json:631`, `vscode-jsonrpc` | runtime | X: `packages/lsp/src/channels/rpc-channel.ts` imports it, and LSP declares it. | Core |
| `packages/ide-integration/package.json:49`, `fast-check` | development | P | IDE integration tests, LSP integration tests, package typecheck and build, and repository verification. |
| `packages/policy/package.json:82`, `fast-check` | development | P | Policy tests, typecheck, build, and repository verification. |
| `packages/test-utils/package.json:17`, `@vybestack/llxprt-code-storage` | runtime workspace | S: no package-name import exists, but `test-setup-storage-isolation.ts` imports `../storage/src/testing.js` and `bunfig.toml` preloads it. | Decide ownership in a test-utils-only slice and verify every consumer and preload before changing the manifest. |
| `packages/tools/package.json:277`, `html-to-text` | runtime | P; the root and core declarations are separate candidates, not evidence for tools ownership. | Tools and core tests, package builds, CLI bundle, and installed-package checks. |
| `packages/vscode-ide-companion/package.json:146`, `npm-run-all` | development | S: the `watch` script invokes `npm-run-all2`, while this declaration supplies `npm-run-all`. | Decide whether the script or declaration is wrong, then exercise `watch`; do not make a blind dependency-only removal. |

#### CLI two-tool intersection disposition

The 20 names in `tmp/issue2233/final-review/cli-two-tool-candidates.txt` were checked individually. Thirteen are candidates in the final table, six have concrete package-specific use, and one remains manual validation. The candidate classification is scoped to the CLI declaration and does not dispute active imports in another workspace.

| Name | Classification | Package-specific evidence or limitation |
| --- | --- | --- |
| `@anthropic-ai/sdk` | Cleanup candidate | No CLI import or build/config reference; providers owns the active imports. |
| `@ast-grep/lang-csharp` | Confirmed false positive | `scripts/bun-build.config.ts` externalizes it, and `scripts/tests/issue-3055-cli-externals-ownership.bun.test.ts` requires direct CLI ownership. |
| `@ast-grep/lang-kotlin` | Confirmed false positive | Same external and direct-ownership evidence. |
| `@ast-grep/lang-php` | Confirmed false positive | Same external and direct-ownership evidence. |
| `@ast-grep/lang-scala` | Confirmed false positive | Same external and direct-ownership evidence. |
| `@ast-grep/lang-swift` | Confirmed false positive | Same external and direct-ownership evidence. |
| `@babel/runtime` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `@testing-library/dom` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `dom-accessibility-api` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `gradient-string` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `highlight.js` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `ink-select-input` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `lz-string` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `mime-types` | Cleanup candidate | No CLI import or bundle/config reference; core and tools own the active imports. |
| `openai` | Cleanup candidate | No CLI import or bundle/config reference; providers owns the active imports. |
| `pretty-format` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |
| `read-package-up` | Manual validation, not counted | At least 16 CLI tests mock `read-package-up`; production import is `packages/core/src/utils/package.ts`. A later experiment must remove only the CLI declaration and run those tests plus packed-CLI checks. |
| `sharp` | Cleanup candidate | No CLI import or bundle/config reference; tools owns the active production imports. |
| `tree-sitter-pwsh` | Confirmed false positive | `packages/core/src/utils/shell-parser.ts` resolves its WASM subpath. `scripts/tests/issue-3181-pwsh-resolution.bun.test.ts` proves the bundled CLI needs a direct dependency in a non-hoisted install. |
| `wrap-ansi` | Cleanup candidate | No CLI static, type, test, script, bundle/config, dynamic-string, or metadata use found. |

#### Core two-tool intersection disposition

All 36 names in `tmp/issue2233/final-review/core-two-tool-candidates.txt` are core cleanup candidates in the final table. Exact core searches found no static or type imports, tests that load the module, scripts, build/bundle references, dynamic module strings, package-metadata consumers, or relevant generated ownership. Concrete imports in providers, tools, CLI, or LSP establish those workspaces' ownership only. They do not establish core ownership. Removal still requires the named focused experiment because workspace hoisting and declaration emission can expose evidence that static searches miss.

| Name | Classification | Concrete cross-workspace evidence or focused caution |
| --- | --- | --- |
| `@ai-sdk/openai` | Cleanup candidate | Providers import; core fixture strings are model metadata, not module loads. |
| `@anthropic-ai/sdk` | Cleanup candidate | Providers import. |
| `@ast-grep/lang-c` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-cpp` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-csharp` | Cleanup candidate | CLI external ownership is separate; no core load found. |
| `@ast-grep/lang-go` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-java` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-json` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-kotlin` | Cleanup candidate | CLI external ownership is separate; no core load found. |
| `@ast-grep/lang-php` | Cleanup candidate | CLI external ownership is separate; no core load found. |
| `@ast-grep/lang-python` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-ruby` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-rust` | Cleanup candidate | Tools import; CLI external ownership is separate. |
| `@ast-grep/lang-scala` | Cleanup candidate | CLI external ownership is separate; no core load found. |
| `@ast-grep/lang-swift` | Cleanup candidate | CLI external ownership is separate; no core load found. |
| `@ast-grep/napi` | Cleanup candidate | Tools import and native ownership; no core load found. |
| `@types/debug` | Cleanup candidate | Verify core typecheck and declaration emission without the ambient package. |
| `@types/diff` | Cleanup candidate | Verify core typecheck and declaration emission without the ambient package. |
| `@types/html-to-text` | Cleanup candidate | Verify with only the core runtime counterpart; root type ownership is separate. |
| `@types/minimatch` | Cleanup candidate | Verify core typecheck and declaration emission without the ambient package. |
| `ai` | Cleanup candidate | Providers import. |
| `ajv-formats` | Cleanup candidate | No core or repository module load found; run schema validation coverage. |
| `cheerio` | Cleanup candidate | Tools import. |
| `diff` | Cleanup candidate | Tools import. |
| `execa` | Cleanup candidate | No core package use found; run process and shell coverage. |
| `fast-glob` | Cleanup candidate | Tools import. |
| `html-to-text` | Cleanup candidate | No core use or relevant generated/bundle ownership found; root and tools declarations are separate. |
| `https-proxy-agent` | Cleanup candidate | No core package use found; run proxy coverage. |
| `micromatch` | Cleanup candidate | No core package use found; run discovery and ignore-pattern coverage. |
| `msw` | Cleanup candidate | No core test or runner use found; run the complete core test runner. |
| `nock` | Cleanup candidate | No core test or runner use found; run the complete core test runner. |
| `node-fetch` | Cleanup candidate | Tools import. |
| `open` | Cleanup candidate | CLI commands import. |
| `openai` | Cleanup candidate | Providers import. |
| `turndown` | Cleanup candidate | Tools import. |
| `vscode-jsonrpc` | Cleanup candidate | LSP import. |

Other raw package findings outside these intersections remain governed by the same manual checks. Findings reported by Knip alone were not promoted without corroborating package evidence. Knip also reported possible ownership gaps: CLI imports `hast`, providers imports `@vybestack/llxprt-code-telemetry`, telemetry imports `@opentelemetry/context-async-hooks`, and LSP lint configuration uses `@eslint/js`. Those are undeclared-dependency questions, not unused-dependency removals, and are deferred to package-ownership work.

### 6. Confirmed false positives

#### Same-module use

- `pickFields` and `mapOutcomeStringToEnum` in `packages/a2a-server/src/agent/task-support.ts` are called by production code in the same file. Knip reported their exports, not dead implementations.
- `computeBackoffDelay` in auth is called by production code and tests.
- `MAX_FILE_SIZE_BYTES` in `packages/tools/src/utils/fileUtils.ts` is used in the same production module. Knip reported only its unused export status.
- Settings validation and profile-repair functions reported as exports are called by their own production modules and have direct behavioral tests.

#### Entrypoints and public barrels

- Madge reports many package `index.ts` files, `packages/lsp/src/main.ts`, `packages/cli/index.ts`, and VS Code lifecycle files because nothing imports independently selected entrypoints. Package metadata, bins, scripts, or extension metadata establish their use.
- ts-prune reports package-root exports and explicit subpath exports when no in-repository consumer exists. That is expected for published API surface.

#### Tests, scripts, and generated files

- Knip reports custom Bun test files, setup files, fixtures, evals, integration tests, and maintenance scripts that are selected by custom runners or npm scripts.
- Madge's initial graph included `dist` and tests. That output was retained only as limitation evidence. Built declarations and emitted JavaScript are not source-orphan proof.
- Snapshot, generated CLI, bundle, coverage, and lockfile paths are produced or consumed by tests and build/release scripts. They were excluded from removal claims.

#### Dependency ownership and non-import use

- Root depcheck and Knip report many dependencies actually imported by workspaces. A hoisted root declaration or package declaration can serve build, bundle, test, publication, or runtime ownership even when the root source graph has no import.
- `typescript-language-server` is executed by command name.
- `@napi-rs/keyring`, PTY packages, platform Bun packages, and language parser packages are optional, platform-selected, or registry-selected.
- Type packages and type-only imports can disappear from emitted JavaScript while remaining required by typecheck.
- `ts-prune` and `depcheck` themselves are invoked analysis tools even though product source does not import them.

## Follow-up cleanup slices

The order below starts with narrow changes backed by multiple evidence sources. Each slice is a proposal, not a confirmed removal. Dependency slices must update both lockfiles through the repository procedure and must not combine root, CLI, core, or tools ownership changes merely because the dependency name is shared.

1. **Providers symbol slice:** remove only `ProviderRuntimeScopeError` and `orUndefined`, then run providers tests, typecheck, lint, build, and repository verification.
2. **MCP file slice:** remove only `packages/mcp/src/auth/oauth-provider-dependencies.ts`, then run MCP tests, typecheck, lint, build, and repository verification.
3. **Settings file slice:** remove only `packages/settings/src/types.ts`. Keep the owning type declarations and root exports, then run settings tests, boundary checks, typecheck, lint, build, and repository verification.
4. **Auth dependency slice:** experimentally remove only auth `fast-check`; run auth tests, typecheck, lint, build, and repository verification.
5. **IDE integration dependency slice:** experimentally remove only IDE integration `fast-check`; run package and LSP integration tests, typecheck, build, and repository verification.
6. **Policy dependency slice:** experimentally remove only policy `fast-check`; run policy tests, typecheck, build, and repository verification.
7. **Root HTML dependency slice:** test the root `html-to-text` and `@types/html-to-text` declarations as separate removals. Run the full cycle, root package preparation, CLI bundle inspection, and a non-hoisted packed-package smoke. Do not infer root ownership from the core or tools declarations.
8. **Core HTML dependency slice:** test only core `html-to-text` and `@types/html-to-text`, with each declaration independently reversible. Run core tests, typecheck including declarations, build, CLI/tool consumers, bundle inspection, and a non-hoisted package smoke. Do not infer core ownership from root or tools.
9. **Tools HTML dependency slice:** test only tools `html-to-text`. Run tools and core tests, package builds, CLI bundle inspection, and a non-hoisted package smoke. Root and core results do not determine tools ownership.
10. **CLI provider and media declaration slice:** test only CLI `@anthropic-ai/sdk`, `openai`, `mime-types`, and `sharp`, preferably one declaration at a time. Run CLI tests and typecheck, package build, `bundle:cli`, external inspection, and a non-hoisted packed-CLI smoke.
11. **CLI presentation declaration slice:** test only CLI `gradient-string`, `highlight.js`, `ink-select-input`, and `wrap-ansi`, one declaration at a time, with CLI UI tests and the full CLI build and bundle checks.
12. **CLI test-support declaration slice:** test only CLI `@babel/runtime`, `@testing-library/dom`, `dom-accessibility-api`, `lz-string`, and `pretty-format`, one declaration at a time, with the complete custom CLI test runner and typecheck.
13. **CLI `read-package-up` ownership validation:** do not count this as a removal candidate yet. Remove only the CLI declaration experimentally and run the tests that mock it, the package build, the bundle, and a non-hoisted packed-CLI smoke before classifying it.
14. **Core provider declaration slice:** test only core `@ai-sdk/openai`, `@anthropic-ai/sdk`, `ai`, and `openai`, one declaration at a time. Run core and provider tests, typecheck, package builds, the CLI bundle, and a non-hoisted install.
15. **Core AST declaration slice:** test the 13 core `@ast-grep/lang-*` declarations and core `@ast-grep/napi`, one declaration at a time. Run core and tools tests, native-module smoke coverage, package builds, CLI external inspection, and a non-hoisted CLI install. Do not alter the separately justified CLI externals in this slice.
16. **Core relocated tool declaration slice:** test only core `cheerio`, `diff`, `fast-glob`, `node-fetch`, and `turndown`, one declaration at a time. Run core and tools tests, package builds, direct-web-fetch and editing coverage, and CLI bundle checks.
17. **Core type declaration slice:** test only core `@types/debug`, `@types/diff`, and `@types/minimatch`, one declaration at a time. Run core typecheck, declaration emission, package build, and consumer typechecks.
18. **Core validation and process declaration slice:** test only core `ajv-formats`, `execa`, `https-proxy-agent`, and `micromatch`, one declaration at a time. Run schema-validation, process, proxy, discovery, and ignore-pattern coverage plus core and repository verification.
19. **Core test dependency slice:** test only core `msw` and `nock`, one declaration at a time, through the complete custom core runner and repository test discovery checks.
20. **Core cross-workspace application declaration slice:** test only core `open` and `vscode-jsonrpc`, one declaration at a time. Run core, CLI command, LSP channel, package build, and CLI bundle coverage.
21. **Test-utils dependency-ownership slice:** evaluate the storage declaration against the relative cross-workspace preload coupling. Verify every test-utils consumer and preload before changing its manifest.
22. **VS Code companion watch slice:** resolve the `npm-run-all` versus `npm-run-all2` mismatch and exercise the watch script. This is not a dependency-only deletion.
23. **Auth test-seam slice:** review `_resetProcessStartTimeForTests` while retaining the lock-owner behavior tests.
24. **CLI test-seam slice:** review `createTestMergedSettings` and the CLI test-helper boundary while retaining current test behavior.
25. **Storage test-seam slice:** review storage `*ForTesting` exports and the existing testing subpath while retaining current behavior tests.
26. **Telemetry test-seam slice:** review the fault-injector exports while retaining perf and self-health behavior tests.
27. **LSP public compatibility review:** evaluate external use of the published `config.js` and `config.d.ts` deep subpath. Do not classify `src/config.ts` for removal without compatibility evidence, and do not change the package manifest as part of this documentation issue.

Any other public, dynamic, registry, command, extension, optional-platform, or config-selected finding should become a separate package-scoped review. Validate the relevant package artifact and runtime behavior before proposing cleanup.

## Triage of issues found during the inventory

- **Blocker-Fix:** Resolved in this report. The root and core `html-to-text` and `@types/html-to-text` declarations are now four separate candidate rows, while tools `html-to-text` remains its own row. The summary, root scope, CLI and core workspace results, declaration table, ownership cautions, focused verification, and cleanup order use the 57-row final count. Every name in the 20-name CLI and 36-name core two-tool intersections now has an individual candidate, false-positive, or manual-validation disposition based on package source, tests, scripts, bundle/build configuration, dynamic strings, metadata, and concrete cross-workspace paths. The report no longer describes these intersections as Knip-only. The earlier LSP correction remains: `packages/lsp/src/config.ts` stays in the public API decision bucket because the build emits it into the published `dist` tree and the package permits deep-subpath imports.
- **In-scope-Fix:** Resolved in this report. The unsupported lint signal anecdote and tool-version run-history anecdote were removed; only the evidenced exit-0 baseline and `npm list` version source remain. The corrected Madge template is in this report, corrected logs and statuses are identified under `tmp/issue2233/`, and the original matrix is accurately identified as retaining the earlier unfiltered commands. The ts-prune result records 16,329 output lines without treating every line as a distinct candidate. Madge runs remain labeled test-file-filtered, with residual test-support scope disclosed. The test-utils storage row records relative cross-workspace preload coupling, and package-focused follow-up slices remain narrow.
- **Reject:** Actual dependency edits, source cleanup, public-surface contraction, and suggestions to remove package entrypoints, tests, generated files, registry items, type-only dependencies, or optional/platform dependencies from analyzer output alone remain outside this documentation-only remediation. A direct `bun test` rerun without the repository runner was also rejected as diagnostic evidence because it omitted the workspace's required preload and produced unrelated child-process parse failures.
- **Defer:** The VS Code watch dependency mismatch, possible undeclared package ownership signals, parser/configuration limitations, test-seam restructuring, public API compatibility decisions, dynamic registry cleanup, and every candidate manifest experiment are follow-up work. Historical timing-sensitive test failures passed in the clean, non-overlapping full-suite rerun and are not open findings. No source, test, manifest, lockfile, script, workflow, tooling/configuration, generated tracked file, or `.llxprt` edit is authorized here.

## Verification

The final candidate commands ran sequentially in the required order. Raw output and status records are under `tmp/issue2233/retarget-head/`.

| Command | Exit | Result and evidence |
| --- | ---: | --- |
| `npm run test` | 0 | Passed across all workspace test scripts in a clean, non-overlapping run. Raw evidence: `npm-run-test.log` and `npm-run-test.status`. |
| `npm run lint` | 0 | Passed. Raw evidence: `npm-run-lint.log` and `npm-run-lint.status`. |
| `npm run typecheck` | 0 | Passed. Raw evidence: `npm-run-typecheck.log` and `npm-run-typecheck.status`. |
| `npm run format` | 0 | Passed and produced no unstaged tracked changes. Raw evidence: `npm-run-format.log` and `npm-run-format.status`. |
| `npm run build` | 0 | Passed. Raw evidence: `npm-run-build.log` and `npm-run-build.status`. |
| `bun scripts/start.ts --profile-load zai "write me a haiku and nothing else"` | 0 | Passed with a three-line haiku and no additional response text. Raw evidence: `zai-smoke.log` and `zai-smoke.status`. |

The test, lint, typecheck, format, build, and smoke gates passed. Two independent Deepthinker reviews completed, and all Blocker-Fix and In-scope-Fix findings were incorporated. Both permitted local Open Code Review invocations returned `skipped` because no files were selected and produced zero comments; no additional local OCR run was made.

The final structural check records 16 workspace rows, 57 dependency rows, and all six required buckets. Protected-file SHA-1 values match the pre-analysis `package.json`, `package-lock.json`, and `bun.lock` baseline. The target-relative diff contains only `project-plans/issue2233/plan.md` and this inventory. Gitignored raw logs do not appear in status. No production source, test, manifest, lockfile, workflow, script, generated tracked file, analysis configuration, or `.llxprt` content changed.
