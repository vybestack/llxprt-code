# Plan: Remove confirmed dead code and dependencies from core/runtime packages (#2234)

Plan ID: PLAN-20260914-ISSUE2234-CORERUNTIME-DEADCODE
Issue: #2234 (open, Code Quality / Modularization, milestone 0.12.0)
Inventory of record: `project-plans/issue2232-dead-code-inventory.md` (PLAN-20260824-ISSUE2232-INVENTORY)
Baseline verified: `main` @ `e5ec3a161` on branch `issue2234`
Family: packages/core, providers, tools, auth, settings, storage, telemetry, policy, mcp, lsp

## Accepted behavior (acceptance criteria)

- AC-1 (traceability): every removal below traces to an inventory row and to a
  current-source re-verification performed on this branch immediately before the
  deletion (reference matrix in this plan; re-run at implementation time per the
  inventory disposition workflow step 2).
- AC-2 (API compatibility): no package export-map target, public barrel export,
  entrypoint, or registration surface is removed. Verified: none of the removal
  candidates appear in the `exports` maps of core, providers, tools, or mcp.
- AC-3 (dynamic paths preserved): runtime-resolved and lazy-loaded paths stay
  intact: `tree-sitter-bash` / `tree-sitter-pwsh` WASM resolution in
  `packages/core/src/utils/shell-parser.ts` (lines 180 and 198), ast-grep lazy
  native loading through tools' own declarations, provider composition and
  registration, MCP discovery and OAuth surfaces.
- AC-4 (retained candidates documented): every inventory row in this family that
  is NOT removed is listed in the retained table with the reason.
- AC-5 (verification): package-level tests/typecheck/lint/build pass for touched
  workspaces (core, providers, tools, auth, policy), and the full repository
  verification cycle plus the `stepfun-37` smoke pass, because dependency
  manifests change cross-package.

Inputs and boundary cases: the inputs are the inventory rows for this family.
Boundary cases are exactly the ones the inventory flags: dynamic/registry-driven
surfaces, test-support consumed by live contracts, stale rows overtaken by
codebase movement since 2026-08-24, and the ToolNameValidator decision owned by
#3639.

Tests that prove it: these are pure deletions and manifest cleanups with no new
production behavior, so per inventory REQ-INV-006 the proof is that the existing
behavioral suites stay green plus absence gates (reference greps, lockfile
check, genai-import baseline check) and the startup smoke.

## Work stream A: production deletion (7 modules, all "definitely dead" rows)

| # | File | Inventory row | Current-source evidence @ e5ec3a161 |
|---|------|---------------|--------------------------------------|
| A1 | `packages/core/src/utils/gitLineChanges.ts` | core definitely dead | zero references; all `gitLineChanges` imports target `packages/tools/src/utils/gitLineChanges.ts` (read-file.ts, read_line_range.ts); not in core exports |
| A2 | `packages/providers/src/openai/IChatGenerateParams.ts` | providers definitely dead | zero references outside its own definition |
| A3 | `packages/providers/src/openai-responses/index.ts` | providers definitely dead (private barrel) | one-line barrel re-exporting `OpenAIResponsesProvider.js`; zero importers (all consumers import the provider module directly); not in providers exports |
| A4 | `packages/tools/src/tools/stubs.ts` | tools definitely dead | zero references (only a prose comment in flatOrNestedSetting.ts mentions "stubs") |
| A5 | `packages/tools/src/formatters/index.ts` | tools definitely dead (private barrel) | zero importers; export map exposes individual formatter modules, not this barrel |
| A6 | `packages/tools/src/types/index.ts` | tools definitely dead (private barrel) | zero importers; not in exports |
| A7 | `packages/tools/src/types/provider-content-types.ts` | tools definitely dead | zero references |

## Work stream B: test-support removal (providers)

