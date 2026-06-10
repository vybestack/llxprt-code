# Tool Move Map And Classification

Plan ID: PLAN-20260608-ISSUE1585
Revised: 2026-06-05 (review-02)

This is a planning baseline. P09 must regenerate it from the actual filesystem before implementation and must classify every file in packages/core/src/tools exactly once.

## Deterministic Path Rule

For files approved to move:

    packages/core/src/tools/{relative_path}
      -> packages/tools/src/{relative_path}

Tests and snapshots move with their corresponding production code unless P09 documents a reason to relocate them.

## Category A: Contracts And Shared Utility Candidates (MOVE_NOW)

Final owner: packages/tools. No core dependencies to invert.

- tool-context.ts
- tool-error.ts
- tool-names.ts
- tool-confirmation-types.ts
- toolNameUtils.ts
- IToolFormatter.ts
- ToolFormatter.ts
- ToolIdStrategy.ts
- toolIdNormalization.ts (replace debugLogger with no-op or package-local)
- doubleEscapeUtils.ts (replace DebugLogger with no-op or package-local)
- mediaUtils.ts (replace MediaBlock import with package-local type)
- diffOptions.ts
- fuzzy-replacer.ts
- ensure-dirs.ts
- todo-schemas.ts

## Category B: Lower-Coupling Concrete Tool Candidates (MOVE_AFTER_INTERFACE)

Final owner: packages/tools after IToolHost + IToolMessageBus dependencies are inverted.

- read-file.ts, read-many-files.ts, read_line_range.ts
- write-file.ts, insert_at_line.ts, delete_line_range.ts
- ls.ts, glob.ts, grep.ts, ripGrep.ts
- edit.ts, edit-utils.ts
- google-web-fetch.ts, google-web-search.ts, google-web-search-invocation.ts
- exa-web-search.ts, direct-web-fetch.ts, codesearch.ts
- ast-grep.ts, structural-analysis.ts
- apply-patch.ts (after IIdeService inversion)

## Category C: AST Edit Subsystem (MOVE_AFTER_INTERFACE)

Final owner: packages/tools after all internal imports and LSP/Config dependencies are inverted.

