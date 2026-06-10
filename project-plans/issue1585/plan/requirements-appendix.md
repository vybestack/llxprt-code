# Requirements Appendix: Full Requirement Blocks For All Phases

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This appendix defines the complete requirement blocks for every implementation and verification phase. Each phase plan file MUST reference the relevant requirement block(s) below and include phase-specific behavior in addition to what is specified here.

All requirement blocks follow the GIVEN/WHEN/THEN pattern adapted for refactoring behavior preservation. "Why it matters" explains the impact if the requirement is violated.

---

## REQ-BEHAVIOR-PRESERVATION (Cross-Cutting)

**Full text**: All tool behavior (filesystem read/write/edit/glob/grep, shell execution, todo operations, memory storage, key storage, MCP tool invocation, tool formatting, tool ID normalization) MUST remain identical after extraction. No user-visible behavior changes are permitted. CLI startup, tool discovery, scheduler execution, provider formatting, and sandbox builds must all produce the same results as before extraction.

**GIVEN**: A working repository with tools in `packages/core/src/tools/`
**WHEN**: Tools are extracted to `packages/tools/` with interface-based dependency inversion
**THEN**: Every tool invocation through CLI, scheduler, and direct execution produces identical `ToolResult`, filesystem state, storage state, and provider formatting output as before extraction.

**Why it matters**: This is a refactoring, not a feature addition. Any behavior change is a regression that must be detected and fixed before merge.

---

## REQ-PKG-BOUNDARY (P03, P04, P05, P06, P10, P11, P15)

**Full text**: `packages/tools` MUST NOT import from `packages/core`, `packages/cli`, `packages/providers`, or any core service module. All dependencies from tools to core services MUST be inverted through tools-owned interfaces defined in `packages/tools/src/interfaces/`. Core implements adapters in `packages/core/src/tools-adapters/` that delegate to concrete services.

**GIVEN**: Production tool code is moved to `packages/tools/`
**WHEN**: A forbidden import scan runs against `packages/tools/src/`
**THEN**: Zero matches for `@vybestack/llxprt-code-core`, `packages/core/src`, `@vybestack/llxprt-code-providers`, `packages/providers/src`, or `packages/cli/src`.

**Why it matters**: A tools→core dependency creates a package cycle that breaks publish ordering, prevents independent versioning, and defeats the architectural goal of modularity.

---

## REQ-INTERFACE-OWNERSHIP (P03, P05, P12)

**Full text**: ALL interfaces consumed by tools MUST be defined in `packages/tools/src/interfaces/`. Core may ONLY implement adapters. No core-local interfaces consumed by tools. ToolContext MUST remain narrow and MUST NOT become a grab-bag of generic services.

**GIVEN**: Tools need services from core (Config, MessageBus, shell execution, etc.)
**WHEN**: A service interface is defined for tool consumption
**THEN**: The interface file is in `packages/tools/src/interfaces/`, and the core adapter in `packages/core/src/tools-adapters/` implements exactly that one interface.

**Why it matters**: If core defines interfaces consumed by tools, the tools→core dependency direction is violated at the type level, creating the same cycle risk.

---

## REQ-CONFIG-REPLACEMENT (P09, P11, P12)

**Full text**: Every `this.config.*`, `config.*`, and `getConfig()` usage in `packages/core/src/tools/**` MUST be mapped to a specific tools-owned interface and adapter per `analysis/interface-contracts-detailed.md §10`. No Config import may remain in any moved tool file.

**GIVEN**: Production tool files currently import `Config` from `../config/config.js`
**WHEN**: Tool files are moved to `packages/tools/`
**THEN**: Every `this.config.*` call is replaced by a call on an injected tools-owned interface, and `import type { Config }` or `import { ApprovalMode } from '../config/config.js'` is eliminated from all moved files.

**Why it matters**: Any remaining Config import in tools creates a direct tools→core dependency, violating the fundamental package boundary.

---

## REQ-TEMPORARY-INTERFACES (P00a, P03, P05)

