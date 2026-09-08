# Plan: Dead Code and Dead Dependency Inventory for 0.12.0

Plan ID: PLAN-20260824-ISSUE2232-INVENTORY
Issue: #2232 (Remove dead code and dead dependencies for 0.12.0, OPEN, Code Quality / Modularization)
Generated: 2026-08-24
Deliverable type: Inventory/triage only. This plan produces no production code
changes and no removals. It records the accepted candidate evidence, classifies
each candidate, and assigns each confirmed item to a parent removal subissue.
Each removal subissue is a separate TDD plan that owns its own behavioral
verification.
Parent subissues: #3293 tools/test support, #3294 core/agents, #3295
dependency declarations, #3296 entrypoints/retained public surfaces, #3297 CLI,
#3298 providers.

## Status

This is the inventory phase of #2232. The acceptance criteria for this plan are
met when the inventory table below is checked in and the full repository
verification cycle passes unchanged. No code is deleted here.

## Accepted behavior

1. The inventory classifies candidate dead code and dead dependencies, record by
   record, using exactly six classifications: definitely dead, test-only, public
   API/ambiguous, dynamic/registry-driven, dependency-only, false positive.
2. Test-only code is classified separately from production dead code. When one
   subissue owns both categories, its plan and PR keep separately labeled
   production-deletion and test-support-removal work streams.
3. No candidate is removed solely from zero internal references. Every removal
   requires an ownership decision across source, dynamic, script, export-map,
   build, and bundle reachability, plus behavioral verification that matches the
   touched package family.
4. Public exports, interface members, registration hooks, and externally consumed
   types are retained unless a later focused review proves they are dead. The
   inventory prefers documenting them as public API/ambiguous or
   dynamic/registry-driven and defers removal.
5. Known false positive categories are recorded so they are not rediscovered as
   candidates in later slices: all package entrypoints and export-map targets,
   provider/tool/MCP registration surfaces, generated artifacts, test preloads,
   optional native modules, CLI grammar and native bundle dependencies, and
   published type-only modules.

## Scope

Production TypeScript packages under `packages/*`: a2a-server, agents, auth,
cli, core, ide-integration, lsp, mcp, policy, providers, settings, storage,
telemetry, test-utils, tools, vscode-ide-companion.

In scope:

- Orphan production modules, private barrels, class members, and exported symbols
  with no live consumer.
- Test-only modules and test support fixtures that ship inside workspace source.
- Dependency declarations (dependencies, devDependencies) that no source,
  dynamic, script, export, build, or bundle target reaches.
- Package-level entrypoints and export-map targets, classified as retained public
  surface or false positive unless focused review proves otherwise.
- Scripts and build configuration only where they affect dependency reachability or
  declared dependencies.
- The disposition workflow and behavioral evidence requirements for each later
  removal slice.

Out of scope for this inventory plan:

- Any code change, deletion, dependency move, manifest edit, or lockfile edit.
  The inventory records the disposition and the subissue that will do the work.
- New tool installation. Knip and Madge were evaluated; they are not installed
  and the inventory does not depend on them.
- Loosening lint, typecheck, or complexity rules to make cleanup pass.
- Removing public API, registration hooks, or entrypoints that fail the
  ownership check in the disposition workflow.

## Requirements

### REQ-INV-001: Full package coverage

Every workspace package under `packages/*` is named in the inventory table.
Packages may be grouped into a family row only where the evidence and the
disposition are identical across the covered packages, and each covered package
name is listed in the family cell.

### REQ-INV-002: Exact table contract

The inventory contains one primary table with exactly these columns in this order:

`package family | classification | candidate file/symbol/dependency | production references | test references | package/export/script reachability | dynamic/generated constraint | confidence | disposition | subissue`

Classification values are restricted to the six accepted terms. Each row states the
confidence assigned to that specific candidate.

### REQ-INV-003: Test-only separation

Test-only code is separated from production dead code. Subissues #3293, #3294,
#3297, and #3298 each contain two separately labeled work streams: production
deletion and test-support removal. A later plan and PR must preserve that split
even when both work streams share the same package-family subissue.