- ast-edit.ts, ast-edit/** (move as cohesive unit)
- AST tests and snapshots

## Category D: Stateful Runtime Tool Candidates (MOVE_AFTER_INTERFACE)

Final owner: packages/tools, blocked until service interfaces exist.

- shell.ts: requires IShellExecutionService, IToolHost, IToolMessageBus
- task.ts: requires ISubagentService
- list-subagents.ts: requires ISubagentService
- check-async-tasks.ts: requires IAsyncTaskService
- activate-skill.ts: requires ISkillService
- memoryTool.ts: requires IStorageService, IToolKeyStorage
- todo-read.ts, todo-write.ts, todo-pause.ts: require ITodoService
- todo-store.ts, todo-events.ts: require ITodoService

## Category E: MCP-Related Files

- mcp-tool.ts: MOVE_AFTER_INTERFACE (if IMcpToolService dependency met)
- mcp-client.ts: STAY_CORE_INFRASTRUCTURE (OAuth/auth infrastructure)
- mcp-client-manager.ts: STAY_CORE_INFRASTRUCTURE (client lifecycle management)

## Category E2: LSP Infrastructure Files

- lsp-diagnostics-helper.ts: MOVE_AFTER_INTERFACE (depends on ILspService; `collectLspDiagnosticsBlock` is called from ast-edit-invocation.ts and write-file.ts; moves after ILspService interface exists. If it has deeper LSP coupling beyond ILspService, classify as STAY_CORE_INFRASTRUCTURE with documented rationale and add to retained-file allowlist.)
  - Classification justification: `lsp-diagnostics-helper.ts` provides `collectLspDiagnosticsBlock()` which wraps LSP diagnostic fetching. It is consumed by `ast-edit/ast-edit-invocation.ts` and is referenced via `new URL('../../tools/lsp-diagnostics-helper.ts', import.meta.url)` in LSP integration tests. If it imports only LSP client types that can be satisfied by `ILspService`, it moves with the tools package. P09 MUST verify its actual imports: if it uses anything beyond `ILspService` (e.g., direct `LspClient` or `LspConnection` types), it stays as `STAY_CORE_INFRASTRUCTURE` and is added to the retained-file allowlist.

## Category F: Base Classes (MOVE_AFTER_INTERFACE)

- tools.ts: move after replacing MessageBus/IDE/schema imports with interfaces
- modifiable-tool.ts: move after replacing core imports
- tool-registry.ts: move after replacing Config/MessageBus/DebugLogger imports

## Category G: Key Storage (MOVE_AFTER_INTERFACE)

- tool-key-storage.ts: move with IToolKeyStorage interface boundary
  - IToolKeyStorage defined in packages/tools/src/interfaces/IToolKeyStorage.ts
  - maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName → packages/tools/src/utils/tool-key-utils.ts (pure functions, no deps)
  - ToolKeyStorage class STAYS in packages/core/src/tools/tool-key-storage.ts (imports SecureStore)
  - CoreToolKeyStorageAdapter owns ToolKeyStorage + SecureStore lifecycle (must NOT delegate to moved class, must NOT import moved ToolKeyStorage from @vybestack/llxprt-code-tools)
  - Tests for masking move with pure functions to packages/tools
  - Tests for ToolKeyStorage+SecureStore integration stay in core
  - Key storage/memory path regression: same dir resolution as before extraction

## Category H: Tests/Specs/Snapshots (TEST_MOVES_WITH_SOURCE)

- Every test/spec file moves with its corresponding production code
- Update imports to package-local or @vybestack/llxprt-code-tools public exports
- Keep behavioral assertions
- Do not rewrite tests into structure-only package import checks

## Category I: Files To Reclassify By P09

P09 must run a complete inventory and mark each file as one of:

- MOVE_NOW
- MOVE_AFTER_INTERFACE
- STAY_CORE_INFRASTRUCTURE
- STAY_UNTIL_FUTURE_PKG
- TEST_MOVES_WITH_SOURCE
- DELETE_AFTER_MIGRATION

No file may remain UNCLASSIFIED.

## Approved Retained-File List (Core After Cleanup)

Files that STAY in packages/core/src/tools/ after P15:

| File | Classification | Rationale |
| --- | --- | --- |
| mcp-client.ts | STAY_CORE_INFRASTRUCTURE | OAuth, auth providers, token storage — core infrastructure |
| mcp-client-manager.ts | STAY_CORE_INFRASTRUCTURE | MCP client lifecycle management, depends on Config/events |
| tool-key-storage.ts | STAY_CORE_INFRASTRUCTURE | SecureStore/keyring-backed ToolKeyStorage class; only pure functions (maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName) move to packages/tools |
| mcp-client.test.ts | TEST_STAYS_WITH_SOURCE | Tests for mcp-client infrastructure |
| mcp-client-manager.test.ts | TEST_STAYS_WITH_SOURCE | Tests for mcp-client-manager infrastructure |
| tool-key-storage.test.ts (if exists) | TEST_STAYS_WITH_SOURCE | SecureStore integration test for retained ToolKeyStorage class |
| lsp-diagnostics-helper.ts (conditional) | STAY_CORE_INFRASTRUCTURE (only if P09 finds deeper LSP coupling) | If lsp-diagnostics-helper.ts imports LSP types beyond ILspService, it stays in core with documented rationale. If it only needs ILspService, it moves as MOVE_AFTER_INTERFACE per Category E2. |

Any additional retained file must have explicit rationale recorded in move-map-final.md.

## Initial Risk Notes

- Moving tools.ts too early is risky because scheduler/core/confirmation-bus import its types.
- Moving tool-registry.ts too early is risky because it imports Config and discovered tool subprocess behavior.
- Moving concrete tools before interface extraction will produce many core imports from packages/tools.
- Provider formatter/ID utility imports should be migrated early.
- tool-key-storage.ts requires formal IToolKeyStorage interface boundary for clean separation.
- mcp-tool.ts may be harder to move than expected if Config/MessageBus coupling is deeper than anticipated.