**Full text**: For services that belong in packages/settings, packages/storage, or packages/mcp (which do not currently exist), define temporary tools-owned interfaces now. When those packages are created, replace the temporary interfaces and delete corresponding core adapters. This plan does NOT block on their existence. Every temporary adapter MUST preserve the exact semantics of the original core service call.

**GIVEN**: packages/settings, packages/storage, and packages/mcp do not exist
**WHEN**: Tools need settings, storage, or MCP services
**THEN**: Temporary interfaces are defined in `packages/tools/src/interfaces/` (ISettingsService, IStorageService, IToolKeyStorage, IMcpToolService) with core adapters that delegate exactly as the original code did.

**Why it matters**: Blocking on future packages would prevent any progress. However, sloppy temporary interfaces that differ from core behavior would cause regressions.

---

## REQ-MOVE-MAP (P09, P09a)

**Full text**: Every file under `packages/core/src/tools/` MUST be classified exactly once: MOVE_NOW, MOVE_AFTER_INTERFACE, STAY_CORE_INFRASTRUCTURE, STAY_UNTIL_FUTURE_PKG, TEST_MOVES_WITH_SOURCE, or DELETE_AFTER_MIGRATION. No file may be UNCLASSIFIED or classified twice.

**GIVEN**: A directory of 150+ TypeScript files in `packages/core/src/tools/`
**WHEN**: The move map is produced in P09
**THEN**: The count of classified files equals the count of actual files, with zero duplicates and zero unclassified entries.

**Why it matters**: Missing a file means it is silently left in core (possible orphan) or deleted without migration (data loss). Double-classifying means conflicting actions.

---

## REQ-BEHAVIORAL-TDD (P10, P10a)

**Full text**: All tests MUST assert observable behavior (ToolResult content, filesystem state, provider formatting output, storage state, key values). Method-call assertions (`toHaveBeenCalled*`) are secondary evidence only and require justification. Tests that can pass with a no-op stub replacing the real implementation are insufficient.

**GIVEN**: Behavioral regression tests are written before production code moves
**WHEN**: The test suite runs
**THEN**: Tests fail if the real tool logic is broken, even if all adapter methods are called. Shell tests assert ToolResult output; todo tests assert observable state changes; key-storage tests assert exact key values and masking strings.

**Why it matters**: If tests only verify delegation (method was called), a no-op adapter that returns empty values passes the test, masking real regressions.

---

## REQ-CONSUMER-MIGRATION (P13, P13a)

**Full text**: Every static, test, mock, dynamic, and reference occurrence of tools imports across the entire repository MUST be classified exactly once and acted upon per `analysis/all-tool-consumers-final.md`. Zero old deep imports (except retained MCP/key-storage) may remain after P13.

**GIVEN**: ~130+ consumer import occurrences across providers, core, CLI, and tests
**WHEN**: Consumer migration completes
**THEN**: `rg -n "@vybestack/llxprt-code-core/tools/" packages -g "*.ts"` returns zero matches for moved modules. Retained MCP imports are explicitly allowed.

**Why it matters**: Any remaining old import path will break at runtime when core removes the deep export, causing silent failures or missing modules.

---

## REQ-NO-SHIMS (P15, P15a)

**Full text**: `packages/core/src/tools/` MUST NOT contain files that merely re-export from `@vybestack/llxprt-code-tools`. Explicit `packages/core/src/index.ts` top-level re-exports for CLI compatibility are allowed (not considered shims). The no-shim scan scope is restricted to `packages/core/src/tools/**`.

**GIVEN**: Moved files are removed from core in P15
**WHEN**: The no-shim scan runs against `packages/core/src/tools/`
**THEN**: Zero files contain `export * from '@vybestack/llxprt-code-tools'` or similar re-export patterns.

**Why it matters**: Re-export shims create dual import paths that confuse consumers and prevent detecting when a consumer accidentally uses the old deep path.

---

## REQ-RETAINED-CORE-TOOLS (P09, P15, P15a)

