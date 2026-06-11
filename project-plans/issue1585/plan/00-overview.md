# Plan: Extract Tools Package

Plan ID: PLAN-20260608-ISSUE1585
Generated: 2026-06-08

## Exact Phase List

Total: **36 phases** (1 non-executable overview + 16 implementation + 19 verification/review). Note: the count of 36 includes P00 (non-executable) and all verification/review phases (P00a, P01a, P02a, P02c, P03a, P04a, P05a, P06a, P07a, P08a, P09a, P10a, P11a, P12a, P13a, P14a, P15a, P16a). The executable implementation phases are 16 (P00a–P16, excluding the non-executable P00).

| # | Phase ID | Name | Produces |
| --- | --- | --- | --- |
| 0 | P00 | Plan Overview (Non-Executable) | Architecture decisions, phase list, missing-packages approval |
| 1 | P00a | Preflight Verification | preflight-results.md, approved adapter path decision |
| 2 | P01 | Domain And Dependency Analysis | analysis updates, extended consumer inventory |
| 3 | P01a | Analysis Verification | review report |
| 4 | P02 | Contract-First Pseudocode | pseudocode files |
| 5 | P02a | Pseudocode Verification | pseudocode verification |
| 6 | P02b | Integration Contract Definition | analysis/integration-contract.md |
| 7 | P02c | Integration Contract Verification | contract verification |
| 8 | P03 | Scaffold + Tool Contract Stubs | packages/tools scaffold + interface stubs |
| 9 | P03a | Scaffold + Contract Stub Verification | scaffold + stub verification |
| 10 | P04 | Contract And Boundary TDD | failing tests |
| 11 | P04a | Contract Test Verification | test verification |
| 12 | P05 | Contract Implementation | implemented contracts |
| 13 | P05a | Contract Implementation Verification | semantic verification |
| 14 | P06 | Package Build And Release Wiring | workspace metadata, package.json, tsconfig |
| 15 | P06a | Build Wiring Verification | wiring verification |
| 16 | P07 | Scaffold Build And Release TDD | failing release/build tests |
| 17 | P07a | Scaffold TDD Verification | test verification |
| 18 | P08 | Scaffold Build And Release Implementation | working scaffold, lockfile updated |
| 19 | P08a | Scaffold Implementation Verification | scaffold verification |
| 20 | P09 | Complete Tool Inventory And Move Map | complete move map + package.json deps |
| 21 | P09a | Move Map Verification | classification verification + dependency verification |
| 22 | P10 | Tool Move Behavioral Regression TDD | behavioral regression tests + pre-extraction fixtures |
| 23 | P10a | Tool Move TDD Verification | test verification (no constructor/delegation-only tests) |
| 24 | P11 | Tool Move Implementation — Grouped Compile-Safe Migrations | moved code + adapters per group |
| 25 | P11a | Tool Move Implementation Verification | semantic verification (zero forbidden imports, adapters exist) |
| 26 | P12 | Core Adapters And Registry Integration — Verify And Complete | adapters verified + integrated |
| 27 | P12a | Core Integration Verification | integration verification (no old ../tools/ imports) |
| 28 | P13 | Consumer Migration | consumer imports migrated + CLI decision |
| 29 | P13a | Consumer Migration Verification | consumer verification (zero deep imports in providers+CLI) |
| 30 | P14 | Release Process And Trusted Publish Updates | release process updated + version.js + prepare-package.js + Dockerfile ordering |
| 31 | P14a | Release Process Verification | release verification + script coverage |
| 32 | P15 | Cleanup And No Shims | cleanup |
| 33 | P15a | Cleanup Verification | cleanup verification |
| 34 | P16 | Full Verification Suite | verification outputs |
| 35 | P16a | Final Semantic Review | final review report |

Note: P00 is the non-executable plan overview (architecture decisions, phase list). P00a is the mandatory preflight equivalent of "Phase 0.5" from the spec; 00a naming denotes this is a pre-implementation gate, not a sub-phase of P00.