### REQ-INV-004: Subissue assignment

Every inventory row links to exactly one real parent subissue: #3297 CLI, #3294
core/agents, #3298 providers, #3293 tools/test support, #3295 dependency
declarations, or #3296 entrypoints and retained public surfaces.

### REQ-INV-005: Documented baseline

The inventory records the methods, baseline results, and limitations of the
analysis so later slices can reproduce the evidence without rerunning the full
audit.

### REQ-INV-006: Later behavioral evidence

Every removal slice defines its own behavioral evidence. Behavior changes start
with a failing behavioral or package-contract test. Pure deletion preserves the
relevant existing behavior tests. Obsolete implementation-specific tests may be
deleted only when no production contract remains.

### REQ-INV-007: Completion criteria

Completion requires the inventory document to exist with all packages covered, all
rows classified and assigned, the disposition workflow defined, later evidence
rules defined, and the full repository verification cycle passing without touching
any other file.

## Analysis methods and baseline results

Method stack, in the order used:

1. The repository typecheck command is `npm run typecheck`; its baseline passed.
2. The repository lint command is `npm run lint`; the current pass is recorded in
   the verification results below. The definitely-dead candidate paths in the
   inventory table were also passed to `node_modules/.bin/eslint` with
   `--max-warnings 0`. The expanded one-shot command was not retained.
3. Installed `ts-prune` was run as
   `node_modules/.bin/ts-prune -p packages/<workspace>/tsconfig.build.json` for
   agents, core, providers, tools, and CLI. Auth and settings were checked with
   `packages/auth/tsconfig.json` and `packages/settings/tsconfig.json`.
4. Installed `depcheck` was run from the repository root as
   `node_modules/.bin/depcheck packages/<workspace> --json --ignore-patterns=dist,bundle`.
   Root-level depcheck was rejected because workspace declarations and shared
   tooling made its output unsuitable as package ownership evidence.
5. Package export-map targets were resolved and validated. Source searches and
   reference analysis covered static imports, literal dynamic imports, scripts,
   metadata, build configuration, bundle configuration, and registration paths.
6. An independent graph used the TypeScript preprocessor and resolved TypeScript
   and TSX files, literal dynamic imports, workspace package names, package
   exports, `main` and `bin` targets, and script roots. The first pass incorrectly
   mapped `.js` imports without trying `.tsx`; that pass was discarded and the
   corrected graph was used. The one-shot graph command and its output were not
   retained.
7. Knip and Madge were unavailable and were not installed.

Cross-tool agreement raised confidence only after source, export, script, build,
bundle, metadata, and reference checks agreed. A single tool hit was not accepted
as removal evidence.

## Baseline results, by family

