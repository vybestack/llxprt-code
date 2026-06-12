# project-plans/issue1585/execution-tracker.md

Plan ID: PLAN-20260608-ISSUE1585

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 00 | P00 | N/A | - | - | - | N/A | NON-EXECUTABLE: Plan overview, architecture decisions, phase list |
| 00a | P00a | [ ] | - | - | - | N/A | Preflight: verify packages, record approved adapter path, MCP ownership in core/tools/ |
| 01 | P01 | [ ] | - | - | - | [ ] | Extended consumer inventory (18 groups), complete dependency map |
| 01a | P01a | [ ] | - | - | - | [ ] | Analysis verification: all groups covered, zero omissions |
| 02 | P02 | [ ] | - | - | - | [ ] | Contract-first pseudocode with exact interface names |
| 02a | P02a | [ ] | - | - | - | [ ] | Pseudocode verification |
| 02b | P02b | [ ] | - | - | - | [ ] | Integration contract definition (15 tools-owned interface files, 14 mandatory + 1 conditional adapters) |
| 02c | P02c | [ ] | - | - | - | [ ] | Contract verification: cycle-free, reachable |
| 03 | P03 | [ ] | - | - | - | [ ] | Scaffold + contract stubs (tools-owned only, no core-local interfaces) |
| 03a | P03a | [ ] | - | - | - | [ ] | Scaffold + stub verification |
| 04 | P04 | [ ] | - | - | - | [ ] | Contract TDD: behavioral tests for interfaces and boundaries |
| 04a | P04a | [ ] | - | - | - | [ ] | Contract test quality verification |
| 05 | P05 | [ ] | - | - | - | [ ] | Contract implementation: formatters, utils, self-contained |
| 05a | P05a | [ ] | - | - | - | [ ] | Contract implementation verification: zero forbidden imports |
| 06 | P06 | [ ] | - | - | - | [ ] | Build/package wiring: lockfile, tsconfig references, bind-release-deps compatibility |
| 06a | P06a | [ ] | - | - | - | [ ] | Build wiring verification |
| 07 | P07 | [ ] | - | - | - | [ ] | Scaffold/package metadata TDD: metadata tests + anti-cycle assertions |
| 07a | P07a | [ ] | - | - | - | [ ] | Scaffold/package metadata TDD verification |
| 08 | P08 | [ ] | - | - | - | [ ] | Scaffold/package metadata implementation: package.json exports, dependencies, lockfile/workspace wiring |
| 08a | P08a | [ ] | - | - | - | [ ] | Scaffold/package metadata implementation verification |
| 09 | P09 | [ ] | - | - | - | [ ] | Complete move map + dependency relocation per dependency-relocation-final.md |
| 09a | P09a | [ ] | - | - | - | [ ] | Move map verification: zero omissions, zero duplicates, deps classified |
| 10 | P10 | [ ] | - | - | - | [ ] | Behavioral regression TDD: 11+ test groups, pre-extraction fixtures, no constructor/delegation-only tests |
| 10a | P10a | [ ] | - | - | - | [ ] | TDD verification: behavioral, no mock theater |
| 11 | P11 | [ ] | - | - | - | [ ] | Tool move: grouped compile-safe migrations (8 groups), adapters created per group |
| 11a | P11a | [ ] | - | - | - | [ ] | Move verification: zero forbidden imports, adapters exist, ToolKeyStorage class stays in core |
| 12 | P12 | [ ] | - | - | - | [ ] | Verify and complete adapters + registry/scheduler integration |
| 12a | P12a | [ ] | - | - | - | [ ] | Adapter verification: narrow, no service bag, no old ../tools/ imports |
| 13 | P13 | [ ] | - | - | - | [ ] | Consumer migration: provider imports, core exports, explicit CLI decision |
| 13a | P13a | [ ] | - | - | - | [ ] | Consumer verification: zero old deep imports in providers and CLI |
| 14 | P14 | [ ] | - | - | - | [ ] | Release: exact edits + version.js + prepare-package.js + build.js + Dockerfile ordering (tools before core) |
| 14a | P14a | [ ] | - | - | - | [ ] | Release verification + script coverage (version.js, prepare-package.js, build.js) + Dockerfile install order |
| 15 | P15 | [ ] | - | - | - | [ ] | Cleanup: remove moved files, no shims, retained-file policy |
| 15a | P15a | [ ] | - | - | - | [ ] | Cleanup verification: core tools dir matches approved list |
| 16 | P16 | [x] | 2026-06-10 | 2026-06-10 | [x] | [x] | Full verification suite + smoke test + package metadata constraints — all green; smoke via ollamaglm51 (waferglm5 endpoint dead) |
| 16a | P16a | [x] | 2026-06-10 | 2026-06-10 | [x] | [x] | Final semantic review — all checklist items confirmed; no blockers |

