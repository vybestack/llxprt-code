# Move Map Final: Complete Per-File Classification

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

This document classifies every file under `packages/core/src/tools` exactly once. Zero UNCLASSIFIED entries. Zero FORBIDDEN_UNRESOLVED.

## Classification Legend

| Classification | Meaning |
| --- | --- |
| MOVE_NOW | Contract/utility with no core deps, can move immediately |
| MOVE_AFTER_INTERFACE | Depends on core services, can move after interface/adapters exist |
| STAY_CORE_INFRASTRUCTURE | Core infrastructure that stays in packages/core/src/tools/ permanently |
| STAY_UNTIL_FUTURE_PKG | Stays in packages/core/src/tools/ until packages/settings, packages/storage, or packages/mcp exist. Must have explicit justification why MOVE_AFTER_INTERFACE is not feasible. |
| TEST_MOVES_WITH_SOURCE | Test/spec file moves with its production file |
| DELETE_AFTER_MIGRATION | File to remove in P15 (re-export shims, temp files) |

## Retained-File Allowlist

After P15, only these files remain in `packages/core/src/tools/`. Each has explicit rationale.

| File | Classification | Rationale |
| --- | --- | --- |
| `mcp-client.ts` | STAY_CORE_INFRASTRUCTURE | OAuth/auth/SSE transport MCP infrastructure; only approved retained infrastructure |
| `mcp-client-manager.ts` | STAY_CORE_INFRASTRUCTURE | MCP client lifecycle management; only approved retained infrastructure |
| `mcp-client.test.ts` | TEST_MOVES_WITH_SOURCE | Tests for retained mcp-client.ts |
| `mcp-client-manager.test.ts` | TEST_MOVES_WITH_SOURCE | Tests for retained mcp-client-manager.ts |
| `tool-key-storage.ts` | MOVE_AFTER_INTERFACE (ToolKeyStorage class stays; pure functions move) | ToolKeyStorage class stays in core because it imports SecureStore; maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName move to packages/tools/src/utils/tool-key-utils.ts |

**Note on mcp-tool.ts**: Classified as MOVE_AFTER_INTERFACE per `analysis/mcp-tool-decision.md`. It does NOT stay in core. After P11 Group 8, mcp-tool.ts will have been moved to packages/tools. If for any reason it cannot move, it would be added to this allowlist with STAY_CORE_INFRASTRUCTURE classification and documented rationale.

**Note on lsp-diagnostics-helper.ts**: Classified as MOVE_AFTER_INTERFACE per `analysis/lsp-diagnostics-helper-decision.md`. It moves in P11 Group 3.

## Production Files (71 files)