- CLI (#3297): high-confidence orphan modules remain in config, ui commands, ui
  components, ui hooks, ui constants, ui privacy, and services. `NavigationMenu`
  has no consumer, while `ProfileCreateWizard` is rendered by `DialogManager`.
  CLI test helpers reached by setup, tsconfig, or tests are retained under #3296.
- Core/agents (#3294): two orphan production modules remain in core/utils and one
  orphan module remains in agents. Core test-utils export subpaths have
  cross-package test consumers. Agents test-utils have test consumers and are
  excluded from the production build. The dependency candidate family belongs
  to core only; agents `diff` is directly imported.
- Providers (#3298): six orphan production modules or private barrels remain,
  along with a separate test-only band. Provider composition, registration,
  OAuth, aliases, runtime subpaths, and export-map targets remain dynamic or
  public surfaces.
- Tools/MCP (#3293): four orphan production modules remain in tools. MCP auth and
  client fixtures form a test-only band. MCP
  `src/auth/oauth-provider-dependencies.ts` has no consumer or export and is
  definitely dead. Tool registry and MCP discovery surfaces are retained.
- Entrypoints/retained (#3296): metadata and script entrypoints, generated assets,
  package declarations, test preloads, optional native modules, published
  type-only modules, and reachable test-utils are retained.
- Settings, storage, policy, telemetry, auth, and ide-integration have no confirmed
  standalone dead production module after export and runtime checks. Public
  barrels and test preloads have separate rows. Stale dependency declarations
  are tracked under #3295.
- Dependencies (#3295): confirmed stale declarations include `gradient-string`
  in the root and CLI manifests, the root CLI-family `@xterm/headless` duplicate,
  `fast-check` in auth, ide-integration, and policy, test-utils storage, and tools
  `html-to-text`. The VS Code `npm-run-all` declaration is assigned here but
  requires a decision because its script names `npm-run-all2`.

## Limitations

1. Root-level depcheck output was discarded as monorepo noise.
2. The one-shot corrected graph command and output were not retained. The graph
   method and the discarded `.js` to `.tsx` resolution bug are recorded above so
   later removal slices can repeat the analysis.
3. Knip and Madge were not installed. No claim of exhaustive reachability rests
   on a single tool.
4. VS Code declares `npm-run-all` while its watch script invokes `npm-run-all2`.
   The dependency slice must decide whether to change the declaration or the
   script before editing the manifest.
5. Providers `@ai-sdk/provider-utils` is test-only; a move to devDependencies
   applies only while its test remains.
6. JSX and command registration must be rechecked immediately before deletion in
   the CLI slice. Current source proves `ProfileCreateWizard` is live and
   `NavigationMenu` is unreferenced.
7. Medium/high-confidence core dependency candidates, including the `@ast-grep`
   family, `tree-sitter-*`, and `vscode-jsonrpc`, require source, dynamic, script,
   export, bundle, and build checks plus core build, package-content inspection,
   and consumer smoke before removal.
8. `typescript-language-server` is reached by command string and `@dqbd/tiktoken`
   is resolved by the VS Code esbuild script. Static scans do not see either
   runtime path.

## Primary inventory table

| package family | classification | candidate file/symbol/dependency | production references | test references | package/export/script reachability | dynamic/generated constraint | confidence | disposition | subissue |
|---|---|---|---|---|---|---|---|---|---|
| cli (`@vybestack/llxprt-code`) | definitely dead | orphan symbols `AuthInProgress`, `RawMarkdownIndicator`, `SecureKeyInput`, `StatusDisplay`, `NavigationMenu`, `CloudFreePrivacyNotice`, `renderLoopDetector`, `useRefreshMemoryCommand`, `useShowMemoryCommand`, `useSession` (hooks), `ui/constants/tips.ts` | none found in source or corrected reference graph; repository search finds `NavigationMenu` only in its definition | none | not exported from package entrypoints | none found | high | remove | #3297 |
| cli | test-only | `config/auth.ts` symbol `validateAuthMethod`; `ui/commands/lspCommand.ts` | none | `config/auth.test.ts` imports and exercises `validateAuthMethod`; `ui/commands/lspCommand.test.ts` imports and exercises `lspCommand` | not exported from package entrypoints; command is not registered | test reachability only | high | remove obsolete implementations and implementation-specific tests after confirming no production contract remains | #3297 |
| cli | false positive | `ui/components/ProfileCreateWizard/index.tsx` and its supporting modules | imported and rendered by `ui/components/DialogManager.tsx`; `TextInput` is also imported by live dialogs | wizard behavior tests import its utilities and constants | live JSX path in `DialogManager` | JSX reachability was confirmed after correcting TSX resolution | high | retain | #3296 |
| cli | test-only | `services/cliCommandApiMap.ts`; hooks `useKittyKeyboardProtocol`, `useRewind`, `useStableCallback`, `useStaticHistoryRefresh`; `utils/commentJson.ts`; `utils/privacy/PrivacyManager.ts` | none | consumed by tests only | not exported | none found | high | remove test-only surfaces while preserving the production import guard | #3297 |
| cli | test-only | `src/test-utils` and package-root `test-utils` | none | directly imported throughout CLI tests | `bun-test-setup.ts` preloads `src/test-utils/customMatchers.ts` and package-root Ink stubs; `tsconfig.bun.json` maps Ink test modules; the test runner includes `test-utils` as a root | test setup and test compilation only | high | retain and validate as test infrastructure | #3296 |
| cli | false positive | `ink`, `tinygradient`, `fzf` | `ink` is imported by the interactive UI and components; `tinygradient` by `ui/themes/color-utils.ts`; `fzf` by `useAtCompletion.ts`, `settingsDialogHooks.ts`, and `fuzzyFilter.ts` | tests also import Ink | direct source imports | none found | high | retain | #3296 |
| cli | dependency-only | `gradient-string` in root `package.json` and `packages/cli/package.json`; root CLI-family declaration of `@xterm/headless` | no source import of `gradient-string`; no CLI import of `@xterm/headless`; core imports `@xterm/headless` through its own declaration | none attributable to these declarations | no source, script, bundle, metadata, main, bin, or export target reaches either `gradient-string` declaration or the root `@xterm/headless` declaration | root and CLI manifests share the CLI package name; ownership must be validated at each declaration before removal | high | validate and remove all three stale declarations | #3295 |
| core (`@vybestack/llxprt-code-core`) | definitely dead | `src/utils/gitLineChanges.ts` (live sibling remains in tools `src/utils/gitLineChanges.ts`) | none in core | none in core | not exported from core entrypoints | none found | high | remove core copy | #3294 |
| core | definitely dead | `src/utils/llm-edit-fixer.ts` | no code consumer; `clientContract.ts` contains a comment reference | `agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts` contains a string entry | not exported | string references do not create runtime reachability | high | remove and update the stale allowlist entry | #3294 |
| core | test-only | `src/code_assist/oauth-credential-storage.ts`; `src/code_assist/setup.ts`; `src/storage/SessionPersistenceService.ts` | none | consumed by tests only | not exported from published maps | none found | high | remove test-only surfaces | #3294 |
| core | test-only | `src/test-utils` | none outside test support | core tests and cross-package tests import these helpers | package exports include test-utils subpaths for `providerCallOptions`, `mock-tool`, and `runtime`; workspace test resolution also reaches other helpers | package-contract and test reachability | high | retain and validate exported test infrastructure | #3296 |
| core | public API/ambiguous | published core barrel exports and exported interface members | some internal; public surface by package intent | package tests | package entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain unless focused review proves dead | #3296 |
| core | dependency-only | `@ai-sdk/openai`, `@anthropic-ai/sdk`, `@ast-grep/lang-*` family, `@ast-grep/napi`, `ai`, `ajv-formats`, `cheerio`, `diff`, `execa`, `fast-glob`, `html-to-text`, `https-proxy-agent`, `micromatch`, `node-fetch`, `open`, `openai`, `tree-sitter-bash`, `tree-sitter-pwsh`, `turndown`, `vscode-jsonrpc` | no direct static import found in core source | possibly none | one or more may be reached dynamically, from scripts, through bundles, or via export maps | dynamic, script, export, build, and bundle checks required before removal | medium | remove only after ownership proof plus core build, package-content inspection, and consumer smoke | #3295 |
| agents (`@vybestack/llxprt-code-agents`) | definitely dead | `src/core/messageStreamModelInfo.ts` (live sibling `src/core/modelInfoHelpers.ts` remains) | none | none | not exported | none found | high | remove | #3294 |
| agents | test-only | `src/core/bucketFailoverIntegration.ts`; chatSession helpers `chatSession-runtime-helpers.ts`, `chatSession-thinking-helpers.ts`, `chatSession-tokenSync-helpers.ts`; `src/core/compression-config.ts`; `src/core/contentBlockHelpers.ts`; `src/core/tokenUsageTestAssertions.ts` | none | consumed by tests only | not exported from published maps | none found | high | remove test-only surfaces | #3294 |
| agents | test-only | `src/test-utils` | none | agents tests and Bun tests import the helpers | excluded by `tsconfig.build.json`; reached by the test tsconfig and test imports | test compilation only | high | retain and validate as test infrastructure | #3296 |
| agents | false positive | `diff` dependency | `src/scheduler/confirmation-coordinator.ts` imports `diff` | scheduler tests exercise the consumer | direct source import and package declaration | none found | high | retain | #3296 |
| agents | public API/ambiguous | published agents barrel exports and test contract helpers retained for package behavior | some internal; public surface by package intent | package tests | entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain unless focused review proves dead | #3296 |
| providers (`@vybestack/llxprt-code-providers`) | definitely dead | `src/logging/ProviderContentExtractor.ts`; `src/openai/IChatGenerateParams.ts`; `src/retryFailoverLogic.ts`; `src/retryStreamTimeout.ts`; `src/openai-responses/index.ts` (private barrel) | no code consumer | `agents/src/core/__tests__/providerAgnosticNamingAllowlist.ts` contains two string entries for `ProviderContentExtractor` | not exported from package entrypoints; private barrel has no external consumer | allowlist strings do not create runtime reachability | high | remove and update the stale allowlist entries | #3298 |
| providers | definitely dead | `src/utils/userMemory.ts` | no production consumer | mocked by `src/openai/openaiReasoningPipeline.test.ts`, `OpenAIRequestPreparation.issue1943.test.ts`, `OpenAIRequestPreparation.issue2853.test.ts`, and `OpenAIRequestPreparation.issue2896.test.ts` | not exported from package entrypoints | test mocks do not create runtime reachability | high | remove the module and update stale mocks while preserving production-behavior coverage | #3298 |
| providers | test-only | old OpenAI `src/openai/buildResponsesRequest.ts`, `src/openai/estimateRemoteTokens.ts`, `src/openai/openaiRequestParams.ts`, `src/openai/ToolNameValidator.ts`, `src/openai/test-types.ts`, `src/openai-responses/buildResponsesInputFromContent.ts`; Gemini `src/gemini/neutralConverters.ts` | none | consumed by tests only | not exported from published maps | none found | high | remove test-only surfaces | #3298 |
| providers | dependency-only | `@ai-sdk/provider-utils` | none in production source | used by a providers test | not exported | move applies only if the test remains | high | move to devDependencies with its test, else retain | #3295 |
| providers | dynamic/registry-driven | provider composition, provider registration, provider aliases, runtime subpaths, OAuth flows, export-map targets | reached through registry and runtime selection | package tests | export-map targets | registry and runtime string selection | high | retain; export-map targets remain assigned to #3296 | #3296 |
| tools (`@vybestack/llxprt-code-tools`) | definitely dead | `src/tools/stubs.ts`; `src/formatters/index.ts`; `src/types/index.ts`; `src/types/provider-content-types.ts` | none | none | not exported from package entrypoints | none found | high | remove | #3293 |
| tools | dependency-only | `html-to-text` | none in tools source | none | none | none found | high | remove | #3295 |
| mcp (`@vybestack/llxprt-code-mcp`) | test-only | `src/auth/oauthProviderTestSetup.ts`; `src/client/mcp-client.oauth.fixtures.ts`; `src/client/mcpClientTestHelpers.ts` | none | consumed by tests and fixtures only | not exported from published maps | none found | high | remove test-only surfaces | #3293 |
| mcp | definitely dead | `src/auth/oauth-provider-dependencies.ts` and `MCPOAuthProviderDependencies` | repository and package searches find no consumer | none | absent from `index.ts`, `src/index.ts`, package exports, scripts, build roots, and metadata | none found | high | remove | #3293 |
| tools, mcp | false positive | tool registry, MCP server and client discovery, MCP client entrypoints | reached via registry and discovery | package tests | export-map targets | registry and discovery driven | high | retain | #3296 |
| auth (`@vybestack/llxprt-code-auth`) | dependency-only | `fast-check` | none | no auth source or test import | already declared in devDependencies; no script, export, build, or metadata ownership | none found | high | remove stale devDependency | #3295 |
| auth | public API/ambiguous | published auth barrel exports | some internal | package tests | entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| ide-integration (`@vybestack/llxprt-code-ide-integration`) | dependency-only | `fast-check` | none | no ide-integration source or test import | already declared in devDependencies; no script, export, build, or metadata ownership | none found | high | remove stale devDependency | #3295 |
| ide-integration | public API/ambiguous | published ide-integration barrel exports | some internal | package tests | entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| policy (`@vybestack/llxprt-code-policy`) | dependency-only | `fast-check` | none | no policy source or test import | already declared in devDependencies; no script, export, build, or metadata ownership | none found | high | remove stale devDependency | #3295 |
| policy | public API/ambiguous | published policy barrel exports | some internal | package tests | entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| test-utils (`@vybestack/llxprt-code-test-utils`) | dependency-only | `@vybestack/llxprt-code-storage` | none in test-utils source | none | none | none found | high | remove | #3295 |
| settings (`@vybestack/llxprt-code-settings`) | public API/ambiguous | published settings barrels | some internal; public surface by package intent | package tests | package entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| settings | false positive | `test-setup-storage-isolation.ts` | none | loaded by settings `bunfig.toml` | Bun test preload | test-runner configuration | high | retain | #3296 |
| storage (`@vybestack/llxprt-code-storage`) | public API/ambiguous | published storage barrels | some internal; public surface by package intent | package tests | package entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| storage | false positive | `test-setup-storage-isolation.ts`; `test-setup-bun-session-reset.ts` | none | loaded by storage `bunfig.toml` | Bun test preloads | test-runner configuration | high | retain | #3296 |
| telemetry (`@vybestack/llxprt-code-telemetry`) | public API/ambiguous | published telemetry barrels | some internal; public surface by package intent | package tests | package entrypoint and export-map targets | published API contract | high (on the API intent axis) | retain | #3296 |
| telemetry | false positive | `test-setup-storage-isolation.ts` | none | loaded by telemetry `bunfig.toml` | Bun test preload | test-runner configuration | high | retain | #3296 |
| a2a-server (`@vybestack/llxprt-code-a2a-server`) | false positive | `src/http/server.ts` | metadata/script entrypoint | package tests | start script and metadata | script entrypoint | high | retain | #3296 |
| lsp (`@vybestack/llxprt-code-lsp`) | false positive | `src/main.ts`; `typescript-language-server` dependency | main reached through the lsp start script; `typescript-language-server` reached by command string | none | script entrypoint | command-string resolution | high | retain | #3296 |
| vscode-ide-companion (`llxprt-code-vscode-ide-companion`) | false positive | `src/extension.ts`; `@dqbd/tiktoken` | extension is the metadata `main`; `@dqbd/tiktoken` is resolved by `esbuild.ts` | package tests cover extension behavior | metadata entrypoint and esbuild resolution | metadata and build-time resolution | high | retain | #3296 |
| vscode-ide-companion | dependency-only | `npm-run-all` | none | none | package declares `npm-run-all`, but the watch script invokes `npm-run-all2` | script and declaration mismatch requires an ownership decision | high | decide whether to declare `npm-run-all2` or change the script before removing `npm-run-all` | #3295 |
| generated (all) | false positive | generated prompt manifest and prompt Markdown, generated schema assets, generated CLI files, package declarations, optional native modules, published type-only modules | prompt Markdown consumed by `scripts/generate_prompt_manifest.ts` and core manifest-loader; others by build and publish | none | scripts, build, and export maps | generation and build driven | high | retain | #3296 |

## Disposition workflow

1. A removal subissue takes only rows assigned to it from this table. The
   subissue writes its own TDD plan under `project-plans/` with its own Plan
   ID and phase sequence, per `dev-docs/PLAN.md` and `dev-docs/PLAN-TEMPLATE.md`.
2. Before any deletion, the subissue rechecks the candidate against current
   source: import graph, dynamic references, script references, export-map
   membership, bundle and build references, and metadata. For CLI candidates,
   recheck JSX usage and command registration immediately before deletion.
3. Deletions of `definitely dead` production modules are pure deletions. They
   preserve the existing behavioral tests that cover the remaining live paths. An
   obsolete implementation-specific test may be deleted only when no production
   contract remains for it.
4. Behavior changes and any deletion that removes behavior start with a failing
   behavioral test or a failing package-contract test. The subissue never
   reverses the test order.
5. Reachable `test-only` rows assigned to #3296 are retained and validated.
   Obsolete `test-only` rows are removed as separately labeled test-support work
   in their package-family subissue, so they are never conflated with production
   deletion.
6. `dependency-only` rows move or remove the declaration only after proving no
   source, dynamic, script, export, build, or bundle ownership. The subissue
   updates the manifest and lockfile, inspects the installed package output, and
   exercises a consumer. Providers `@ai-sdk/provider-utils` moves to
   devDependencies only if its test remains; the VS Code `npm-run-all`
   decision is settled before that manifest is touched.
7. `public API/ambiguous` and `dynamic/registry-driven` rows are retained.
   A later focused review may reclassify one; the reclassification must state
   the public API intent or the registration surface that was checked.
8. `false positive` and `retain` rows are closed as documented, so the next
   audit does not raise them again. No removal happens solely from zero internal
   references.

## Later behavioral evidence

Every removal slice runs, in order:

1. Affected package tests.
2. Targeted package checks (lint and typecheck for the touched package).
3. Full repository verification: `npm run test`, `npm run lint`,
   `npm run typecheck`, `npm run format`, `npm run build`.
4. Startup or integration smoke appropriate to the package family (the CLI smoke
   command is `bun scripts/start.ts --profile-load stepfun-37` with a prompt).
5. For dependency slices: no source, dynamic, script, export, build, or bundle
   ownership; updated manifest and lockfile; inspected package output; an
   exercised consumer.
6. Formatting leaves no unrelated changes.

A slice does not merge while CI or CodeRabbit findings are unresolved, and no PR
merges without user approval.

## Review results

Two local Open Code Review rounds were triaged by source and issue evidence.

- Round 1 produced three medium findings and one low finding. All four were
  `In-scope-Fix`: move CLI auth validation and the unregistered LSP command to
  `test-only`; require separate production-deletion and test-support work streams
  in shared subissues; remove the stale failed-verification contradiction after a
  green run; and require every inventory row to link to one subissue.
- Round 2 produced one medium `In-scope-Fix`: add CLI subissue #3297 to the
  separate-work-stream requirement. The #3293, #3294, #3297, and #3298 issue
  bodies now label both work streams.
- Across these OCR rounds, no finding was classified `Blocker-Fix`, `Reject`, or
  `Defer`. No review finding authorized production removal or another change
  outside the inventory phase.
- An independent source review produced two `In-scope-Fix` findings. The
  `gradient-string` inventory now covers both manifest declarations, and the
  providers `userMemory.ts` row now records four test mocks that must be updated
  without discarding production-behavior coverage.
- The same review produced one environmental `Blocker-Fix`: its test run exhausted
  disk space because an unused 178 GB temporary log filled the data volume. The
  stale log was not open by any process and was removed before the verification
  cycle recorded below. No `Reject` or `Defer` finding required a change.

## Verification results

The required verification cycle passed on the inventory candidate:

1. `npm run test`: passed with exit code 0 across all workspaces in the final
   post-review run after competing worktree test jobs completed. Timeout failures
   from resource-contended runs did not reproduce.
2. `npm run lint`: passed with exit code 0.
3. `npm run typecheck`: passed with exit code 0.
4. `npm run format`: passed with exit code 0 and changed no tracked file.
5. `npm run build`: passed with exit code 0.
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`:
   passed with exit code 0 and returned a three-line haiku from
   `step-3.7-flash`.

The inventory run did not alter source or test files.

## Completion criteria

- [x] The inventory document exists with Plan ID PLAN-20260824-ISSUE2232-INVENTORY.
- [x] All sixteen workspace packages are named, directly or in a family row that
      lists each covered package name.
- [x] The primary table uses exactly the ten required columns in order.
- [x] Every row uses only the six accepted classifications.
- [x] Every inventory row links to exactly one real parent subissue in #3293,
      #3294, #3295, #3296, #3297, or #3298.
- [x] Test-only rows are separated from production dead code.
- [x] Disposition workflow, later behavioral evidence, and limitations are
      documented.
- [x] `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
      `npm run build`, and the stepfun-37 CLI smoke all pass with no unrelated
      changes.