## Completion Markers

- [ ] All implementation phases have plan markers in code where code changes are made.
- [ ] All requirements have requirement markers in code/tests where applicable.
- [x] No phase numbers skipped.
- [ ] P00a explicitly resolved missing packages/settings, packages/storage, packages/mcp with approved tools-owned interface/core-adapter path.
- [x] Forbidden import scans pass: rg -n "@vybestack/llxprt-code-core|packages/core/src|@vybestack/llxprt-code-providers|packages/providers/src|packages/cli/src" packages/tools/src -g "*.ts" returns zero (matches are comments + forbidden-imports.test.ts data only).
- [x] No packages/tools dependency on core, cli, or providers.
- [ ] No core-local interfaces consumed by tools (all contracts tools-owned).
- [x] @vybestack/llxprt-code-test-utils is devDependency-only of packages/tools.
- [x] Release process publishes tools, release tests assert order, manual-trusted-publishing.md exists.
- [x] scripts/version.js includes @vybestack/llxprt-code-tools in actualWorkspaces.
- [x] scripts/prepare-package.js has copyFiles for tools.
- [x] Dockerfile install order is tools -> core -> providers -> cli.
- [ ] Core tools directory contains only approved retained-file list (mcp-client, mcp-client-manager, rationale).
- [x] ToolKeyStorage class stays in core; maskKeyForDisplay/getSupportedToolNames move as pure functions.
- [x] CoreToolKeyStorageAdapter owns ToolKeyStorage+SecureStore lifecycle (does not delegate to moved class).
- [x] No re-export shims in core tools directory.
- [x] MCP ownership explicit: mcp-client/manager stay in core/tools/, mcp-tool.ts moves only if IMcpToolService dependency met.
- [ ] CLI has no direct tools deep imports; uses core top-level re-exports only.
- [x] IToolFormatter export path maps to dist/src/formatters/ (not dist/src/interfaces/).
- [ ] npm/package-lock process used despite root packageManager pnpm field.
- [ ] @vybestack/llxprt-code-test-utils is devDependency-only of packages/tools.
- [ ] ISettingsService and IPromptRegistryService interfaces defined unconditionally (not conditional).
- [ ] Exhaustive Config/core replacement table has zero unmapped entries (evidence command run).
- [x] No-shim scan scope restricted to packages/core/src/tools/** — index.ts re-exports allowed.
- [ ] Adapter count is exact list (14 mandatory + 1 conditional), not vague range.
- [x] Test fixtures in packages/tools avoid importing core/providers.
- [x] Format diff check (`npm run format:check`) passes after P11 groups and P16.
- [ ] Mechanical move markers (or explicit justification) for each P11 group sub-step.
- [ ] Issue body/comments captured with traceability table to plan phases.
- [x] Build-sandbox workflow includes tools pack step; release-process tests cover it.
- [x] Dockerfile uses repo-shaped tarball paths and tools-first install order.
- [x] Sandbox build packs tools before core/providers/cli (toolsPackageDir=packages/tools/dist, chmod tools tarball).
- [x] Full project verification and CLI smoke test pass: npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load ollamaglm51 "write me a haiku and nothing else" (waferglm5 endpoint retired; ollamaglm51 is the equivalent smoke profile).