## Critical Reminders

Before implementing ANY production-code phase:

1. Complete P00a preflight verification and record approved decisions for missing packages.
2. The plan approves a **temporary tools-owned interface / core-adapter path** while packages/settings, packages/storage, and packages/mcp do not exist. packages/tools MUST NOT import packages/core, packages/cli, or packages/providers. Core implements adapters for tools-owned interfaces.
3. Contracts consumed by tools MUST be tools-owned (defined in `packages/tools/src/interfaces/**`). Core may only implement adapters in `packages/core/src/tools-adapters/**`. No core-local interfaces consumed by tools.
4. P03 scaffolds packages/tools before adding contracts inside it. P06-P08 handle build/release metadata only.
5. Define integration contracts before moving code.
6. Write package-boundary and behavioral regression tests before moving production code.
7. Preserve behavior: this is a refactor, not a feature addition.
8. Do not create core deep-import compatibility shims.
9. Update release workflow, sandbox packing, Dockerfile, release tests, and manual npm trusted publishing setup.
10. MCP client/manager remain core infrastructure in `packages/core/src/tools/` as the only approved retained core tools infrastructure. Only mcp-tool.ts may move if it depends solely on `IMcpToolService`.
11. Tool key storage ownership: packages/tools owns `IToolKeyStorage`, `maskKeyForDisplay`, `getSupportedToolNames`, `isValidToolKeyName`; packages/core owns `ToolKeyStorage` class and SecureStore-backed implementations. CoreToolKeyStorageAdapter owns the ToolKeyStorage+SecureStore lifecycle and must NOT delegate to a moved ToolKeyStorage class.
12. P11 is grouped compile-safe migrations, not a bulk move. Each group includes interface updates, core adapter, constructor changes, registry factory updates, affected consumer import rewrites, and verification.
13. CLI uses core top-level re-exports only — no direct tools dependency needed.
14. Dockerfile install order must be tools -> core -> providers -> cli.
15. `scripts/version.js`, `scripts/prepare-package.js` must be updated for tools package.
16. Despite root `packageManager` saying pnpm, this plan follows the existing npm/package-lock release process.
17. `@vybestack/llxprt-code-test-utils` must be devDependency-only of packages/tools, never a runtime dependency.

## Approved Missing-Packages Decision

packages/settings, packages/storage, and packages/mcp do not currently exist. The plan approves:

### Explicit Temporary Interfaces For Missing Packages

| Missing Package | Temporary Interface | Interface File | Core Adapter | Adapter Delegates To | Behavior Preservation Rule | Future Replacement |
| --- | --- | --- | --- | --- | --- | --- |
| packages/settings | ISettingsService | `src/interfaces/ISettingsService.ts` | CoreSettingsServiceAdapter | Config.getSettingsService() | Exact same settings read/write semantics | Direct import from packages/settings |
| packages/settings | IPromptRegistryService | `src/interfaces/IPromptRegistryService.ts` | CorePromptRegistryServiceAdapter | Config.getPromptRegistry() | Prompt registry access preserved identically | Direct import from packages/settings |
| packages/storage | IStorageService (memory/LLXPRT dir) | `src/interfaces/IStorageService.ts` | CoreStorageServiceAdapter | Config storage APIs (getLLXPRTDir, readFile, writeFile, ensureDir) | File I/O behavior preserved; LLXPRT dir resolution identical | Direct import from packages/storage |
| packages/storage | IToolKeyStorage (key storage) | `src/interfaces/IToolKeyStorage.ts` | CoreToolKeyStorageAdapter | ToolKeyStorage class + SecureStore (adapter owns lifecycle) | Key resolution order preserved (keychain → encrypted file → keyfile → null); FALLBACK_POLICY 'deny' preserved | Direct import from packages/storage |
| packages/mcp | IMcpToolService (MCP execution) | `src/interfaces/IMcpToolService.ts` | CoreMcpToolServiceAdapter (conditional) | McpClientManager (only if mcp-tool moves) | callTool and discoverTools behavior preserved; MCP tool lifecycle identical | Direct import from packages/mcp |