**Full text**: After cleanup, `packages/core/src/tools/` may only contain files from the approved allowlist: `mcp-client.ts`, `mcp-client-manager.ts`, `tool-key-storage.ts`, their tests, any explicitly classified `STAY_CORE_INFRASTRUCTURE` file with written rationale, and `mcp-tool.ts` if it receives conditional stay. All other files are moved or removed. No core/tools file may re-export from packages/tools.

**GIVEN**: P15 removes all moved files from `packages/core/src/tools/`
**WHEN**: P15a audits the remaining files
**THEN**: Only files in the approved allowlist remain, each with written rationale in the move map.

**Why it matters**: Without an explicit allowlist, files may be silently retained without rationale, potentially creating hidden coupling or orphan code.

---

## REQ-RELEASE-PROCESS (P14, P14a)

**Full text**: `.github/workflows/release.yml`, `.github/workflows/build-sandbox.yml`, `scripts/tests/release-process.test.js`, `scripts/build_sandbox.js`, `Dockerfile`, `scripts/version.js`, and `scripts/prepare-package.js` MUST all include the tools package. Publish order: tools → core → lsp → providers → cli. Dockerfile copy/install order: tools first using repo-shaped `packages/tools/dist/` paths and `/tmp/` install convention. Build-sandbox workflow packs tools before core/providers/cli. Release-process tests must cover build-sandbox workflow inclusion.

**GIVEN**: A new workspace package `@vybestack/llxprt-code-tools` is being published
**WHEN**: Release and sandbox workflows run
**THEN**: Tools is published before dependent packages, sandbox includes tools tarball, Dockerfile installs tools first, and all release tests pass.

**Why it matters**: Missing tools from release/publish causes downstream install failures. Wrong install order causes npm resolution failures for local tarballs.

---

## REQ-FORMAT-DIFF-CHECK (P11, P16)

**Full text**: `npm run format` modifies files. Phase completion must verify that format changes produce zero diff, not merely that the format command exits successfully. This applies to P11 (after each migration group) and P16 (final verification). The diff check is scoped to code files only; completion artifacts in `project-plans/` are intentionally new/changed and excluded from the diff check.

**GIVEN**: Format is run as part of phase verification
**WHEN**: `npm run format` completes
**THEN**: `git diff --quiet -- ':!project-plans/'` returns exit code 0 (no uncommitted formatting changes outside project-plans).

**Why it matters**: A successful format exit does not guarantee files are formatted; it only means the command didn't crash. Undetected formatting changes will fail CI.

---

## REQ-TEST-FIXTURE-COUPLING (P10, P11)

**Full text**: Test fixtures and test utilities in `packages/tools` MUST NOT import from `packages/core` or `packages/providers`. Test fixture generation must use tools-local types and structural shapes. `@vybestack/llxprt-code-test-utils` is devDependency-only and its types must not create indirect core/provider dependencies. Tests that currently import from providers (e.g., `ToolFormatter.toResponsesTool.test.ts` importing `@vybestack/llxprt-code-providers/ITool.js`) MUST be rewritten to use local structural fixtures or moved to the providers package.

