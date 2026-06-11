# Non-Tools Core Dependency Map (Final)

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08 (P09 regenerated)

This document classifies every non-tools relative import used by `packages/core/src/tools/**` production files. Each import maps to exactly one classification that determines how it is resolved when the tool file moves to `packages/tools`. **Zero FORBIDDEN_UNRESOLVED entries.**

## Evidence Source

Raw evidence: `analysis/non-tools-core-relative-imports.txt` (362 lines, generated from repository scan).

## Classification Definitions

| Classification | Meaning | Example |
| --- | --- | --- |
| MOVE_PURE_UTILITY | Pure function/type with no core service deps; moves to packages/tools/src/utils/ | SchemaValidator, makeRelative |
| MOVE_TYPE_ONLY | Type-only import with no runtime impact; moves to packages/tools/src/types/ | ToolResultDisplay, FileDiff |
| TOOLS_OWNED_INTERFACE | Import replaced by a tools-owned interface; core adapter implements it | Config → IToolHost, MessageBus → IToolMessageBus |
| CORE_ADAPTER | Import satisfied by a core adapter that tools never imports directly | SecureStore → IToolKeyStorage |
| STAY_WITH_RETAINED_CORE_TOOL | Import comes from a file classified STAY_CORE_INFRASTRUCTURE | McpClient from retained mcp-client.ts |
| REPLACE_WITH_TOOLS_OWNED_TYPE | Import replaced by a tools-owned structural type | RuntimeProviderChat → tools-owned ProviderToolDefinition |
| COPY_STRUCTURAL_TYPE_ONLY | Type-only definition with no runtime behavior; may be copied to tools | AnsiOutput type only |
| STAY_CORE_ONLY | Utility used only by core-resident files; does not move | coreEvents for mcp-client-manager |
| FORBIDDEN_UNRESOLVED | Import has no viable replacement and blocks the move | **Zero allowed** |

## Classification Table

### Config Imports