- **Temporary tools-owned interfaces** in `packages/tools/src/interfaces/**` for all services that tools need from core (config, message bus, shell, subagent, async tasks, skills, MCP, IDE/LSP, storage, todo, key storage, settings).
- **Core adapters** in `packages/core/src/tools-adapters/**` that implement tools-owned interfaces by delegating to concrete core services.
- **No tools-to-core dependency**: packages/tools imports only its own interfaces and other allowed packages.
- **Future replacement**: When packages/settings, packages/storage, or packages/mcp are created, the corresponding temporary interfaces and adapters are replaced by direct imports from those packages. This plan does not block on their existence.
- **Behavior preservation rule**: Every temporary adapter MUST preserve the exact semantics of the original core service call, including return types, error behavior, optionality, and ordering. No caching, transformation, or filtering not present in the original code path.
- **Future replacement rule**: When packages/settings, packages/storage, or packages/mcp are created, the corresponding temporary interfaces and adapters are removed. packages/tools replaces the interface import with a direct package import. The adapter in packages/core/src/tools-adapters/** is deleted. This plan does NOT block on their existence.
- **All temporary interfaces are defined unconditionally** (not gated on current usage volume). ISettingsService and IPromptRegistryService exist even if current usage routes through IToolRegistryHost, because settings and prompt registry are semantically distinct services that will get their own packages. IMcpToolService is always defined; the CoreMcpToolServiceAdapter is conditional on mcp-tool.ts moving.
- **MCP constraint**: mcp-client.ts and mcp-client-manager.ts are core infrastructure, not tool package code. They remain in `packages/core/src/tools/` as the only approved retained core tools infrastructure. mcp-tool.ts may move to packages/tools only if it depends solely on `IMcpToolService` or an equivalent tools-owned interface rather than importing Config or MessageBus directly. If mcp-tool.ts cannot move without core coupling, it receives STAY_CORE_INFRASTRUCTURE classification and is added to the retained-file allowlist with documented rationale. Document the decision in the move map.

## Exhaustive Config/Core Method Replacement

Every current `this.config.*`, `config.*`, and `getConfig()` usage in `packages/core/src/tools/**` MUST be mapped to a specific tools-owned interface and core adapter. The full mapping is in `analysis/interface-contracts-detailed.md §10`. Evidence command:

```bash
rg -n "this\.config\.|config\.|getConfig\(\)" packages/core/src/tools -g "*.ts" > project-plans/issue1585/analysis/tool-config-usage.txt
```

**Exhaustiveness rule**: Every row in the output of the above command MUST have a corresponding entry in the interface-adapter mapping table. If a Config method has no mapping, the implementation agent MUST NOT proceed — instead, add the mapping and get it reviewed before proceeding.

**Critical Config method categories** (all must have replacements):
- Target dir / workspace roots / approval mode / interactive → IToolHost
- IDE client / IDE mode / diff application → IIdeService
- LSP client / LSP config → ILspService
- File service / file system service / file filtering / exclusions → IToolHost or IStorageService
- Ephemeral settings / conversation logging / debug mode → IToolHost (feature flags)
- Settings service / prompt registry → IToolRegistryHost (temporary until packages/settings)
- Skill manager → ISkillService
- Subagent manager → ISubagentService
- Tool registry / session ID → IToolRegistryHost or ISubagentService
- Shell execution config / PTY config / allowed tools / content generator / Gemini client → IShellToolHost or IToolHost
- MCP tool service → IMcpToolService (conditional: only if mcp-tool.ts moves)
- Memory/LLXPRT dir storage → IStorageService (temporary until packages/storage)
- Key storage → IToolKeyStorage (temporary until packages/storage)
- Todo service → ITodoService (temporary until packages/settings)

**Missing packages temporary interface rule**: For services that belong in packages/settings, packages/storage, or packages/mcp, define temporary tools-owned interfaces now. When those packages are created, replace the temporary interfaces and delete the corresponding core adapters. This plan does NOT block on their existence. ISettingsService and IPromptRegistryService are NOT conditional — they are always defined even if current usage routes through IToolRegistryHost, because settings and prompt registry are semantically distinct services that will get their own packages.

## Required Interface Files

All interfaces consumed by tools are defined in `packages/tools/src/interfaces/`:

| Interface File | Key Methods | Consumed By |
| --- | --- | --- |
| `IToolRegistryHost.ts` | getCoreTools, getExcludeTools, getDiscoveryCommand, isToolEnabled | tool-registry |
| `IToolHost.ts` | getTargetDir, getWorkspaceRoots, getApprovalMode, isInteractive, hasFeatureFlag | write-file, insert_at_line, delete_line_range, apply-patch, edit, glob, grep |
| `IToolMessageBus.ts` | requestConfirmation(details, abortSignal?), publishPolicyUpdate?, subscribe? | tools.ts (BaseToolInvocation), modifiable-tool, shell, mcp-tool |
| `IShellToolHost.ts` | execute, isCommandAllowed | shell |
| `ISubagentService.ts` | executeSubagent, listSubagents, getSubagentConfig | task, list-subagents |
| `IAsyncTaskService.ts` | checkAsyncTask, getTaskStatus | check-async-tasks |
| `ISkillService.ts` | activateSkill, getSkillManager | activate-skill |
| `IMcpToolService.ts` | callTool, discoverTools, getTool | mcp-tool (if moved) |
| `IIdeService.ts` | applyDiff, getConnectionStatus, openDiff | apply-patch, edit |
| `ILspService.ts` | getDiagnostics, waitForDiagnostics | lsp-diagnostics-helper, ast-edit |
| `IStorageService.ts` | getLLXPRTDir, readFile, writeFile, ensureDir | memoryTool |
| `IToolKeyStorage.ts` | saveKey, getKey, deleteKey, hasKey, resolveKey | tool-key-storage (adapter), codesearch, exa-web-search, google-web-search |
| `ITodoService.ts` | getTodoStore, getReminderService, getContextTracker, getDefaultAgentId | todo-read, todo-write, todo-pause, todo-store |
| `ISettingsService.ts` | getSettingsService, getSetting, setSetting | task, tool-registry |
| `IPromptRegistryService.ts` | getPromptRegistry, getPrompt | tool-registry |

## Required Core Adapter Files

All in `packages/core/src/tools-adapters/`. **This list references the canonical adapter table in `analysis/final-architecture.md` §Contract Ownership. Refer there for the authoritative P11 group assignments and mandatory/conditional status.**

| Adapter File | Implements | Delegates To |
| --- | --- | --- |
| `CoreToolHostAdapter.ts` | IToolHost | Config |
| `CoreToolRegistryHostAdapter.ts` | IToolRegistryHost | Config |
| `CoreMessageBusAdapter.ts` | IToolMessageBus | core MessageBus (correlation/abort/timeout) |
| `CoreShellToolHostAdapter.ts` | IShellToolHost | shellExecutionService |
| `CoreSubagentServiceAdapter.ts` | ISubagentService | SubagentManager, ProfileManager |
| `CoreAsyncTaskServiceAdapter.ts` | IAsyncTaskService | AsyncTaskManager |
| `CoreSkillServiceAdapter.ts` | ISkillService | Config.getSkillManager |
| `CoreMcpToolServiceAdapter.ts` | IMcpToolService | McpClientManager (only if mcp-tool moves) |
| `CoreIdeServiceAdapter.ts` | IIdeService | IdeClient |
| `CoreLspServiceAdapter.ts` | ILspService | LspDiagnosticsHelper |
| `CoreStorageServiceAdapter.ts` | IStorageService | Config storage, fs |
| `CoreToolKeyStorageAdapter.ts` | IToolKeyStorage | core ToolKeyStorage + SecureStore (adapter owns lifecycle; ToolKeyStorage class stays in core) |
| `CoreTodoServiceAdapter.ts` | ITodoService | TodoReminderService, TodoContextTracker |
| `CoreSettingsServiceAdapter.ts` | ISettingsService | Config.getSettingsService() |
| `CorePromptRegistryServiceAdapter.ts` | IPromptRegistryService | Config.getPromptRegistry() |
| `index.ts` | — | barrel export |

## Package Export Policy

packages/tools exports follow the providers extraction pattern (established in issue #1584):

### Provider Extraction Pattern Summary

The providers extraction pattern (from issue #1584) establishes these conventions for new workspace packages:

1. **Package metadata**: Follow `packages/providers/package.json` conventions for `name`, `version`, `license`, `repository`, `type`, `main`, `types`, `files`, `engines`, and script names.
2. **Exports**: Top-level `"."` export for full public API + subpath exports for modules needed by direct consumers (matching previous `@vybestack/llxprt-code-core/tools/*` deep-import paths).
3. **Dependencies**: External runtime deps only (no core/providers/cli in dependencies). `@vybestack/llxprt-code-test-utils` as devDependency only.
4. **Build**: Use existing `node ../../scripts/build_package.js` pattern.
5. **Version**: Match other workspace packages.
6. **Release test**: Add to `scripts/tests/release-process.test.js` expected publish order and verify with `npm run test:scripts`.
7. **Scripts**: `scripts/version.js` actualWorkspaces array, `scripts/prepare-package.js` copyFiles, `scripts/build.js` workspaces coverage.

- **Top-level export** `"."` exports the full public API from `dist/index.js`/`dist/index.d.ts`.
- **Subpath exports** for modules needed by providers and other direct consumers (matching current `@vybestack/llxprt-code-core/tools/*` paths):
  - `"./IToolFormatter.js"` → `dist/src/formatters/IToolFormatter.js` (NOTE: IToolFormatter.ts lives in `src/formatters/`, not `src/interfaces/`; the export path maps from the formatters directory)
  - `"./ToolFormatter.js"` → `dist/src/formatters/ToolFormatter.js`
  - `"./ToolIdStrategy.js"` → `dist/src/formatters/ToolIdStrategy.js`
  - `"./toolIdNormalization.js"` → `dist/src/formatters/toolIdNormalization.js`
  - `"./doubleEscapeUtils.js"` → `dist/src/formatters/doubleEscapeUtils.js`
  - `"./toolNameUtils.js"` → `dist/src/formatters/toolNameUtils.js`
- **No deep-import shims in core**: packages/core/package.json removes `./tools/*` exports for moved modules. packages/core may re-export from top-level only if explicitly required for existing public API compatibility.
- Packages that need tools modules import `@vybestack/llxprt-code-tools` or its subpath exports, never deep-import `@vybestack/llxprt-code-core/tools/*`.

## Core tools Directory Final Policy

After P15 cleanup, `packages/core/src/tools/` may only contain:

1. **Approved retained infrastructure allowlist** (every file must have written rationale):
   - `mcp-client.ts` (STAY_CORE_INFRASTRUCTURE) — OAuth/auth/token-storage MCP infrastructure
   - `mcp-client-manager.ts` (STAY_CORE_INFRASTRUCTURE) — MCP client lifecycle management
   - `tool-key-storage.ts` (STAY_CORE_INFRASTRUCTURE) — SecureStore/keyring-backed ToolKeyStorage class; only pure functions move
   - `mcp-client.test.ts` (if exists) — test for retained mcp-client.ts
   - `mcp-client-manager.test.ts` (if exists) — test for retained mcp-client-manager.ts
   - `tool-key-storage.test.ts` (if exists) — test for retained ToolKeyStorage class (SecureStore integration only; masking/naming tests move with pure functions)
   - `mcp-tool.ts` (if classified STAY_CORE_INFRASTRUCTURE because it cannot move without core coupling) — conditional; document decision in move map and analysis/mcp-tool-decision.md
   - Any file explicitly classified as `STAY_CORE_INFRASTRUCTURE` with written rationale recorded in the move map
   - Any file classified as `STAY_UNTIL_FUTURE_PKG` MUST meet strict criteria: (1) imports a core service with no tools-owned interface and cannot be feasibly abstracted; (2) the file's primary purpose belongs in a future package; (3) moving to tools would duplicate core behavior or create a throwaway interface. Every `STAY_UNTIL_FUTURE_PKG` entry MUST have explicit justification for why `MOVE_AFTER_INTERFACE` is not feasible.
2. **No re-export shims**: no files that merely forward or re-export `@vybestack/llxprt-code-tools`.
3. **All other core/tools files** are moved to packages/tools or removed in P15. **No core/tools file may re-export from packages/tools.**
4. **Allowed `packages/core/src/index.ts` top-level re-exports**: Explicit re-exports from `@vybestack/llxprt-code-tools` in `packages/core/src/index.ts` are permitted for CLI compatibility. These are NOT deep-import shims — they serve the core package's public API and are allowed. The no-shim scan scope is restricted to `packages/core/src/tools/**` only.
5. **Separation rule**: `packages/core/src/tools/**` → zero re-exports from `@vybestack/llxprt-code-tools`. `packages/core/src/index.ts` → allowed explicit re-exports for public API.
6. **Retained-file verification**: After P15a, `find packages/core/src/tools -type f | sort` must match this allowlist exactly, including snapshots, fixtures, and other non-TS artifacts. Conditional entries (like `lsp-diagnostics-helper.ts` if classified STAY_CORE_INFRASTRUCTURE per analysis/lsp-diagnostics-helper-decision.md) must be documented in the allowlist with rationale.

## MCP Ownership

| File | Location After Extraction | Rationale |
| --- | --- | --- |
| mcp-client.ts | packages/core/src/tools/ (STAY_CORE_INFRASTRUCTURE) | Core MCP infrastructure: OAuth, auth providers, token storage. Too tightly coupled to core config/auth. Only approved retained infrastructure in core tools dir. |
| mcp-client-manager.ts | packages/core/src/tools/ (STAY_CORE_INFRASTRUCTURE) | Core MCP infrastructure managing client lifecycle. Depends on Config, events, debug. Only approved retained infrastructure in core tools dir. |
| mcp-tool.ts | packages/tools/src/ (MOVE_AFTER_INTERFACE) | Tool implementation discoverer/executor. Moves only if constructor accepts IMcpToolService instead of Config+MessageBus directly. Decision artifact required before P03/P10/P11: analysis/mcp-tool-decision.md. |

## CLI/Direct Consumer Migration Decision

CLI uses ONLY `@vybestack/llxprt-code-core` top-level re-exports. CLI has zero direct imports from `@vybestack/llxprt-code-core/tools/`. After tools extraction, core re-exports tool types from `@vybestack/llxprt-code-tools` at the top level. CLI does NOT need a direct `@vybestack/llxprt-code-tools` dependency.

Key CLI files inspected: `packages/cli/src/zed-integration/zedIntegration.ts`, `packages/cli/src/nonInteractiveCliSupport.ts`, `packages/cli/src/nonInteractiveCli.test-helpers.ts`, `packages/cli/src/nonInteractiveCli*.test.ts`, `packages/cli/src/ui/hooks/slashCommandHandlers.ts`, `packages/cli/src/ui/hooks/useToolScheduler.test.ts`, `packages/cli/src/ui/hooks/atCommandProcessor*.ts`, `packages/cli/src/ui/types.ts`, `packages/cli/src/types/message-bus-augmentation.d.ts`. All import tool types from `@vybestack/llxprt-code-core` top-level only.

## Execution Model

This plan intentionally uses lettered verification/review phases (`00a`, `02b`, `02c`, etc.) as an intentional refactoring-plan adaptation of the strict sequential-number guidance in `dev-docs/PLAN.md`; `phase_manifest.tsv` is authoritative and prevents skipped work. Execute phases sequentially in the order defined by `phase_manifest.tsv` (the authoritative execution order). Phase numbers like `00a`, `02b`, `02c` etc. are execution sequence markers, not sub-phases — the manifest TSV is the single source of truth for ordering. Each implementation phase should use typescriptexpert; each verification phase should use typescriptreviewer. Do not skip phase numbers. Do not combine phases unless this plan is updated before execution.

## Refactoring Strategy

1. Verify assumptions and blockers → approve temporary adapter path.
2. Complete ownership analysis and file classification.
3. Define tools-owned interfaces and pseudocode.
4. Scaffold packages/tools and add interface stubs in one phase (P03).
5. Wire build/release metadata.
6. Move contracts/utilities before concrete tools.
7. Move concrete tools in compile-safe migration groups, each group including interface updates, core adapter, constructor changes, registry factory updates, affected consumer import rewrites, and verification.
8. Verify and complete remaining core adapters and registry/scheduler integration.
9. Migrate providers and other consumers (with explicit CLI decision).
10. Update release/trusted publish process (with scripts/version.js, prepare-package.js, Dockerfile ordering).
11. Remove old core tool files and deep exports; run full verification.

## Canonical Final Verification Commands

```bash
npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load waferglm5 "write me a haiku and nothing else"
```

## Required Supporting Artifacts

Implementation agents must read these before P03:

- specification.md
- analysis/dependency-audit.md
- analysis/final-architecture.md
- analysis/tool-move-map.md
- analysis/release-process.md
- analysis/verification-matrix.md
- analysis/interface-contracts-detailed.md
- analysis/dependency-relocation-final.md
- analysis/consumer-rewrite-map-final.md
- analysis/all-tool-consumers-final.md
- analysis/package-metadata-constraints.md
- analysis/issue-body-and-comments.md
- analysis/preflight-results.md produced from the template
- analysis/pseudocode/package-boundary.md
- analysis/pseudocode/consumer-migration.md
- analysis/pseudocode/release-updates.md
- project-plans/issue1585/manual-trusted-publishing.md (created by P14, must include exact trusted publisher fields for npm: package, owner, repo, workflow filename, environment, branch/tag rules, and comparison to existing packages)

## Preflight Gate

P00a produces analysis/preflight-results.md. If packages/settings or packages/storage do not exist, P00a records the approved temporary tools-owned interface/core-adapter path documented above. Implementation proceeds using this approved path.

## npm/package-lock Process Note

The root `packageManager` field says `pnpm@10.17.0`, but the repository uses `npm` with `package-lock.json` for all release and workspace scripts. This plan follows the **existing npm/package-lock release process**. The `packageManager` field is vestigial.

**Process guards** (enforced in P08 and P14):
- `package-lock.json` MUST exist
- `pnpm-lock.yaml` MUST NOT exist
- `packages/tools` entry MUST exist in `package-lock.json`
- Core and providers MUST declare tools dependency in their `package-lock.json` entries
- CLI MUST NOT have a direct tools dependency in its `package-lock.json` entry

## Core Dependency Cleanup After Moving Dependencies Out Of Core

After external dependencies are relocated to `packages/tools/package.json` (per `analysis/dependency-relocation-final.md`), `packages/core/package.json` may retain dependencies that are no longer needed by core. P09/P11 must verify that:
1. Dependencies shared by both core and tools (e.g., `zod-to-json-schema`) remain in core's `package.json`
2. Dependencies used only by moved files are candidates for removal from core's `package.json` after P15 cleanup
3. `packages/core/package.json` must add `@vybestack/llxprt-code-tools` as a dependency (when core imports from tools)
4. Run `npx depcheck packages/core` after P15 to identify dependencies in core that are no longer used by any remaining core code