| # | Source Path | Classification | Target Path (if moving) | Interface Dependencies | Import Rewrites | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `activate-skill.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/activate-skill.ts` | IToolHost, ISkillService, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Tool with core service injection; needs ISkillService adapter |
| 2 | `apply-patch.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/apply-patch.ts` | IToolHost, IToolMessageBus, IIdeService, ILspService | Config→IToolHost, MessageBus→IToolMessageBus, IDEConnectionStatus→IIdeService | File-editing tool; Config/MessageBus/IDE deps |
| 3 | `ast-edit.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-edit.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus | AST tool orchestrator; needs validatePathWithinWorkspace from IStorageService |
| 4 | `ast-edit/ast-config.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/ast-config.ts` | None (pure process.env) | None | Pure configuration defaults, no core deps |
| 5 | `ast-edit/ast-edit-invocation.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-edit/ast-edit-invocation.ts` | IToolHost, IToolMessageBus, ILspService | Config→IToolHost, MessageBus→IToolMessageBus, collectLspDiagnosticsBlock→ILspService | Tool invocation with Config/MessageBus/LSP deps |
| 6 | `ast-edit/ast-query-extractor.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/ast-query-extractor.ts` | None (pure AST parsing) | None | Pure AST parsing logic, only @ast-grep/napi external dep |
| 7 | `ast-edit/ast-read-file-invocation.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-edit/ast-read-file-invocation.ts` | IToolHost, IStorageService | Config→IToolHost | File reading invocation; Config dep |
| 8 | `ast-edit/constants.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/constants.ts` | None | None | Pure constants |
| 9 | `ast-edit/context-collector.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/context-collector.ts` | None (imports AstConfig, internal modules) | None | AST context collection; no core service deps |
| 10 | `ast-edit/context-optimizer.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/context-optimizer.ts` | None | None | Pure context optimization logic |
| 11 | `ast-edit/cross-file-analyzer.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-edit/cross-file-analyzer.ts` | None (imports debug Logger, @ast-grep/napi, fast-glob) | debugLogger→package-local | Has debug Logger but debug moves to package-local |
| 12 | `ast-edit/edit-calculator.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-edit/edit-calculator.ts` | IToolHost, IStorageService | Config→IToolHost, isNodeError→MOVE_PURE_UTILITY | Config dep for file validation |
| 13 | `ast-edit/edit-helpers.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/edit-helpers.ts` | None | None | Pure edit helper functions |
| 14 | `ast-edit/language-analysis.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/language-analysis.ts` | None | None | Pure language analysis logic |
| 15 | `ast-edit/local-context-analyzer.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/local-context-analyzer.ts` | None | None | Pure local context analysis |
| 16 | `ast-edit/repository-context-provider.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/repository-context-provider.ts` | None | None | Pure git context extraction |
| 17 | `ast-edit/types.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/types.ts` | None | None | Type definitions only |
| 18 | `ast-edit/workspace-context-provider.ts` | MOVE_NOW | `packages/tools/src/tools/ast-edit/workspace-context-provider.ts` | None | None | Pure workspace context |
| 19 | `ast-grep.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ast-grep.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService | Search tool; Config/MessageBus/workspace deps |
| 20 | `check-async-tasks.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/check-async-tasks.ts` | IToolHost, IAsyncTaskService | Config→IToolHost, AsyncTaskManager→IAsyncTaskService | Task checking tool; depends on AsyncTaskManager |
| 21 | `codesearch.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/codesearch.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Web search tool; Config/MessageBus deps |
| 22 | `delete_line_range.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/delete_line_range.ts` | IToolHost, IToolMessageBus, IIdeService, ILspService, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, IDEConnectionStatus→IIdeService, collectLspDiagnosticsBlock→ILspService | File editing tool; multiple core deps |
| 23 | `diffOptions.ts` | MOVE_NOW | `packages/tools/src/tools/diffOptions.ts` | None (imports only DiffStat type from tools.ts) | None | Pure diff utility; no core service deps |
| 24 | `direct-web-fetch.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/direct-web-fetch.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Web fetch tool; Config/MessageBus deps |
| 25 | `doubleEscapeUtils.ts` | MOVE_NOW | `packages/tools/src/utils/doubleEscapeUtils.ts` | None | None | Pure utility, no core deps |
| 26 | `edit-utils.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/edit-utils.ts` | IToolHost | Config→IToolHost | Edit helper; Config dep |
| 27 | `edit.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/edit.ts` | IToolHost, IToolMessageBus, IIdeService, ILspService, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, IDE+LSP→adapters, getGitStatsService→IToolHost | Main edit tool; heavy core deps |
| 28 | `ensure-dirs.ts` | MOVE_NOW | `packages/tools/src/utils/ensure-dirs.ts` | None | None | Pure fs utility |
| 29 | `exa-web-search.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/exa-web-search.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Web search tool |
| 30 | `fuzzy-replacer.ts` | MOVE_NOW | `packages/tools/src/utils/fuzzy-replacer.ts` | None | None | Pure fuzzy replace logic |
| 31 | `glob.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/glob.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService | File search tool |
| 32 | `google-web-fetch.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/google-web-fetch.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus, ApprovalMode→IToolHost | Web fetch tool |
| 33 | `google-web-search-invocation.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/google-web-search-invocation.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Web search invocation |
| 34 | `google-web-search.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/google-web-search.ts` | IToolHost, IToolMessageBus | Config→IToolHost, MessageBus→IToolMessageBus | Web search tool |
| 35 | `grep.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/grep.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, isGitRepository→MOVE_PURE_UTILITY, FileDiscoveryService→IToolHost | Grep search tool |
| 36 | `insert_at_line.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/insert_at_line.ts` | IToolHost, IToolMessageBus, IIdeService, ILspService, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, IDEConnectionStatus→IIdeService, collectLspDiagnosticsBlock→ILspService | File editing tool |
| 37 | `IToolFormatter.ts` | MOVE_NOW | `packages/tools/src/formatters/IToolFormatter.ts` | None (imports only RuntimeProviderTool type replaced with tools-owned) | RuntimeProviderTool→TOOLS_OWNED_TYPE | Interface; type-only |
| 38 | `list-subagents.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/list-subagents.ts` | IToolHost, ISubagentService | Config→IToolHost, SubagentManager→ISubagentService | Needs subagent manager |
| 39 | `ls.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ls.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService | Filesystem tool |
| 40 | `lsp-diagnostics-helper.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/utils/lsp-diagnostics-helper.ts` | ILspService, IToolHost | Config→ILspService+IToolHost | LSP diagnostics helper; only Config dep, resolved by ILspService+IToolHost (per lsp-diagnostics-helper-decision.md) |
| 41 | `mcp-client.ts` | STAY_CORE_INFRASTRUCTURE | N/A (stays) | N/A | N/A | OAuth/auth/SSE transport; only approved retained infrastructure |
| 42 | `mcp-client-manager.ts` | STAY_CORE_INFRASTRUCTURE | N/A (stays) | N/A | N/A | MCP client lifecycle management; only approved retained infrastructure |
| 43 | `mcp-tool.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/mcp-tool.ts` | IToolHost, IToolMessageBus, IMcpToolService | Config→IToolHost, MessageBus→IToolMessageBus, McpClient types→IMcpToolService | Per mcp-tool-decision.md; can move with IMcpToolService injection |
| 44 | `mediaUtils.ts` | MOVE_NOW | `packages/tools/src/utils/mediaUtils.ts` | None | MediaBlock→TOOLS_OWNED_TYPE | Pure media utility; type dep replaced |
| 45 | `memoryTool.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/memoryTool.ts` | IToolHost, IToolMessageBus, IStorageService, ISettingsService | Config→IToolHost, MessageBus→IToolMessageBus, Storage→IStorageService, getSettingsService→ISettingsService | Memory tool; heavy core deps |
| 46 | `modifiable-tool.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/modifiable-tool.ts` | IToolHost, IIdeService | Config→IToolHost, EditorType→IIdeService | Diff editing tool; needs editor/IDE service |
| 47 | `read_line_range.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/read_line_range.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService, getGitLineChanges→MOVE_PURE_UTILITY | File reading tool |
| 48 | `read-file.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/read-file.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService | File reading tool |
| 49 | `read-many-files.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/read-many-files.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService | Multi-file reading tool |
| 50 | `ripGrep.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/ripGrep.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, SchemaValidator→MOVE_PURE_UTILITY, getRipgrepPath→MOVE_PURE_UTILITY, FileDiscoveryService→IToolHost | Search tool |
| 51 | `shell.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/shell.ts` | IToolHost, IToolMessageBus, IShellExecutionService | Config→IToolHost, MessageBus→IToolMessageBus, shellExecutionService→IShellExecutionService | Shell execution tool |
| 52 | `structural-analysis.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/structural-analysis.ts` | IToolHost, IToolMessageBus, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, validatePathWithinWorkspace→IStorageService, LANGUAGE_MAP→MOVE_PURE_UTILITY | AST search tool |
| 53 | `task.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/task.ts` | IToolHost, IToolMessageBus, ISubagentService, IAsyncTaskService | Config→IToolHost, MessageBus→IToolMessageBus, SubagentOrchestrator→ISubagentService, AsyncTaskManager→IAsyncTaskService, ToolRegistry→IToolRegistryHost, ProfileManager→ISubagentService | Task tool; heavy core deps |
| 54 | `todo-events.ts` | MOVE_NOW | `packages/tools/src/tools/todo-events.ts` | None (imports only EventEmitter and todo-schemas) | None | Pure event helper |
| 55 | `todo-pause.ts` | MOVE_NOW | `packages/tools/src/tools/todo-pause.ts` | None (imports Type from @google/genai, BaseTool from tools.ts, SchemaValidator MOVE_PURE_UTILITY) | SchemaValidator→MOVE_PURE_UTILITY | Simple tool; only SchemaValidator utility dep |
| 56 | `todo-read.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/todo-read.ts` | IToolHost, ITodoService | Config→IToolHost, TodoReminderService→ITodoService, ToolCallTrackerService→ITodoService | Todo reading tool |
| 57 | `todo-schemas.ts` | MOVE_NOW | `packages/tools/src/tools/todo-schemas.ts` | None (imports only zod) | None | Pure zod schemas |
| 58 | `todo-store.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/todo-store.ts` | IToolHost | Config→IToolHost (via DEFAULT_AGENT_ID) | Todo storage; uses DEFAULT_AGENT_ID (move constant) |
| 59 | `todo-write.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/todo-write.ts` | IToolHost, IToolMessageBus, ITodoService | Config→IToolHost, MessageBus→IToolMessageBus, TodoReminderService→ITodoService, ToolCallTrackerService→ITodoService | Todo writing tool |
| 60 | `tool-confirmation-types.ts` | MOVE_NOW | `packages/tools/src/types/tool-confirmation-types.ts` | None | None | Pure type definitions |
| 61 | `tool-context.ts` | MOVE_NOW | `packages/tools/src/types/tool-context.ts` | None | None | Pure type definitions |
| 62 | `tool-error.ts` | MOVE_NOW | `packages/tools/src/types/tool-error.ts` | None | None | Pure error type definitions |
| 63 | `tool-key-storage.ts` | MOVE_AFTER_INTERFACE | SPLIT: ToolKeyStorage class→STAY_CORE_INFRASTRUCTURE; maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName, ToolKeyStorageOptions, ToolKeyRegistryEntry, getToolKeyEntry→MOVE_NOW to `packages/tools/src/utils/tool-key-utils.ts` | IToolKeyStorage (for class) / None (for pure functions) | SecureStore→CORE_ADAPTER, ProviderKeyStorage→IToolKeyStorage (class stays); pure functions have no deps | Per review-02 decision: pure functions move, class stays (see Step 6 of plan) |
| 64 | `tool-names.ts` | MOVE_NOW | `packages/tools/src/constants/tool-names.ts` | None | None | Pure constants |
| 65 | `tool-registry.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/tool-registry.ts` | IToolHost, IToolMessageBus, IMcpToolService | Config→IToolRegistryHost, MessageBus→IToolMessageBus, spawn→IShellExecutionService | Tool registry; heavy core deps |
| 66 | `ToolFormatter.ts` | MOVE_NOW | `packages/tools/src/formatters/ToolFormatter.ts` | None | RuntimeProviderTool→TOOLS_OWNED_TYPE, ToolCallBlock→TOOLS_OWNED_TYPE | Formatter; type imports replaced |
| 67 | `toolIdNormalization.ts` | MOVE_NOW | `packages/tools/src/formatters/toolIdNormalization.ts` | None | None (imports debugLogger→package-local) | Pure utility |
| 68 | `ToolIdStrategy.ts` | MOVE_NOW | `packages/tools/src/formatters/ToolIdStrategy.ts` | None | None | Pure strategy utility |
| 69 | `toolNameUtils.ts` | MOVE_NOW | `packages/tools/src/formatters/toolNameUtils.ts` | None | None | Pure naming utility |
| 70 | `tools.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/tools.ts` | IToolHost, IToolMessageBus, IToolKeyStorage | Config→IToolHost, MessageBus→IToolMessageBus, DiffUpdateResult→TOOLS_OWNED_TYPE | Core tool base classes; needs Config/MessageBus |
| 71 | `write-file.ts` | MOVE_AFTER_INTERFACE | `packages/tools/src/tools/write-file.ts` | IToolHost, IToolMessageBus, IIdeService, IStorageService | Config→IToolHost, MessageBus→IToolMessageBus, IDEConnectionStatus→IIdeService | File writing tool |