| File | Import Path | Classification | Resolution |
| --- | --- | --- | --- |
| task.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| tool-registry.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolRegistryHost |
| shell.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| mcp-client.ts | `type { Config, MCPServerConfig } from '../config/config.js'` | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| mcp-client-manager.ts | `import { getErrorMessage } from '../utils/errors.js'` (plus core config) | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| write-file.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| edit.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| apply-patch.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| insert_at_line.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| delete_line_range.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| read-file.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| read-many-files.ts | `{ type Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| read_line_range.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| glob.ts | `{ type Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| grep.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| ls.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| ripGrep.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| ast-grep.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| structural-analysis.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| google-web-fetch.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| google-web-search-invocation.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| google-web-search.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| codesearch.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| activate-skill.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| memoryTool.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| list-subagents.ts | `type { Config } from '../config/config.js'`, `type { SubagentManager }`, `type { SubagentConfig }` | TOOLS_OWNED_INTERFACE | Replace with IToolHost + ISubagentService |
| lsp-diagnostics-helper.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with ILspService + IToolHost |
| ast-edit/ast-edit-invocation.ts | `type { Config } from '../../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| ast-edit/ast-read-file-invocation.ts | `type { Config } from '../../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| ast-edit/edit-calculator.ts | `import { Config } from '../../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| mcp-tool.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost (per mcp-tool-decision.md) |
| write-file.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| edit.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| apply-patch.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| insert_at_line.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| delete_line_range.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| google-web-fetch.ts | `{ ApprovalMode } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| ast-edit/ast-edit-invocation.ts | `{ ApprovalMode } from '../../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with tools-owned ApprovalMode |
| mcp-client.ts | `{ AuthProviderType } from '../config/config.js'` | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| memoryTool.ts | `{ Storage } from '../config/storage.js'` | TOOLS_OWNED_INTERFACE | Replace with IStorageService |
| task.ts | `type { SubagentManager } from '../config/subagentManager.js'` | TOOLS_OWNED_INTERFACE | Replace with ISubagentService |
| task.ts | `type { ProfileManager } from '../config/profileManager.js'` | TOOLS_OWNED_INTERFACE | Replace with ISubagentService |

### Confirmation-Bus Imports

| File | Import Path | Classification | Resolution |
| --- | --- | --- | --- |
| tools.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| modifiable-tool.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| shell.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| mcp-tool.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus (per mcp-tool-decision.md) |
| apply-patch.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| write-file.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| edit.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| insert_at_line.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| delete_line_range.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| read-file.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| read_line_range.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| read-many-files.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| glob.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| grep.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| ls.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| ripGrep.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| ast-grep.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| structural-analysis.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| codesearch.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| direct-web-fetch.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| exa-web-search.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| activate-skill.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |
| check-async-tasks.ts | `type { MessageBus } from '../confirmation-bus/message-bus.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolMessageBus |

### Core/Business Logic Imports

| File | Import Path | Classification | Resolution |
| --- | --- | --- | --- |
| tools.ts | `{ type DiffUpdateResult } from '../ide/ideContext.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with IIdeService.DiffUpdateResult |
| tools.ts | `{ SchemaValidator } from '../utils/schemaValidator.js'` | MOVE_PURE_UTILITY | Move to tools/src/utils/ |
| tools.ts | `type { AnsiOutput } from '../utils/terminalSerializer.js'` | COPY_STRUCTURAL_TYPE_ONLY | Copy type to tools |
| tools.ts | `{ randomUUID } from 'node:crypto'` | N/A (stdlib) | No action needed |
| mcp-tool.ts | `{ DiscoveredMCPTool } from './mcp-client.js'` | MOVE_TYPE_ONLY | Move DiscoveredMCPTool type (or keep as local type) |
| task.ts | `type { SubagentOrchestrator } from '../core/subagentOrchestrator.js'` | TOOLS_OWNED_INTERFACE | Replace with ISubagentService |
| task.ts | `{ DEFAULT_AGENT_ID } from '../core/turn.js'` | TOOLS_OWNED_INTERFACE | Move to tools-local constant or ITodoService |
| task.ts | `type { SubAgentScope } from '../core/subagent.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with ISubagentService subagent types |
| task.ts | `type { SubagentSchedulerFactory } from '../core/subagentScheduler.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with ISubagentService |
| todo-store.ts | `{ DEFAULT_AGENT_ID } from '../core/turn.js'` | TOOLS_OWNED_INTERFACE | Move to tools-local constant or ITodoService |
| todo-write.ts | `{ DEFAULT_AGENT_ID } from '../core/turn.js'` | TOOLS_OWNED_INTERFACE | Move to tools-local constant or ITodoService |
| tool-registry.ts | `{ spawn, StringDecoder } from 'node:child_process'/'node:string_decoder'` | N/A (stdlib) | No action needed |

### Services Imports

| File | Import Path | Classification | Resolution |
| --- | --- | --- | --- |
| read-file.ts | `{ FileDiscoveryService } from '../services/fileDiscoveryService.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost.getFileService() or IStorageService |
| read-many-files.ts | `{ FileDiscoveryService } from '../services/fileDiscoveryService.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| glob.ts | `type { FileDiscoveryService } from '../services/fileDiscoveryService.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| grep.ts | `type { FileDiscoveryService } from '../services/fileDiscoveryService.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| write-file.ts | `{ getGitStatsService } from '../services/git-stats-service.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| apply-patch.ts | `{ getGitStatsService } from '../services/git-stats-service.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| edit.ts | `{ getGitStatsService } from '../services/git-stats-service.js'` | TOOLS_OWNED_INTERFACE | Replace with IToolHost |
| check-async-tasks.ts | `type { AsyncTaskManager } from '../services/asyncTaskManager.js'` | TOOLS_OWNED_INTERFACE | Replace with IAsyncTaskService |
| task.ts | `type { AsyncTaskManager } from '../services/asyncTaskManager.js'` | TOOLS_OWNED_INTERFACE | Replace with IAsyncTaskService |
| todo-read.ts | `{ TodoReminderService } from '../services/todo-reminder-service.js'` | TOOLS_OWNED_INTERFACE | Replace with ITodoService |
| todo-write.ts | `{ TodoReminderService } from '../services/todo-reminder-service.js'` | TOOLS_OWNED_INTERFACE | Replace with ITodoService |
| todo-write.ts | `{ TodoContextTracker } from '../services/todo-context-tracker.js'` | TOOLS_OWNED_INTERFACE | Replace with ITodoService |
| todo-read.ts | `{ ToolCallTrackerService } from '../services/tool-call-tracker-service.js'` | TOOLS_OWNED_INTERFACE | Replace with ITodoService |
| shell.ts | `{ initializeParser } from '../utils/shell-parser.js'` | MOVE_PURE_UTILITY | Move to tools/src/utils/ |
| shell.ts | `{ isCommandAllowed } from '../utils/shell-utils.js'` | MOVE_PURE_UTILITY | Move to tools/src/utils/ |
| shell.ts | `{ summarizeToolOutput } from '../utils/summarizer.js'` | MOVE_PURE_UTILITY | Move to tools/src/utils/ |

### IDE/LSP Imports

| File | Import Path | Classification | Resolution |
| --- | --- | --- | --- |
| tools.ts | `{ type DiffUpdateResult } from '../ide/ideContext.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with IIdeService type |
| write-file.ts | `{ IDEConnectionStatus } from '../ide/ide-client.js'` | TOOLS_OWNED_INTERFACE | Replace with IIdeService |
| edit.ts | `{ IDEConnectionStatus } from '../ide/ide-client.js'` | TOOLS_OWNED_INTERFACE | Replace with IIdeService |
| apply-patch.ts | `{ IDEConnectionStatus } from '../ide/ide-client.js'` | TOOLS_OWNED_INTERFACE | Replace with IIdeService |
| insert_at_line.ts | `{ IDEConnectionStatus } from '../ide/ide-client.js'` | TOOLS_OWNED_INTERFACE | Replace with IIdeService |
| delete_line_range.ts | `{ IDEConnectionStatus } from '../ide/ide-client.js'` | TOOLS_OWNED_INTERFACE | Replace with IIdeService |
| modifiable-tool.ts | `{ type EditorType, openDiff } from '../utils/editor.js'` | MOVE_PURE_UTILITY | openDiff moves; EditorType via IIdeService |
| lsp-diagnostics-helper.ts | `type { Config } from '../config/config.js'` | TOOLS_OWNED_INTERFACE | Replace with ILspService + IToolHost |
| ast-edit/ast-edit-invocation.ts | `{ collectLspDiagnosticsBlock } from '../lsp-diagnostics-helper.js'` | MOVE_AFTER_INTERFACE | lsp-diagnostics-helper moves with this file; import becomes package-local |

### Utility Imports (MOVE_PURE_UTILITY)

| File | Import Path | Classification | Target In packages/tools |
| --- | --- | --- | --- |
| Multiple files | `{ makeRelative, shortenPath } from '../utils/paths.js'` | MOVE_PURE_UTILITY | src/utils/paths.ts |
| Multiple files | `{ getErrorMessage, isNodeError } from '../utils/errors.js'` | MOVE_PURE_UTILITY | src/utils/errors.ts |
| grep.ts | `{ isGitRepository } from '../utils/gitUtils.js'` | MOVE_PURE_UTILITY | src/utils/gitUtils.ts |
| ripGrep.ts | `{ getRipgrepPath } from '../utils/ripgrepPathResolver.js'` | MOVE_PURE_UTILITY | src/utils/ripgrepPathResolver.ts |
| read-many-files.ts | `{ COMMON_IGNORE_PATTERNS } from '../utils/ignorePatterns.js'` | MOVE_PURE_UTILITY | src/utils/ignorePatterns.ts |
| direct-web-fetch.ts | `{ retryWithBackoff } from '../utils/retry.js'` | MOVE_PURE_UTILITY | src/utils/retry.ts |
| codesearch.ts, direct-web-fetch.ts | `{ ensureJsonSafe } from '../utils/unicodeUtils.js'` | MOVE_PURE_UTILITY | src/utils/unicodeUtils.ts |
| google-web-fetch.ts | `{ getResponseText } from '../utils/generateContentResponseUtilities.js'` | MOVE_PURE_UTILITY | src/utils/generateContentResponseUtilities.ts |
| google-web-fetch.ts | `{ fetchWithTimeout, isPrivateIp } from '../utils/fetch.js'` | MOVE_PURE_UTILITY | src/utils/fetch.ts |
| Multiple files | `{ debugLogger } from '../utils/debugLogger.js'` | MOVE_PURE_UTILITY + package-local | Package-local conditional delegate |
| ast-edit/cross-file-analyzer.ts, context-collector.ts | `{ DebugLogger } from '../../debug/index.js'` or `'../debug/DebugLogger.js'` | MOVE_PURE_UTILITY + package-local | Package-local logger |
| tools.ts, ripGrep.ts, todo-pause.ts | `{ SchemaValidator } from '../utils/schemaValidator.js'` | MOVE_PURE_UTILITY | src/utils/schemaValidator.ts |
| Multiple files | `{ validatePathWithinWorkspace } from '../safety/index.js'` | TOOLS_OWNED_INTERFACE | Replace with IStorageService.validatePathWithinWorkspace |
| ast-grep.ts, structural-analysis.ts, ast-edit files | `{ LANGUAGE_MAP } / { Lang } from '../utils/ast-grep-utils.js' | MOVE_PURE_UTILITY | src/utils/ast-grep-utils.ts |
| read_line_range.ts | `type { GitLineChangeMarker } from '../utils/gitLineChanges.js'` | MOVE_TYPE_ONLY | src/types/gitLineChanges.ts |
| read_line_range.ts, read-file.ts | `{ getGitLineChanges } from '../utils/gitLineChanges.js'` | MOVE_PURE_UTILITY | src/utils/gitLineChanges.ts |
| memoryTool.ts | `{ tildeifyPath } from '../utils/paths.js'` | MOVE_PURE_UTILITY | src/utils/paths.ts |
| tool-registry.ts, mcp-tool.ts | `{ safeJsonStringify } from '../utils/safeJsonStringify.js'` | MOVE_PURE_UTILITY | src/utils/safeJsonStringify.ts |
| activate-skill.ts | `{ getFolderStructure } from '../utils/getFolderStructure.js'` | MOVE_PURE_UTILITY | src/utils/getFolderStructure.ts |
| edit.ts, edit-utils.ts | `{ EmojiFilter } from '../filters/EmojiFilter.js'` | MOVE_PURE_UTILITY | src/utils/filters/EmojiFilter.ts |
| doubleEscapeUtils.ts | `{ DebugLogger } from '../debug/index.js'` | MOVE_PURE_UTILITY + package-local | Package-local logger |
| google-web-fetch.ts | `{ DebugLogger } from '../debug/DebugLogger.js'` | MOVE_PURE_UTILITY + package-local | Package-local logger |
| modifiable-tool.ts | `{ DebugLogger } from '../debug/DebugLogger.js'` | MOVE_PURE_UTILITY + package-local | Package-local logger |
| shell.ts | `{ formatMemoryUsage } from '../utils/formatters.js'` | MOVE_PURE_UTILITY | src/utils/formatters.ts |
| toolIdNormalization.ts | `{ debugLogger } from '../utils/debugLogger.js'` | MOVE_PURE_UTILITY + package-local | Package-local logger |
| IToolFormatter.ts | `type { RuntimeProviderTool } from '../runtime/contracts/RuntimeProviderChat.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with tools-owned ProviderToolDefinition |
| IToolFormatter.ts | `{ type ToolCallBlock } from '../services/history/IContent.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with tools-owned content type |
| mediaUtils.ts | `type { MediaBlock } from '../services/history/IContent.js'` | REPLACE_WITH_TOOLS_OWNED_TYPE | Replace with tools-owned content type |
| tool-key-storage.ts | `{ SecureStore, SecureStoreError, type KeyringAdapter } from '../storage/secure-store.js'` | CORE_ADAPTER | CoreToolKeyStorageAdapter owns ToolKeyStorage lifecycle; interfaces move to tools |

### STAY_CORE_ONLY (used only by retained core files)

| Import | Used By (retained only) | Classification | Resolution |
| --- | --- | --- | --- |
| `{ coreEvents, CoreEvent } from '../utils/events.js'` | mcp-client.ts, mcp-client-manager.ts | STAY_CORE_ONLY | Stays in core; tools has no copy |
| `{ GoogleCredentialProvider } from '../mcp/google-auth-provider.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `{ ServiceAccountImpersonationProvider } from '../mcp/sa-impersonation-provider.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `{ MCPOAuthProvider } from '../mcp/oauth-provider.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `{ MCPOAuthTokenStorage } from '../mcp/oauth-token-storage.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `{ OAuthUtils } from '../mcp/oauth-utils.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `type { McpAuthProvider } from '../mcp/auth-provider.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `type { PromptRegistry } from '../prompts/prompt-registry.js'` | mcp-client.ts, mcp-client-manager.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `type { ResourceRegistry } from '../resources/resource-registry.js'` | mcp-client.ts, mcp-client-manager.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `type { WorkspaceContext } from '../utils/workspaceContext.js'` | mcp-client.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |
| `type { ToolRegistry } from '../tools/tool-registry.js'` | mcp-client-manager.ts | STAY_WITH_RETAINED_CORE_TOOL | Stays in core |

## FORBIDDEN_UNRESOLVED Entries

**Zero entries.** All non-tools core imports have been classified. No `FORBIDDEN_UNRESOLVED` entries remain.

## Summary Statistics

| Classification | Count |
| --- | --- |
| MOVE_PURE_UTILITY | 25+ |
| MOVE_TYPE_ONLY | 5 |
| TOOLS_OWNED_INTERFACE | 30+ |
| CORE_ADAPTER | 1 (ToolKeyStorage → IToolKeyStorage) |
| STAY_WITH_RETAINED_CORE_TOOL | 11 (MCP/auth imports) |
| REPLACE_WITH_TOOLS_OWNED_TYPE | 6 |
| COPY_STRUCTURAL_TYPE_ONLY | 1 (AnsiOutput) |
| STAY_CORE_ONLY | 1 (coreEvents) |
| FORBIDDEN_UNRESOLVED | **0** |