Round-1 findings amended this stream: every deleted providers file that
appears in the issue1584 provider file inventory must get a
`DESTINATION_OVERRIDES` entry in `packages/providers/src/move-map-validation.test.ts`
mapping it to a surviving sibling, following the in-file precedents (#2272
CODEX_MODELS.ts, #2398 gemini/usageInfo.ts, #2627 ProviderContentExtractor.ts).
The guard's assertions are not weakened; deletions are recorded the way the
guard documents intentional deletions.

| # | Surface | Stale consumers to update |
|---|---------|---------------------------|
| B1 | `packages/providers/src/utils/userMemory.ts` (module: `isUserMemoryProfileProvider`, `resolveUserMemory`) | production imports it nowhere; agents has its own `resolveUserMemory` in `src/core/streamRequestHelpers.ts:327`. Remove the inert `vi.mock('../utils/userMemory.js', ...)` blocks from `src/openai/openaiReasoningPipeline.test.ts`, `src/openai/OpenAIRequestPreparation.issue1943.test.ts`, `.issue2853.test.ts`, `.issue2896.test.ts`, preserving all other production-behavior coverage in those files |
| B2 | `packages/providers/src/openai/buildResponsesRequest.ts` | delete its FOUR implementation-specific tests (`buildResponsesRequest.test.ts`, `.stripToolCalls.test.ts`, `.toolIdNormalization.test.ts`, `.undefined.test.ts` — round 1 found the fourth); remove the `OpenAI Responses legacy (buildResponsesRequest)` converter entry from `src/utils/chronologyProviderIsolation.test.ts` (a #1721 leak guard over live converters; a deleted converter cannot leak); remove tsconfig entries |
| B3 | `packages/providers/src/openai/estimateRemoteTokens.ts` | delete `estimateRemoteTokens.test.ts`; remove any cli tsconfig entries referencing it |
| B4 | `packages/providers/src/openai/openaiRequestParams.ts` | delete `openaiRequestParams.test.ts`; remove any cli tsconfig entries referencing it |
| B5 | `packages/providers/src/openai/test-types.ts` | zero references at all; no consumer updates needed |
| B6 | `packages/providers/src/openai-responses/buildResponsesInputFromContent.ts` | round 1 found additional test consumers beyond the plan: the chronology converter entry (remove like B2), `src/utils/request-media-resolution.test.ts` (remove only its cases exercising the helper, keep live-converter coverage), and `buildResponsesInputFromContent.mediaBlock.test.ts` (dedicated helper test — delete). In `OpenAIResponsesProvider.ephemerals.toolOutput.test.ts` and `OpenAIResponsesProvider.toolIdNormalization.test.ts` remove only the describe blocks exercising the dead helper; preserve provider coverage; reconcile cli tsconfig entries either way |
| B7 | `packages/providers/src/gemini/neutralConverters.ts` | delete `neutralConverters.test.ts` and `neutralConverters.property.test.ts`; remove the test-path entries from `packages/cli/tsconfig.json`, `packages/cli/tsconfig.noemit.json`, and `packages/providers/tsconfig.noemit.json` (round 1 found the third); regenerate `dev-docs/genai-import-baseline.md` with the documented generator (4 to 3 importers), then `npm run lint:genai-inventory` must pass |

Mandatory implementation rule for B: before each deletion, re-run the reference
grep for the module path and every exported symbol; grep `packages/cli/tsconfig.json`,
`packages/cli/tsconfig.noemit.json`, and any other tsconfig for test-path entries
of deleted test files; keep test files and describe blocks that cover live
production contracts.

## Work stream C: dependency declarations

| # | Manifest | Action | Evidence |
|---|----------|--------|----------|
| C1 | `packages/core/package.json` dependencies | remove `@ast-grep/napi` and all 13 `@ast-grep/lang-*` entries (c, cpp, csharp, go, java, json, kotlin, php, python, ruby, rust, scala, swift) | zero `@ast-grep` references in `packages/core/src`; tools owns all ast-grep usage and statically imports only the 8 lang packages it declares itself (`packages/tools/src/utils/ast-grep-utils.ts`); root manifest keeps its own declarations untouched |
| C2 | `packages/core/package.json` dependencies | remove `ajv-formats`, `execa`, `https-proxy-agent`, `micromatch` | zero static/dynamic/require references repo-wide (fixed-string search on `from 'dep'`, `import('dep')`, `require('dep')`) |
| C3 | `packages/core/package.json` dependencies | remove `diff`, `fast-glob`, `html-to-text`, `open`, `turndown`, `vscode-jsonrpc` | zero references in `packages/core`; every real consumer (agents, cli, tools, lsp) declares the dependency in its own manifest (cli declares `open`; lsp declares `vscode-jsonrpc`; tools declares `fast-glob`, `html-to-text`, `turndown`; agents/cli/tools declare `diff`) |
| C4 | `packages/core/package.json` devDependencies | remove `@types/diff`, `@types/html-to-text` | type stubs of removed dependencies; same ownership evidence as C3 |
| C5 | `packages/auth/package.json` devDependencies | remove `fast-check` | zero references in auth source and tests |
| C6 | `packages/policy/package.json` devDependencies | remove `fast-check` | zero references in policy source and tests |
| C7 | `packages/providers/package.json` | move `@ai-sdk/provider-utils` from dependencies to devDependencies | only consumer is a type-only import in `src/openai-vercel/messageConversion.test.ts`, which remains |
| C8 | lockfiles | regenerate `bun.lock` with plain `bun install` (never `--frozen-lockfile`) and `package-lock.json` with the repository's lockfile regeneration convention; `npm run check:lockfile` must pass | inventory disposition workflow step 6 |

Retained core dependencies that look static-scan-dead but are runtime-resolved:
`tree-sitter-bash` and `tree-sitter-pwsh` (WASM `require.resolve` in
shell-parser.ts), `@dqbd/tiktoken`, `picomatch` (used by filesearch).

## Retained candidates (documented per AC-4)

| Candidate | Inventory row | Reason not removed |
|-----------|---------------|--------------------|
| `packages/core/src/storage/SessionPersistenceService.ts` | core test-only | stale row: now production-live via `createSessionPersistenceService` wiring (agents `sessionControl.ts:302,949`, cli `cliSessionBootstrap.ts:275`, `performResume.ts`, `cliUiRuntime.ts`, core `configBaseCore.ts:155`) |
| `packages/providers/src/retryFailoverLogic.ts` | providers definitely dead | stale row: production importer `RetryOrchestrator.ts:81`, and RetryOrchestrator is constructed by `ProviderManager.ts:241,407` |
| `packages/tools` `html-to-text` dependency | tools dependency-only | stale row: live import in `src/tools/direct-web-fetch.ts:23` (same file also uses `turndown`) |
| mcp trio `src/auth/oauthProviderTestSetup.ts`, `src/client/mcp-client.oauth.fixtures.ts`, `src/client/mcpClientTestHelpers.ts` | mcp test-only | active shared test infrastructure extracted in #2092; consumers (`oauth-provider.authenticate.test.ts`, `oauth-provider.token.test.ts`, `mcp-client.oauth.test.ts`, `mcp-client.transport.test.ts`) cover live MCPOAuthProvider and MCP client OAuth/transport contracts; removing them would destroy behavioral coverage that #3293's boundaries protect |
| `packages/providers/src/openai/ToolNameValidator.ts` | providers test-only | decision owned by open #3639 (wire-or-delete, tied to the tool-name fabrication fix); removing it here would pre-empt that issue |
| core `tree-sitter-bash`, `tree-sitter-pwsh` | (covered by core dependency row caveat) | runtime WASM resolution in shell-parser.ts; dynamic constraint per inventory limitation 8 |
| providers composition/registration/OAuth/aliases/runtime subpaths, tools registry, MCP discovery | dynamic/registry-driven rows | registration and runtime string selection; retained by issue scope |
| settings, storage, telemetry, lsp, auth, policy public barrels and test preloads | public API/ambiguous + false positive rows | published API contracts and bunfig preloads; inventory assigns retain |

## Already removed before this branch (inventory rows complete, no action)

`core/src/utils/llm-edit-fixer.ts`, `core/src/code_assist/oauth-credential-storage.ts`,
`core/src/code_assist/setup.ts`, `providers/src/logging/ProviderContentExtractor.ts`,
`providers/src/retryStreamTimeout.ts`, `mcp/src/auth/oauth-provider-dependencies.ts`.
Verified zero dangling references on this branch, including the agents
provider-agnostic naming allowlist. The `ProviderContentExtractor` strings in
`packages/providers/src/move-map-validation.test.ts` are a #2627 deletion guard
and stay.

## Out of scope

- Root manifest and CLI-family declarations (gradient-string, @xterm/headless,
  root ast-grep family): owned by #2235 / #3295.
- agents package rows (messageStreamModelInfo.ts, agents test-only band): agents
  is not in this issue's family.
- test-utils storage dependency, vscode npm-run-all: not in this family.
- Any weakening of lint/typecheck/complexity rules.
- No new public API, workflow, agent-memory change, or quality-tool change.

## Base movement and typecheck note

The branch started from `e5ec3a161`, whose CI run was cancelled. Main then
merged #3667 (`8482268ac`, "fix(agents): use typed ephemeral key to restore
typecheck", fixing #3666) as `999ba5c49`; that change touches only
`packages/agents/src/core/profile/__tests__/profileRepositoryAdapter.test.ts`
and repairs the two TS errors round 1 hit locally. Before final verification,
merge `origin/main` into the issue branch; `npm run typecheck` must then pass.
A duplicate report filed during round 1 (#3668) was closed as a duplicate of
#3666.

## Implementation outcome notes

- Round 2 added to B2: `buildResponsesRequest.undefined.test.ts` (fourth
  dedicated test) and deleted `OpenAIResponsesProvider.ephemerals.toolOutput.test.ts`
  entirely (all its cases exercised the dead helper), keeping the three live
  utility tests in `OpenAIResponsesProvider.toolIdNormalization.test.ts`.
- The move-map guard required a second, documented edit the subagent could not
  make (project-plans is orchestrator-owned): the orchestrator updated the 16
  matching rows in `project-plans/issue1584/analysis/provider-move-map-detailed.md`
  to the deletion-override destinations, following the row-47 #2627 precedent
  style. Guard passes 20/20 (`tmp/issue2234/r3-movemap-guard.log`).
- Review round 1 (deepthinker, APPROVE-WITH-FIXES) found one In-scope-Fix:
  `dev-docs/genai-migration.md` lines 15 and 111 still recommended the deleted
  `neutralConverters.ts`. Fixed by the implementation subagent; no other live
  references remain in that file.
- Accepted non-runtime grep residuals (not modified): prose/examples in
  `packages/providers/src/openai/docs/params-mapping.md`, historical output in
  `packages/core/src/hooks/__tests__/test-run.log`, guard/baseline strings
  already enumerated above.
- Pre-existing and out of scope: standalone `bun scripts/lint.ts --tsconfig`
  mode rejects the long-standing cross-package test excludes and fails
  identically at origin/main (`tmp/issue2234/r2-tsconfig-head-baseline.log`);
  it is not part of `npm run lint` or CI. Raw shared-process `bun test
  packages/providers` has an environment auth flake; the repository's normal
  isolated runner is the gate (`tmp/issue2234/r2-providers-isolated.log`:
  639/640 pre-fix, sole failure the move-map doc now fixed).

## Verification (implementer must run and record)

1. Reference-absence gates: for every removed file and symbol, `git grep` over
   tracked non-plan files returns zero (allowing the documented guard/comment
   exceptions).
2. Affected package tests: core, providers, tools, auth, policy (and mcp, which
   is untouched, as a guard).
3. `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
   `npm run build` (full cycle; format leaves no unrelated changes).
4. `npm run lint:genai-inventory` after baseline regeneration.
5. `npm run check:lockfile` after lockfile regeneration.
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
   exits 0 (startup smoke exercises core runtime with the trimmed manifests).

## Review

deepthinker compliance review after implementation (cap: 2 rounds). OCR is
disabled until further notice per Andrew's instruction, so no OCR runs for this
issue; the cap of two local and two PR OCR reviews is therefore unused.