**GIVEN**: Tests in `packages/tools` need fixture data
**WHEN**: Fixtures are defined and test utilities are used
**THEN**: No fixture file imports from `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or any package that would violate the tools package boundary. Provider-importing tests are rewritten or relocated.

**Why it matters**: If fixtures import from core/providers, the test fails the forbidden import scan, and the dependency direction is violated through test infrastructure.

---

## REQ-TRACEABILITY (P00a)

**Full text**: GitHub issue #1585 body and comments MUST be captured as evidence, and every requirement in the issue body/comments MUST be traced to at least one plan phase and artifact via a traceability table.

**GIVEN**: Issue #1585 contains requirements and discussion
**WHEN**: Preflight runs in P00a
**THEN**: `analysis/issue-body-and-comments.md` exists with the captured issue and a traceability table mapping each requirement to plan phases.

**Why it matters**: Without capture, issue requirements may be lost or misinterpreted. Without traceability, it is impossible to verify that all requirements are addressed.
---

## REQ-ADAPTER-EXACT-COUNT (P11, P12, P16)

**Full text**: The plan must specify the exact number and list of core adapters, not a vague range like "12-13". The exact list is 14 mandatory adapters plus 1 conditional adapter (CoreMcpToolServiceAdapter). The conditional adapter is created only if mcp-tool.ts moves to packages/tools; if it stays in core, the conditional adapter is not created. The decision is documented in the move map.

**GIVEN**: Core adapters are created in P11 migration groups and verified in P12
**WHEN**: A phase specifies the expected adapter count
**THEN**: The exact list is: CoreToolHostAdapter, CoreToolRegistryHostAdapter, CoreMessageBusAdapter, CoreShellToolHostAdapter, CoreSubagentServiceAdapter, CoreAsyncTaskServiceAdapter, CoreSkillServiceAdapter, CoreIdeServiceAdapter, CoreLspServiceAdapter, CoreStorageServiceAdapter, CoreToolKeyStorageAdapter, CoreTodoServiceAdapter, CoreSettingsServiceAdapter, CorePromptRegistryServiceAdapter, CoreWebSearchServiceAdapter (16 mandatory including MCP/web-search adapters after P11).

**Why it matters**: A vague count like "12-13" allows missing adapters to go undetected. An exact list with conditional decision ensures completeness.

---

## REQ-NO-SHIM-SCOPE (P15, P15a)

**Full text**: The no-shim scan MUST be restricted to `packages/core/src/tools/**` only. Explicit `packages/core/src/index.ts` top-level re-exports from `@vybestack/llxprt-code-tools` are allowed for CLI compatibility and MUST NOT be flagged as shims. The separation rule: `packages/core/src/tools/**` → zero re-exports from tools; `packages/core/src/index.ts` → allowed explicit re-exports for public API.

**GIVEN**: P15 cleanup removes moved files from core
**WHEN**: The no-shim scan runs
**THEN**: The scan is scoped to `packages/core/src/tools/` only. Zero matches for re-export patterns from tools in that directory. Explicit top-level re-exports in `packages/core/src/index.ts` are allowed and separately verified.

**Why it matters**: Flagging allowed top-level re-exports breaks the CLI migration plan and forces unnecessary refactoring.

---

## REQ-MECHANICAL-MOVE-MARKERS (P11)

**Full text**: Each migration group in P11 is a large mechanical move. Do not add TODO/progress comments to production files. Track large mechanical move progress in `project-plans/issue1585/.completed/P11-files.md` with one row per moved file: source, destination, classification, adapter/interface used, import rewrites completed, tests run. Alternatively, if the group is sufficiently self-contained, explicitly justify why tracking rows are omitted (e.g., "Group 1 has zero config dependencies, atomic copy+delete").

**GIVEN**: P11 moves code in 8 compile-safe groups
**WHEN**: A migration group is executed
**THEN**: Progress is tracked in the completion artifact, NOT in production code comments/TODOs. Each moved file has a row in the tracking document, or the group has an explicit justification for why tracking rows are omitted.

**Why it matters**: Without tracking, it is impossible to track progress within a large group or roll back partially. Adding TODO/comments to production code conflicts with no-TODO/no-comment rules and cleanup scans.

---

## REQ-MOCK-HYGIENE (P10, P10a)

**Full text**: `packages/tools` tests MUST NOT `vi.mock` the tool, formatter, or registry under test. Infrastructure fakes (replacement implementations injected via constructor) are allowed only when primary assertions verify observable behavior. Provider mocks may remain only alongside non-mocked formatter integration coverage. Tests that mock the unit under test instead of its infrastructure dependencies create false confidence.

**GIVEN**: Behavioral regression tests are written in `packages/tools`
**WHEN**: A test file for tool/formatter/registry X is created
**THEN**: The test MUST NOT contain `vi.mock` for X or any module that directly implements X. Infrastructure fakes (IToolHost, IShellToolHost, IToolMessageBus, etc.) are allowed because they test how the real tool interacts with infrastructure boundaries. Provider mocks are allowed only with at least one test path exercising the real formatter without provider mocks.

**Why it matters**: Self-mocking defeats the purpose of behavioral testing — if the tool under test is mocked, the test only verifies the mock's behavior, not the real implementation.