## Test Files (79 .test.ts + 2 .spec.ts = 81 test files)

Each test file is classified `TEST_MOVES_WITH_SOURCE` and moves alongside its production file.

| # | Source Path | Classification | Moves With |
| --- | --- | --- | --- |
| 1 | `__tests__/apply-patch-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | apply-patch.ts |
| 2 | `__tests__/ast-config.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/ast-config.ts |
| 3 | `__tests__/ast-edit-characterization.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit.ts |
| 4 | `__tests__/ast-edit-empty-file.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit.ts |
| 5 | `__tests__/ast-edit-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit.ts |
| 6 | `__tests__/ast-query-extractor.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/ast-query-extractor.ts |
| 7 | `__tests__/calculate-edit-characterization.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/ |
| 8 | `__tests__/delete-line-range-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | delete_line_range.ts |
| 9 | `__tests__/edit-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | edit.ts |
| 10 | `__tests__/edit-params.test.ts` | TEST_MOVES_WITH_SOURCE | edit.ts |
| 11 | `__tests__/ensure-dirs.test.ts` | TEST_MOVES_WITH_SOURCE | ensure-dirs.ts |
| 12 | `__tests__/file-read-max-lines.test.ts` | TEST_MOVES_WITH_SOURCE | read-file.ts |
| 13 | `__tests__/glob-params.test.ts` | TEST_MOVES_WITH_SOURCE | glob.ts |
| 14 | `__tests__/grep-params.test.ts` | TEST_MOVES_WITH_SOURCE | grep.ts |
| 15 | `__tests__/insert-at-line-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | insert_at_line.ts |
| 16 | `__tests__/language-analysis.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/language-analysis.ts |
| 17 | `__tests__/ls-params.test.ts` | TEST_MOVES_WITH_SOURCE | ls.ts |
| 18 | `__tests__/repository-context-provider.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/repository-context-provider.ts |
| 19 | `__tests__/shell-params.test.ts` | TEST_MOVES_WITH_SOURCE | shell.ts |
| 20 | `__tests__/write-file-lsp-integration.test.ts` | TEST_MOVES_WITH_SOURCE | write-file.ts |
| 21 | `__tests__/write-file-params.test.ts` | TEST_MOVES_WITH_SOURCE | write-file.ts |
| 22 | `activate-skill.test.ts` | TEST_MOVES_WITH_SOURCE | activate-skill.ts |
| 23 | `ast-edit.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit.ts |
| 24 | `ast-edit/__tests__/context-collector.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/context-collector.ts |
| 25 | `ast-edit/__tests__/cross-file-analyzer.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/cross-file-analyzer.ts |
| 26 | `ast-edit/__tests__/validate-ast-syntax.test.ts` | TEST_MOVES_WITH_SOURCE | ast-edit/edit-calculator.ts |
| 27 | `ast-grep.test.ts` | TEST_MOVES_WITH_SOURCE | ast-grep.ts |
| 28 | `base-tool-invocation.test.ts` | TEST_MOVES_WITH_SOURCE | tools.ts |
| 29 | `check-async-tasks.test.ts` | TEST_MOVES_WITH_SOURCE | check-async-tasks.ts |
| 30 | `codesearch.test.ts` | TEST_MOVES_WITH_SOURCE | codesearch.ts |
| 31 | `confirmation-policy.test.ts` | TEST_MOVES_WITH_SOURCE | tools.ts |
| 32 | `delete_line_range.test.ts` | TEST_MOVES_WITH_SOURCE | delete_line_range.ts |
| 33 | `diffOptions.test.ts` | TEST_MOVES_WITH_SOURCE | diffOptions.ts |
| 34 | `direct-web-fetch.test.ts` | TEST_MOVES_WITH_SOURCE | direct-web-fetch.ts |
| 35 | `doubleEscapeUtils.test.ts` | TEST_MOVES_WITH_SOURCE | doubleEscapeUtils.ts |
| 36 | `edit-fuzzy.test.ts` | TEST_MOVES_WITH_SOURCE | edit.ts |
| 37 | `edit-tabs-issue473.test.ts` | TEST_MOVES_WITH_SOURCE | edit.ts |
| 38 | `edit.test.ts` | TEST_MOVES_WITH_SOURCE | edit.ts |
| 39 | `exa-web-search.test.ts` | TEST_MOVES_WITH_SOURCE | exa-web-search.ts |
| 40 | `glob.test.ts` | TEST_MOVES_WITH_SOURCE | glob.ts |
| 41 | `google-web-fetch.integration.test.ts` | TEST_MOVES_WITH_SOURCE | google-web-fetch.ts |
| 42 | `google-web-fetch.test.ts` | TEST_MOVES_WITH_SOURCE | google-web-fetch.ts |
| 43 | `google-web-search.test.ts` | TEST_MOVES_WITH_SOURCE | google-web-search.ts |
| 44 | `grep.test.ts` | TEST_MOVES_WITH_SOURCE | grep.ts |
| 45 | `grep.timeout.test.ts` | TEST_MOVES_WITH_SOURCE | grep.ts |
| 46 | `insert_at_line.test.ts` | TEST_MOVES_WITH_SOURCE | insert_at_line.ts |
| 47 | `list-subagents.test.ts` | TEST_MOVES_WITH_SOURCE | list-subagents.ts |
| 48 | `ls.test.ts` | TEST_MOVES_WITH_SOURCE | ls.ts |
| 49 | `mcp-client.test.ts` | TEST_MOVES_WITH_SOURCE (STAYS with mcp-client.ts in core) | mcp-client.ts (STAY_CORE_INFRASTRUCTURE) |
| 50 | `mcp-client-manager.test.ts` | TEST_MOVES_WITH_SOURCE (STAYS with mcp-client-manager.ts in core) | mcp-client-manager.ts (STAY_CORE_INFRASTRUCTURE) |
| 51 | `mcp-tool.test.ts` | TEST_MOVES_WITH_SOURCE | mcp-tool.ts |
| 52 | `memoryTool.test.ts` | TEST_MOVES_WITH_SOURCE | memoryTool.ts |
| 53 | `messageBus.registry-invocation.tdd.test.ts` | TEST_MOVES_WITH_SOURCE | tools.ts / tool-registry.ts |
| 54 | `modifiable-tool.test.ts` | TEST_MOVES_WITH_SOURCE | modifiable-tool.ts |
| 55 | `read-file.test.ts` | TEST_MOVES_WITH_SOURCE | read-file.ts |
| 56 | `read-line-range.test.ts` | TEST_MOVES_WITH_SOURCE | read_line_range.ts |
| 57 | `read-many-files.batch.test.ts` | TEST_MOVES_WITH_SOURCE | read-many-files.ts |
| 58 | `read-many-files.test.ts` | TEST_MOVES_WITH_SOURCE | read-many-files.ts |
| 59 | `read-many-files.token-overflow.test.ts` | TEST_MOVES_WITH_SOURCE | read-many-files.ts |
| 60 | `ripGrep.test.ts` | TEST_MOVES_WITH_SOURCE | ripGrep.ts |
| 61 | `shell.multibyte.test.ts` | TEST_MOVES_WITH_SOURCE | shell.ts |
| 62 | `shell.test.ts` | TEST_MOVES_WITH_SOURCE | shell.ts |
| 63 | `structural-analysis.test.ts` | TEST_MOVES_WITH_SOURCE | structural-analysis.ts |
| 64 | `task.test.ts` | TEST_MOVES_WITH_SOURCE | task.ts |
| 65 | `todo-pause.spec.ts` | TEST_MOVES_WITH_SOURCE | todo-pause.ts |
| 66 | `todo-read.test.ts` | TEST_MOVES_WITH_SOURCE | todo-read.ts |
| 67 | `todo-schemas.test.ts` | TEST_MOVES_WITH_SOURCE | todo-schemas.ts |
| 68 | `todo-store.test.ts` | TEST_MOVES_WITH_SOURCE | todo-store.ts |
| 69 | `todo-write.spec.ts` | TEST_MOVES_WITH_SOURCE | todo-write.ts |
| 70 | `todo-write.test.ts` | TEST_MOVES_WITH_SOURCE | todo-write.ts |
| 71 | `tool-key-storage.test.ts` | SPLIT: SecureStore integration tests→STAY with tool-key-storage.ts in core; masking/naming tests→MOVE_NOW with pure functions | tool-key-storage.ts |
| 72 | `tool-registry.test.ts` | TEST_MOVES_WITH_SOURCE | tool-registry.ts |
| 73 | `ToolFormatter.test.ts` | TEST_MOVES_WITH_SOURCE | ToolFormatter.ts |
| 74 | `ToolFormatter.toResponsesTool.test.ts` | TEST_MOVES_WITH_SOURCE (requires provider type fix — see dependency-relocation-final.md) | ToolFormatter.ts |
| 75 | `toolIdNormalization.test.ts` | TEST_MOVES_WITH_SOURCE | toolIdNormalization.ts |
| 76 | `ToolIdStrategy.test.ts` | TEST_MOVES_WITH_SOURCE | ToolIdStrategy.ts |
| 77 | `toolNameUtils.integration.test.ts` | TEST_MOVES_WITH_SOURCE | toolNameUtils.ts |
| 78 | `tools.test.ts` | TEST_MOVES_WITH_SOURCE | tools.ts |
| 79 | `write-file.test.ts` | TEST_MOVES_WITH_SOURCE | write-file.ts |

## Non-TS Files (2 files)

| # | Source Path | Classification | Rationale |
| --- | --- | --- | --- |
| 1 | `__snapshots__/shell.test.ts.snap` | TEST_MOVES_WITH_SOURCE | Snapshot for shell.test.ts; moves with it |
| 2 | `__tests__/__snapshots__/ast-query-extractor.test.ts.snap` | TEST_MOVES_WITH_SOURCE | Snapshot for ast-query-extractor.test.ts; moves with it |

## Summary Statistics

| Classification | Count |
| --- | --- |
| MOVE_NOW | 24 (production files) |
| MOVE_AFTER_INTERFACE | 46 (production files, including mcp-tool.ts, lsp-diagnostics-helper.ts) |
| STAY_CORE_INFRASTRUCTURE | 2 (mcp-client.ts, mcp-client-manager.ts) |
| STAY_UNTIL_FUTURE_PKG | 0 |
| TEST_MOVES_WITH_SOURCE | 81 |
| DELETE_AFTER_MIGRATION | 0 |
| UNCLASSIFIED | 0 |
| FORBIDDEN_UNRESOLVED | 0 |
| **Total files classified** | **152** (71 production + 81 test/spec — 2 snap files included in count) + 2 non-TS = **153 total** |

Note: `tool-key-storage.ts` is SPLIT: the ToolKeyStorage class (STAY_CORE_INFRASTRUCTURE) and the pure functions (MOVE_NOW). It is counted once in production files as a single file with a split classification.

## Import Rewrite Categories

| Rewrite Category | Pattern | Example |
| --- | --- | --- |
| TYPE_IMPORT | `import type { X } from '../tools/Y'` → `import type { X } from '@vybestack/llxprt-code-tools'` | ToolRegistry, ToolContext |
| CONCRETE_IMPORT | `import { X } from '../tools/Y'` → `import { X } from '@vybestack/llxprt-code-tools'` | ToolFormatter, toolNameUtils |
| SUBPATH_IMPORT | `import { X } from '@vybestack/llxprt-code-core/tools/Y'` → `import { X } from '@vybestack/llxprt-code-tools/Y'` | provider imports |
| ADAPTER_INJECTION | Constructor takes interface instead of Config | shell, task, mcp-tool |
| BARREL_UPDATE | packages/core/src/index.ts re-exports | tool types re-exported from tools pkg |