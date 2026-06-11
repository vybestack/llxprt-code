# Interface Contracts Detailed: Exact TypeScript Signatures And Adapter Mappings

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08

This document captures the exact current `packages/core/src/tools/tools.ts` behavior and maps every tools-owned interface to precise TypeScript signatures, adapter implementations, and behavioral contracts. Implementation agents MUST read this before P03 and P11.

## 1. IToolMessageBus — Confirmation Bus Contract

### Current Behavior (packages/core/src/confirmation-bus/message-bus.ts)

```typescript
// packages/core/src/confirmation-bus/types.ts
export enum MessageBusType {
  TOOL_CONFIRMATION_REQUEST = 'tool-confirmation-request',
  TOOL_CONFIRMATION_RESPONSE = 'tool-confirmation-response',
  TOOL_POLICY_REJECTION = 'tool-policy-rejection',
  TOOL_EXECUTION_SUCCESS = 'tool-execution-success',
  TOOL_EXECUTION_FAILURE = 'tool-execution-failure',
  UPDATE_POLICY = 'update-policy',
  BUCKET_AUTH_CONFIRMATION_REQUEST = 'bucket-auth-confirmation-request',
  BUCKET_AUTH_CONFIRMATION_RESPONSE = 'bucket-auth-confirmation-response',
  HOOK_EXECUTION_REQUEST = 'HOOK_EXECUTION_REQUEST',
  HOOK_EXECUTION_RESPONSE = 'HOOK_EXECUTION_RESPONSE',
  TOOL_CALLS_UPDATE = 'tool-calls-update',
}

export type MessageBusMessage =
  | ToolConfirmationRequest
  | ToolConfirmationResponse
  | ToolPolicyRejection
  | ToolExecutionSuccess
  | ToolExecutionFailure
  | UpdatePolicy
  | BucketAuthConfirmationRequest
  | BucketAuthConfirmationResponse
  | HookExecutionRequest
  | HookExecutionResponse
  | ToolCallsUpdateMessage;

export interface ToolConfirmationRequest {
  type: MessageBusType.TOOL_CONFIRMATION_REQUEST;
  toolCall: FunctionCall;
  correlationId: string;
  serverName?: string;
  details?: SerializableConfirmationDetails;
}

export interface ToolConfirmationResponse {
  type: MessageBusType.TOOL_CONFIRMATION_RESPONSE;
  correlationId: string;
  outcome?: ToolConfirmationOutcome;
  payload?: ToolConfirmationPayload;
  confirmed?: boolean;        // legacy compatibility
  requiresUserConfirmation?: boolean;
}

// Correlation/abort/timeout behavior in MessageBus.requestConfirmation():
// 1. Publishes TOOL_CONFIRMATION_REQUEST with correlationId (UUID)
// 2. Subscribes to TOOL_CONFIRMATION_RESPONSE filtered by correlationId
// 3. If policy allows auto-approve, publishes TOOL_POLICY_REJECTION and returns Cancel
// 4. Uses AbortSignal race: if signal aborts, unsubscribes and returns Cancel
// 5. Response correlation: matches response.correlationId to request.correlationId
// 6. Legacy fallback: if outcome undefined, maps confirmed boolean to ProceedOnce/Cancel
```

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/interfaces/IToolMessageBus.ts

export interface IToolMessageBus {
  /**
   * Request user confirmation for a tool invocation.
   * Behavioral contract:
   * - Publishes TOOL_CONFIRMATION_REQUEST with unique correlationId
   * - Subscribes to TOOL_CONFIRMATION_RESPONSE, filtering by correlationId
   * - If AbortSignal aborts before response, unsubscribes and returns Cancel
   * - Legacy fallback: if outcome undefined, maps confirmed boolean
   * - If policy denies, publishes TOOL_POLICY_REJECTION and returns Cancel
   */
  requestConfirmation(
    details: ToolCallConfirmationDetails,
    abortSignal?: AbortSignal,
  ): Promise<ToolConfirmationOutcome>;

  /**
   * Publish a policy update after tool execution.
   */
  publishPolicyUpdate?(
    outcome: ToolConfirmationOutcome,
    options?: IToolMessageBusPolicyUpdateOptions,
  ): Promise<void>;

  /**
   * Subscribe to tool confirmation responses for correlation.
   * The returned function unsubscribes when called.
   */
  subscribe?(
    type: IToolMessageBusMessageType,
    handler: (message: IToolMessageBusMessage) => void,
  ): () => void;
}

// Exact named structural interfaces for message bus types (replaces unknown/anonymous types)
export interface IToolMessageBusPolicyUpdateOptions {
  toolName?: string;
  reason?: string;
}

export type IToolMessageBusMessageType =
  | 'tool-confirmation-request'
  | 'tool-confirmation-response'
  | 'tool-policy-rejection'
  | 'tool-execution-success'
  | 'tool-execution-failure'
  | 'update-policy'
  | 'tool-calls-update';

export interface IToolMessageBusMessage {
  type: IToolMessageBusMessageType;
  correlationId: string;
  [key: string]: unknown;
}
```

### Adapter Mapping

| Adapter | Implements | Delegates To |
| --- | --- | --- |
| `CoreMessageBusAdapter.ts` | IToolMessageBus | `packages/core/src/confirmation-bus/message-bus.ts` MessageBus class |

### Correlation/Abort/Timeout Contract

1. `requestConfirmation` generates `correlationId` via `randomUUID()`
2. Publishes `TOOL_CONFIRMATION_REQUEST` with `correlationId`
3. Subscribes to `TOOL_CONFIRMATION_RESPONSE`, filters matching `correlationId`
4. If `AbortSignal` fires before response, unsubscribes and returns `ToolConfirmationOutcome.Cancel`
5. If `requiresUserConfirmation` is true on the response, delegates to legacy UI
6. Response precedence: `outcome` enum > `confirmed` boolean > default Cancel

## 2. DiffUpdateResult — IDE Diff Contract

### Current Behavior (packages/core/src/ide/ideContext.ts)

```typescript
// DiffUpdateResult is an enum/type returned by IDE diff application
// tools.ts imports: import { type DiffUpdateResult } from '../ide/ideContext.js';
// Used in ToolEditConfirmationDetails: ideConfirmation?: Promise<DiffUpdateResult>
```

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/interfaces/IIdeService.ts

export type DiffUpdateResult = 'accepted' | 'rejected' | 'error' | 'aborted';

export interface IIdeService {
  /**
   * Apply a diff to a file through the IDE.
   * Returns DiffUpdateResult indicating outcome.
   */
  applyDiff(params: {
    filePath: string;
    originalContent: string | null;
    newContent: string;
  }): Promise<DiffUpdateResult>;

  /**
   * Check IDE connection status.
   */
  getConnectionStatus(): 'connected' | 'disconnected';

  /**
   * Open a diff view in the IDE.
   */
  openDiff?(params: {
    filePath: string;
    originalContent: string | null;
    newContent: string;
  }): Promise<void>;
}
```

### Adapter Mapping

| Adapter | Implements | Delegates To |
| --- | --- | --- |
| `CoreIdeServiceAdapter.ts` | IIdeService | `packages/core/src/ide/ideContext.ts` + `packages/core/src/ide/ide-client.ts` |

## 3. SchemaValidator — Schema Validation Contract

### Current Behavior (packages/core/src/utils/schemaValidator.ts)

```typescript
// tools.ts imports: import { SchemaValidator } from '../utils/schemaValidator.js';
// Used in DeclarativeTool.build(): SchemaValidator.validate(schema, params)
// Static method that validates a JSON schema against params
```

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/utils/schemaValidator.ts (package-local)

// SchemaValidator moves to packages/tools as a package-local utility.
// No interface needed — it has no core dependencies.
// Current signature:
export class SchemaValidator {
  static validate(schema: object, instance: unknown): string | null;
}
```

### Adapter Mapping

No adapter needed. `SchemaValidator` is a static utility with no core dependencies. It moves directly to `packages/tools/src/utils/schemaValidator.ts`.

## 4. AnsiOutput — Terminal Serialization Contract

### Current Behavior (packages/core/src/utils/terminalSerializer.ts)

```typescript
// tools.ts imports: import type { AnsiOutput } from '../utils/terminalSerializer.js';
// Type-only import. AnsiOutput is used in:
//   - ToolInvocation.execute signature: updateOutput?: (output: string | AnsiOutput) => void
//   - ToolResultDisplay: string | FileDiff | FileRead | AnsiOutput
```

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/utils/terminalSerializer.ts (package-local)

// AnsiOutput type moves to packages/tools as a package-local type.
// Current signature:
export interface AnsiOutput {
  type: 'ansi';
  data: string;
  exitCode?: number;
}
```

### Adapter Mapping

No adapter needed. Type-only import moves with `tools.ts`.

## 5. ToolKeyStorage — Storage/Key Semantics

### Current Behavior (packages/core/src/tools/tool-key-storage.ts)

```typescript
// Ownership decision (review-02):
//   packages/tools OWNS: IToolKeyStorage, maskKeyForDisplay, getSupportedToolNames, isValidToolKeyName
//   packages/tools OWNS: any facade that delegates only to injected tools-owned storage/key interfaces
//   packages/core OWNS: SecureStore/@napi-rs/keyring-backed implementations until packages/storage exists
//   CoreToolKeyStorageAdapter MUST NOT delegate to a moved ToolKeyStorage class
//   unless that class is package-local pure/facade behavior with no core storage imports

// Pure functions (move to packages/tools/src/utils/):
export function isValidToolKeyName(toolName: string): boolean;
export function getSupportedToolNames(): string[];
export function maskKeyForDisplay(key: string): string;

// IToolKeyStorage interface (packages/tools/src/interfaces/):
export interface IToolKeyStorage {
  saveKey(toolName: string, key: string): Promise<void>;
  getKey(toolName: string): Promise<string | null>;
  deleteKey(toolName: string): Promise<void>;
  hasKey(toolName: string): Promise<boolean>;
  resolveKey(toolName: string): Promise<string | null>;
}

// Current ToolKeyStorage class:
// - Constructor creates new SecureStore(KEYCHAIN_SERVICE, ...)
// - Imports SecureStore, SecureStoreError from packages/core/src/storage/secure-store.ts
// - FALLBACK_POLICY: 'deny' — if keychain unavailable, returns null
// - Resolution order: keychain (via SecureStore) → encrypted file → keyfile → null

// NEW: ToolKeyStorageFacade in packages/tools (pure facade, no SecureStore import):
// - Constructor takes IToolKeyStorage (injected)
// - maskKeyForDisplay and getSupportedToolNames are package-local pure functions
// - Delegates all key operations to injected IToolKeyStorage
```

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/interfaces/IToolKeyStorage.ts

export interface IToolKeyStorage {
  saveKey(toolName: string, key: string): Promise<void>;
  getKey(toolName: string): Promise<string | null>;
  deleteKey(toolName: string): Promise<void>;
  hasKey(toolName: string): Promise<boolean>;
  resolveKey(toolName: string): Promise<string | null>;
}
```

### Adapter Mapping

| Adapter | Implements | Delegates To |
| --- | --- | --- |
| `CoreToolKeyStorageAdapter.ts` | IToolKeyStorage | `packages/core/src/tools/tool-key-storage.ts` ToolKeyStorage class + `packages/core/src/storage/secure-store.ts` SecureStore |

**Critical**: CoreToolKeyStorageAdapter creates and owns the ToolKeyStorage instance internally. It does NOT delegate to a moved ToolKeyStorage class. The adapter owns the SecureStore lifecycle. The adapter MUST NOT import ToolKeyStorage from `@vybestack/llxprt-code-tools` — it imports the class from its core-local path only.

## 6. Todo Types — Schemas And Semantics

### Current Behavior (packages/core/src/tools/todo-schemas.ts)

```typescript
// todo-schemas.ts defines:
import { z } from 'zod';

export const TodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  parentId: z.string().optional(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoToolCallSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  todoId: z.string().optional(),
});
export type TodoToolCall = z.infer<typeof TodoToolCallSchema>;
```

### Service Interface Signature

```typescript
// packages/tools/src/interfaces/ITodoService.ts

export interface ITodoService {
  getTodoStore(): {
    getTodos(): Todo[];
    addTodo(todo: Omit<Todo, 'id'>): Todo;
    updateTodo(id: string, updates: Partial<Todo>): Todo | undefined;
    removeTodo(id: string): boolean;
  };
  getReminderService(): {
    scheduleReminder(todoId: string, delay: number): void;
    cancelReminder(todoId: string): void;
  };
  getContextTracker(): {
    getCurrentTodoId(): string | undefined;
    setCurrentTodoId(id: string | undefined): void;
  };
  getDefaultAgentId(): string;
}
```

### Adapter Mapping

| Adapter | Implements | Delegates To |
| --- | --- | --- |
| `CoreTodoServiceAdapter.ts` | ITodoService | TodoReminderService, TodoContextTracker, DEFAULT_AGENT_ID |

## 7. MCP Semantics

### Current Behavior

```typescript
// mcp-client.ts (STAY_CORE_INFRASTRUCTURE):
// - Imports from @modelcontextprotocol/sdk (Client, SSEClientTransport, StdioClientTransport)
// - Imports from google-auth-library
// - Imports from shell-quote
// - Handles OAuth/auth, token storage, server discovery
// - Depends on Config, events, debug logging

// mcp-client-manager.ts (STAY_CORE_INFRASTRUCTURE):
// - Manages MCP client lifecycle
// - Depends on Config, events, debug
// - Creates and tracks McpClient instances

// mcp-tool.ts (MOVE_AFTER_INTERFACE):
// - Depends on Config + MessageBus directly currently
// - If constructor accepts IMcpToolService instead, can move to packages/tools

export interface IMcpToolService {
  callTool(serverName: string, toolName: string, params: Record<string, unknown>): Promise<Part[]>;
  discoverTools(): Promise<DiscoveredMCPTool[]>;
}
```

### MCP Ownership Decision (review-02)

For issue #1585:
- `mcp-client.ts` and `mcp-client-manager.ts` **STAY in `packages/core/src/tools/`** as the only approved retained core tools infrastructure
- `mcp-tool.ts` may move **only** behind `IMcpToolService` — no direct Config or MessageBus imports

## 8. IToolHost — Config Service Boundary

### Tools-Owned Interface Signature

```typescript
// packages/tools/src/interfaces/IToolHost.ts

export type ApprovalMode = 'auto' | 'yolo' | 'default';

export interface IToolHost {
  getTargetDir(): string;
  getWorkspaceRoots(): string[];
  getApprovalMode(): ApprovalMode;
  isInteractive(): boolean;
  hasFeatureFlag(flag: string): boolean;
  setApprovalMode(mode: ApprovalMode): void;
  getWorkingDir(): string;
  getFileService(): IToolHostFileService;
  getFileFilteringOptions(): IToolHostFileFilteringOptions;
  getFileExclusions(): string[];
  getEphemeralSettings(): Record<string, unknown>;
  getConversationLoggingEnabled(): boolean;
  getDebugMode(): boolean;
  getSessionId(): string;
  getSummarizeToolOutputConfig(): IToolHostSummarizeConfig;
}

// Exact structural interface for file service (replaces anonymous service object + index signature)
export interface IToolHostFileService {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

// Exact structural interface for file filtering options (replaces anonymous object)
export interface IToolHostFileFilteringOptions {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
}

// Exact structural interface for summarize config (replaces unknown)
export interface IToolHostSummarizeConfig {
  enabled: boolean;
  maxTokens?: number;
}
```

**CoreToolHostAdapter delegates to:**
- `Config.getTargetDir()` via `CoreToolHostAdapter.getTargetDir()`
- `Config.getWorkspaceContext().getDirectories()` via `CoreToolHostAdapter.getWorkspaceRoots()`
- `Config.getApprovalMode()` via `CoreToolHostAdapter.getApprovalMode()` — translates core ApprovalMode enum to tools-owned `ApprovalMode` string literal union
- `Config.isInteractive()` via `CoreToolHostAdapter.isInteractive()`
- `Config.hasFeatureFlag(flag)` via `CoreToolHostAdapter.hasFeatureFlag(flag)`
- `Config.setApprovalMode(mode)` via `CoreToolHostAdapter.setApprovalMode(mode)` — translates tools-owned string to core ApprovalMode enum
- `Config.getWorkingDir()` via `CoreToolHostAdapter.getWorkingDir()`
- `Config.getFileService()` via `CoreToolHostAdapter.getFileService()`
- `Config.getFileFilteringOptions()` via `CoreToolHostAdapter.getFileFilteringOptions()`
- `Config.getFileExclusions()` via `CoreToolHostAdapter.getFileExclusions()`
- `Config.getEphemeralSettings()` via `CoreToolHostAdapter.getEphemeralSettings()`
- `Config.getConversationLoggingEnabled()` via `CoreToolHostAdapter.getConversationLoggingEnabled()`
- `Config.getDebugMode()` via `CoreToolHostAdapter.getDebugMode()`
- `Config.getSessionId()` via `CoreToolHostAdapter.getSessionId()`
- `Config.getSummarizeToolOutputConfig()` via `CoreToolHostAdapter.getSummarizeToolOutputConfig()`
- Adapter constructor: `(config: Config) => { this.config = config; }`

**Test coverage** (P10 test file: `packages/tools/src/__tests__/tool-host.test.ts`):
- getTargetDir returns the config target directory (observable: string return matches config)
- getApprovalMode returns 'auto'|'yolo'|'default' string literal (observable: returned value is one of those strings)
- setApprovalMode updates mode and subsequent getApprovalMode reflects the change (observable round-trip)
- hasFeatureFlag returns true for enabled flags, false for disabled flags (observable boolean)
- getFileFilteringOptions returns object with respectGitIgnore/respectLlxprtIgnore booleans (observable)

## 9. Full Interface-Adapter Mapping Table

| # | Interface | File | Key Methods | Adapter File | Delegates To |
| --- | --- | --- | --- | --- | --- |
| 1 | IToolHost | src/interfaces/IToolHost.ts | getTargetDir, getWorkspaceRoots, getApprovalMode, isInteractive, hasFeatureFlag | CoreToolHostAdapter.ts | Config |
| 2 | IToolRegistryHost | src/interfaces/IToolRegistryHost.ts | getCoreTools, getExcludeTools, isToolEnabled, getSettingsService, getPromptRegistry, getToolDiscoveryCommand, getToolCallCommand, getProviderManager | CoreToolRegistryHostAdapter.ts | Config |
| 3 | IToolMessageBus | src/interfaces/IToolMessageBus.ts | requestConfirmation(details, abortSignal?), publishPolicyUpdate?, subscribe? | CoreMessageBusAdapter.ts | MessageBus (correlation/abort/timeout per section 1) |
| 4 | IShellToolHost | src/interfaces/IShellToolHost.ts | execute, isCommandAllowed | CoreShellToolHostAdapter.ts | shellExecutionService |
| 5 | ISubagentService | src/interfaces/ISubagentService.ts | executeSubagent, listSubagents, getSubagentConfig | CoreSubagentServiceAdapter.ts | SubagentManager, ProfileManager |
| 6 | IAsyncTaskService | src/interfaces/IAsyncTaskService.ts | checkAsyncTask, getTaskStatus | CoreAsyncTaskServiceAdapter.ts | AsyncTaskManager |
| 7 | ISkillService | src/interfaces/ISkillService.ts | activateSkill, getSkillManager | CoreSkillServiceAdapter.ts | Config.getSkillManager |
| 8 | IMcpToolService | src/interfaces/IMcpToolService.ts | callTool, discoverTools | CoreMcpToolServiceAdapter.ts | McpClientManager (conditional: only if mcp-tool.ts moves) |
| 9 | IIdeService | src/interfaces/IIdeService.ts | applyDiff, getConnectionStatus, openDiff? | CoreIdeServiceAdapter.ts | IdeClient (DiffUpdateResult per section 2) |
| 10 | ILspService | src/interfaces/ILspService.ts | getDiagnostics, waitForDiagnostics | CoreLspServiceAdapter.ts | LspDiagnosticsHelper |
| 11 | IStorageService | src/interfaces/IStorageService.ts | getLLXPRTDir, readFile, writeFile, ensureDir | CoreStorageServiceAdapter.ts | Config storage, fs |
| 12 | IToolKeyStorage | src/interfaces/IToolKeyStorage.ts | saveKey, getKey, deleteKey, hasKey, resolveKey | CoreToolKeyStorageAdapter.ts | ToolKeyStorage class + SecureStore (adapter owns lifecycle per section 5) |
| 13 | ITodoService | src/interfaces/ITodoService.ts | getTodoStore, getReminderService, getContextTracker, getDefaultAgentId | CoreTodoServiceAdapter.ts | TodoReminderService, TodoContextTracker |
| 14 | ISettingsService | src/interfaces/ISettingsService.ts | getSettingsService, getSetting, setSetting | CoreSettingsServiceAdapter.ts | Config.getSettingsService() |
| 15 | IPromptRegistryService | src/interfaces/IPromptRegistryService.ts | getPromptRegistry, getPrompt | CorePromptRegistryServiceAdapter.ts | Config.getPromptRegistry() |

**Total: 15 interfaces. Adapter count: 14 mandatory + 1 conditional (CoreMcpToolServiceAdapter only if mcp-tool.ts moves).**

## 10. Exhaustive Config/Core Method Replacement Table

This table maps **every** current `this.config.*`, `config.*`, and `getConfig()` usage in `packages/core/src/tools/**` production code to a specific tools-owned interface and core adapter. Generated via:

```bash
rg -n "this\.config\.|config\.|getConfig\(\)" packages/core/src/tools -g "*.ts" > project-plans/issue1585/analysis/tool-config-usage.txt
```

**Exhaustiveness rule**: Every row in the output of the above command MUST have a corresponding entry in this table. If a Config method has no mapping, the implementation agent MUST NOT proceed — instead, add the mapping and get it reviewed before proceeding. This table is the single source of truth for all Config replacement decisions.

**Verification cross-reference**: After P11 completes all migration groups, re-run the evidence command and verify that:
1. Every `this.config.*` occurrence in moved files has been replaced by an interface call (zero `this.config.*` references remain in `packages/tools/src/`)
2. Every entry in this table has a corresponding adapter file in `packages/core/src/tools-adapters/`
3. Every adapter method delegates to the documented core service method

```bash
# Post-P11 verification: zero config references in moved tool code
rg -n "this\.config\.|config\.|getConfig\(\)" packages/tools/src -g "*.ts"
# Expected: zero matches
# Cross-reference: every table entry has a matching adapter method
for method in getTargetDir getWorkspaceRoots getApprovalMode isInteractive hasFeatureFlag getConnectionStatus applyDiff getDiagnostics readFile writeFile ensureDir saveKey getKey deleteKey hasKey resolveKey getTodoStore getReminderService getContextTracker getDefaultAgentId activateSkill getSkillManager execute isCommandAllowed executeSubagent listSubagents checkAsyncTask requestConfirmation getLLXPRTDir; do
  found=$(rg -l "$method" packages/core/src/tools-adapters/ 2>/dev/null | wc -l)
  echo "Method: $method → Adapter matches: $found"
done
```

### Config Method → Interface Mapping

| Config Method | Used In (Production Files) | Tools-Owned Interface | Adapter Method |
| --- | --- | --- | --- |
| `this.config.getTargetDir()` | write-file, insert_at_line, delete_line_range, apply-patch, edit, read-file, read-many-files, read_line_range, glob, grep, ls, ast-grep, structural-analysis, ast-edit/ast-edit-invocation, ast-edit/ast-read-file-invocation | IToolHost.getTargetDir() | CoreToolHostAdapter → Config.getTargetDir() |
| `this.config.getWorkspaceContext()` | write-file, insert_at_line, delete_line_range, apply-patch, edit, read-file, read-many-files, read_line_range, glob, grep, ls, ripGrep | IToolHost.getWorkspaceRoots() | CoreToolHostAdapter → Config.getWorkspaceContext().getDirectories() |
| `this.config.getApprovalMode()` | write-file, insert_at_line, delete_line_range, apply-patch, edit, ast-edit/ast-edit-invocation, shell, google-web-fetch | IToolHost.getApprovalMode() | CoreToolHostAdapter → Config.getApprovalMode() |
| `this.config.setApprovalMode()` | write-file, insert_at_line, delete_line_range, apply-patch, edit, ast-edit/ast-edit-invocation, google-web-fetch | IToolHost.setApprovalMode() | CoreToolHostAdapter → Config.setApprovalMode() |
| `this.config.isInteractive()` | task, shell | IToolHost.isInteractive() | CoreToolHostAdapter → Config.isInteractive() |
| `this.config.getWorkingDir()` | memoryTool | IToolHost.getTargetDir() (same as target dir for memory tools) | CoreToolHostAdapter → Config.getWorkingDir() |
| `this.config.getIdeClient()` | write-file, insert_at_line, delete_line_range, apply-patch, edit | IIdeService | CoreIdeServiceAdapter → IdeClient |
| `this.config.getIdeMode()` | write-file, insert_at_line, delete_line_range, apply-patch, edit | IIdeService.getConnectionStatus() | CoreIdeServiceAdapter → Config.getIdeMode() |
| `this.config.getLspServiceClient()` | write-file | ILspService | CoreLspServiceAdapter → Config.getLspServiceClient() |
| `this.config.getLspConfig()` | write-file | ILspService | CoreLspServiceAdapter → Config.getLspConfig() |
| `this.config.getFileService()` | insert_at_line, glob, ls, read_line_range, read-file, read-many-files | IToolHost (via IToolHost or dedicated IFileService) | CoreToolHostAdapter → Config.getFileService() |
| `this.config.getFileSystemService()` | insert_at_line, delete_line_range, read_line_range, read-file, read-many-files | IStorageService | CoreStorageServiceAdapter → Config.getFileSystemService() |
| `this.config.getFileFilteringOptions()` | read-many-files, ls | IToolHost | CoreToolHostAdapter → Config.getFileFilteringOptions() |
| `this.config.getFileExclusions()` | glob | IToolHost | CoreToolHostAdapter → Config.getFileExclusions() |
| `this.config.getEphemeralSettings()` | read-file, read-many-files, glob, grep, shell, task, tool-registry | IToolHost (or ITodoService for task-specific settings) | CoreToolHostAdapter → Config.getEphemeralSettings() |
| `this.config.getConversationLoggingEnabled()` | write-file, apply-patch, edit | IToolHost.getConversationLoggingEnabled() | CoreToolHostAdapter → Config.getConversationLoggingEnabled() |
| `this.config.getDebugMode()` | write-file, ripGrep, shell | IToolHost.getDebugMode() | CoreToolHostAdapter → Config.getDebugMode() |
| `this.config.getSkillManager()` | activate-skill | ISkillService.getSkillManager() | CoreSkillServiceAdapter → Config.getSkillManager() |
| `this.config.getSubagentManager()` | list-subagents | ISubagentService | CoreSubagentServiceAdapter → Config.getSubagentManager() |
| `this.config.getToolRegistry()` | task | IToolRegistryHost (or ISubagentService for subagent access) | CoreToolRegistryHostAdapter → Config.getToolRegistry() |
| `this.config.getSessionId()` | task | IToolHost (or ISubagentService) | CoreToolHostAdapter → Config.getSessionId() |
| `this.config.getSettingsService()` | task, tool-registry | ISettingsService | CoreSettingsServiceAdapter → Config.getSettingsService() |
| `this.config.getPromptRegistry()` | tool-registry | IPromptRegistryService | CorePromptRegistryServiceAdapter → Config.getPromptRegistry() |
| `this.config.getExcludeTools()` | tool-registry | IToolRegistryHost.getExcludeTools() | CoreToolRegistryHostAdapter → Config.getExcludeTools() |
| `this.config.getToolDiscoveryCommand()` | tool-registry | IToolRegistryHost.getDiscoveryCommand() | CoreToolRegistryHostAdapter → Config.getToolDiscoveryCommand() |
| `this.config.getToolCallCommand()` | tool-registry | IToolRegistryHost | CoreToolRegistryHostAdapter → Config.getToolCallCommand() |
| `this.config.getContentGeneratorConfig()` | shell, google-web-search-invocation | IToolHost (or IShellToolHost for shell-specific config) | CoreShellToolHostAdapter → Config.getContentGeneratorConfig() |
| `this.config.getGeminiClient()` | shell | IToolHost / IShellToolHost | CoreShellToolHostAdapter → Config.getGeminiClient() |
| `this.config.getShellExecutionConfig()` | shell | IShellToolHost | CoreShellToolHostAdapter → Config.getShellExecutionConfig() |
| `this.config.getShouldUseNodePtyShell()` | shell | IShellToolHost | CoreShellToolHostAdapter → Config.getShouldUseNodePtyShell() |
| `this.config.getPtyTerminalWidth()` | shell | IShellToolHost | CoreShellToolHostAdapter → Config.getPtyTerminalWidth() |
| `this.config.getPtyTerminalHeight()` | shell | IShellToolHost | CoreShellToolHostAdapter → Config.getPtyTerminalHeight() |
| `this.config.getAllowedTools()` | shell | IShellToolHost | CoreShellToolHostAdapter → Config.getAllowedTools() |
| `this.config.getSummarizeToolOutputConfig()` | shell | IToolHost | CoreToolHostAdapter → Config.getSummarizeToolOutputConfig() |
| `import { ApprovalMode } from '../config/config.js'` | write-file, insert_at_line, delete_line_range, apply-patch, edit, ast-edit/ast-edit-invocation, google-web-fetch | IToolHost (ApprovalMode as tools-owned string literal union type `'auto'|'yolo'|'default'`) | Adapter translates between tools-owned `ApprovalMode` string literal union and core `ApprovalMode` enum |
| `import type { Config } from '../config/config.js'` | 15+ production tool files | Replaced by specific interfaces | N/A — no more Config type import in moved files |
| `this.config.getProviderManager()` | tool-registry | IToolRegistryHost | CoreToolRegistryHostAdapter → Config.getProviderManager() |
| `this.config.getMessageBus()` | tools.ts, modifiable-tool, shell | IToolMessageBus (injected) | CoreMessageBusAdapter → MessageBus (section §1) |
| `this.config.getFileFilteringOptions()` | read-many-files, ls | IToolHost.getFileFilteringOptions() | CoreToolHostAdapter → Config.getFileFilteringOptions() |
| `this.config.getFileExclusions()` | glob | IToolHost.getFileExclusions() | CoreToolHostAdapter → Config.getFileExclusions() |
| `this.config.setApprovalMode()` | write-file, insert_at_line, delete_line_range, apply-patch, edit, ast-edit, google-web-fetch | IToolHost.setApprovalMode() | CoreToolHostAdapter → Config.setApprovalMode() |

### Additional Config/Core Usage Categories

These categories cover core service usages that are not direct `this.config.*` calls but still require interface replacement for tools extraction. They arise from direct service imports, provider-manager access, workspace context, and runtime configuration.

| Service Usage | Used In (Production Files) | Tools-Owned Interface | Adapter Method |
| --- | --- | --- | --- |
| `import { MessageBus } from '../confirmation-bus/message-bus.js'` | tools.ts, modifiable-tool | IToolMessageBus (injected) | CoreMessageBusAdapter (section §1) |
| `import { shellExecutionService } from '../services/shell-execution-service.js'` | shell | IShellToolHost | CoreShellToolHostAdapter |
| `import { IdeClient } from '../ide/ide-client.js'` + `ideContext` | write-file, insert_at_line, etc. | IIdeService | CoreIdeServiceAdapter |
| `import { LspDiagnosticsHelper } from '../lsp/lsp-diagnostics-helper.js'` (transitively) | write-file, ast-edit | ILspService | CoreLspServiceAdapter |
| `import { SecureStore } from '../storage/secure-store.js'` | tool-key-storage | IToolKeyStorage (adapter owns lifecycle) | CoreToolKeyStorageAdapter |
| `import { TodoReminderService } from '../services/todo-reminder-service.js'` | todo-read/write/pause | ITodoService | CoreTodoServiceAdapter |
| `import { TodoContextTracker } from '../services/todo-context-tracker.js'` | todo-read/write/pause | ITodoService | CoreTodoServiceAdapter |
| `import { AsyncTaskManager } from '../services/async-task-manager.js'` | check-async-tasks | IAsyncTaskService | CoreAsyncTaskServiceAdapter |
| `import { SubagentManager } from '../core/subagentOrchestrator.js'` (transitively) | task, list-subagents | ISubagentService | CoreSubagentServiceAdapter |
| `import { SkillManager } from '../skills/skill-manager.js'` (transitively) | activate-skill | ISkillService | CoreSkillServiceAdapter |
| `import { McpClientManager } from './mcp-client-manager.js'` | mcp-tool | IMcpToolService (conditional) | CoreMcpToolServiceAdapter (conditional) |
| `import { HistoryManager } from '../services/history.js'` (IContent) | tool-registry | IToolRegistryHost or ISubagentService | CoreToolRegistryHostAdapter |
| `import { debugLogger } from '../utils/debug-logger.js'` | doubleEscapeUtils, toolIdNormalization, tool-registry, glob, ls, grep, shell, ripGrep, write-file, apply-patch | Package-local conditional delegate debugLogger (logs only when IToolHost.getDebugMode() returns true, silent no-op otherwise) | Create `packages/tools/src/utils/debugLogger.ts` with a conditional delegate implementation that checks `IToolHost.getDebugMode()`: if true, it outputs debug messages; if false or IToolHost unavailable, it silently discards them. This preserves conditional debug behavior while avoiding a separate ILogger interface. **Behavior**: The tools package-local debugLogger is NOT a pure no-op — it conditionally delegates to real logging based on `IToolHost.getDebugMode()`. This matches the actual usage pattern where tools call `debugLogger()` and expect output when debug mode is enabled. |
| `import { ApprovalMode } from '../config/config.js'` | write-file, edit, etc. | IToolHost (ApprovalMode as tools-owned string literal union type: `'auto'|'yolo'|'default'`) | Adapter maps between core ApprovalMode enum and tools-owned string literal union |

### Missing Packages: Temporary Interface Additions

```typescript
// packages/tools/src/interfaces/IStorageService.ts

export interface IStorageService {
  /**
   * Get the LLXPRT directory path for storage operations.
   * Preserves exact semantics of Config storage path resolution.
   */
  getLLXPRTDir(): string;

  /**
   * Read a file from the storage path.
   * Preserves exact semantics of Config.getFileSystemService().readFile().
   */
  readFile(path: string): Promise<string>;

  /**
   * Write a file to the storage path.
   * Preserves exact semantics of Config.getFileSystemService().writeFile().
   */
  writeFile(path: string, content: string): Promise<void>;

  /**
   * Ensure a directory exists.
   * Preserves exact semantics of Config.getFileSystemService().ensureDir().
   */
  ensureDir(path: string): Promise<void>;

  /**
   * Check if a file exists.
   * Preserves exact semantics of Config.getFileSystemService().exists().
   */
  exists(path: string): Promise<boolean>;
}
```

**CoreStorageServiceAdapter delegates to:**
- `Config.getLLXPRTDir()` (or equivalent storage path accessor) via `CoreStorageServiceAdapter.getLLXPRTDir()`
- `Config.getFileSystemService().readFile(path)` via `CoreStorageServiceAdapter.readFile(path)`
- `Config.getFileSystemService().writeFile(path, content)` via `CoreStorageServiceAdapter.writeFile(path, content)`
- `Config.getFileSystemService().ensureDir(path)` via `CoreStorageServiceAdapter.ensureDir(path)`
- `Config.getFileSystemService().exists(path)` via `CoreStorageServiceAdapter.exists(path)`
- Adapter constructor: `(config: Config) => { this.fileSystemService = config.getFileSystemService(); this.llxprtDir = config.getLLXPRTDir(); }`

**Test coverage** (P10 test file: `packages/tools/src/__tests__/storage-service.test.ts`):
- getLLXPRTDir returns a non-empty string matching config LLXPRT dir (observable: path string)
- writeFile creates a file and readFile reads it back with same content (observable round-trip)
- ensureDir creates a directory that exists() confirms (observable: directory creation)
- exists returns false for nonexistent paths and true for existing ones (observable boolean)

**ISettingsService signature** (NOT conditional — must be defined unconditionally even if current usage is through IToolRegistryHost):

```typescript
// packages/tools/src/interfaces/ISettingsService.ts

export interface ISettingsService {
  /**
   * Get the current value of a named setting.
   * Preserves exact semantics of Config.getSettingsService().getSetting(key).
   * Returns the current setting value (string, number, boolean, object, or undefined).
   */
  getSetting(key: string): string | number | boolean | object | undefined;

  /**
   * Set a named setting value.
   * Preserves exact semantics of Config.getSettingsService().setSetting(key, value).
   */
  setSetting(key: string, value: string | number | boolean | object): void;

  /**
   * Get the raw settings service instance for advanced operations.
   * Preserves exact semantics of Config.getSettingsService().
   * Type narrows when packages/settings is created.
   */
  getSettingsService(): {
    getSetting(key: string): string | number | boolean | object | undefined;
    setSetting(key: string, value: string | number | boolean | object): void;
    [key: string]: unknown;
  };
}
```

**CoreSettingsServiceAdapter delegates to:**
- `Config.getSettingsService().getSetting(key)` via `CoreSettingsServiceAdapter.getSetting(key)` — exact same return type and semantics
- `Config.getSettingsService().setSetting(key, value)` via `CoreSettingsServiceAdapter.setSetting(key, value)` — exact same behavior
- `Config.getSettingsService()` via `CoreSettingsServiceAdapter.getSettingsService()` — returns the raw service instance
- Adapter constructor: `(config: Config) => { this.settingsService = config.getSettingsService(); }`

**Test coverage** (P10 test file: `packages/tools/src/__tests__/settings-service.test.ts`):
- getSetting returns the value from the adapter for known keys (observable: returned value matches)
- setSetting updates a setting through the adapter and subsequent getSetting returns the new value (observable round-trip)
- getSettingsService returns an object with getSetting and setSetting methods (observable: methods exist and work)

**IPromptRegistryService signature**:

```typescript
// packages/tools/src/interfaces/IPromptRegistryService.ts

export interface IPromptRegistryService {
  /**
   * Get the prompt registry instance for lookup operations.
   * Preserves exact semantics of Config.getPromptRegistry().
   * Type narrows when packages/settings is created.
   */
  getPromptRegistry(): {
    getPrompt(name: string): { name: string; content: string; [key: string]: unknown } | undefined;
    hasPrompt(name: string): boolean;
    [key: string]: unknown;
  };

  /**
   * Look up a prompt by name.
   * Preserves exact semantics of Config.getPromptRegistry().getPrompt(name).
   */
  getPrompt(name: string): { name: string; content: string; [key: string]: unknown } | undefined;
}
```

**CorePromptRegistryServiceAdapter delegates to:**
- `Config.getPromptRegistry()` via `CorePromptRegistryServiceAdapter.getPromptRegistry()` — returns the registry instance
- `Config.getPromptRegistry().getPrompt(name)` via `CorePromptRegistryServiceAdapter.getPrompt(name)` — returns prompt or undefined
- Adapter constructor: `(config: Config) => { this.promptRegistry = config.getPromptRegistry(); }`

**Test coverage** (P10 test file: `packages/tools/src/__tests__/prompt-registry-service.test.ts`):
- getPrompt returns a prompt object when a registered name is queried (observable: returned prompt has name/content)
- getPrompt returns undefined for an unregistered name (observable: undefined return)
- getPromptRegistry returns an object with getPrompt and hasPrompt methods (observable: methods exist and work)

**MCP conditional note**: `IMcpToolService` is always defined in `packages/tools/src/interfaces/IMcpToolService.ts` — it represents the future packages/mcp boundary regardless of whether mcp-tool.ts moves in this issue. `CoreMcpToolServiceAdapter` is created only if `mcp-tool.ts` moves to packages/tools. If `mcp-tool.ts` stays in `packages/core/src/tools/` as `STAY_CORE_INFRASTRUCTURE`, `IMcpToolService` remains defined in tools (for future use when packages/mcp is created), and no `CoreMcpToolServiceAdapter` is created in this plan.

**Behavior preservation rule**: Every adapter MUST preserve the exact semantics of the original Config method call, including return types, error behavior, and optionality. Adapters MUST NOT add caching, transformation, or filtering not present in the original code path.

**Future replacement rule**: When packages/settings, packages/storage, or packages/mcp are created, the corresponding temporary interfaces and adapters are removed. packages/tools replaces the interface import with a direct package import. The adapter in packages/core/src/tools-adapters/** is deleted. This plan does NOT block on the existence of these future packages.

**MCP conditional decision**: `IMcpToolService` is always defined in `packages/tools/src/interfaces/IMcpToolService.ts`. `CoreMcpToolServiceAdapter` is created only if `mcp-tool.ts` moves to packages/tools. If `mcp-tool.ts` stays in `packages/core/src/tools/` as `STAY_CORE_INFRASTRUCTURE` (because it cannot move without core coupling beyond IMcpToolService), no adapter is created in this plan. `IMcpToolService` remains as the future `packages/mcp` boundary regardless.

## 9b. IToolRegistryHost — Exact TypeScript Signature And Config Usage Verification

### Exact Interface Signature

```typescript
// packages/tools/src/interfaces/IToolRegistryHost.ts

export interface IToolRegistryHost {
  /** Core tools list from config (maps to Config.getCoreTools()) */
  getCoreTools(): string[];

  /** Excluded tools list (maps to Config.getExcludeTools()) */
  getExcludeTools(): string[];

  /** Check if a specific tool is enabled (maps to Config.isToolEnabled(name)) */
  isToolEnabled(toolName: string): boolean;

  /** Tool discovery command (maps to Config.getToolDiscoveryCommand()) */
  getToolDiscoveryCommand(): string | undefined;

  /** Tool call command (maps to Config.getToolCallCommand()) */
  getToolCallCommand(): string | undefined;

  /** Settings service (maps to Config.getSettingsService()) */
  getSettingsService(): {
    getSetting(key: string): string | number | boolean | object | undefined;
    setSetting(key: string, value: string | number | boolean | object): void;
    [key: string]: unknown;
  };

  /** Prompt registry (maps to Config.getPromptRegistry()) */
  getPromptRegistry(): {
    getPrompt(name: string): { name: string; content: string; [key: string]: unknown } | undefined;
    hasPrompt(name: string): boolean;
    [key: string]: unknown;
  };

  /** Provider manager (maps to Config.getProviderManager()) */
  getProviderManager(): unknown;

  /** Tool registry reference (maps to Config.getToolRegistry()) */
  getToolRegistry?(): unknown;
}
```

### Config Usage Verification

Every current config usage in `tool-registry.ts` must map to an `IToolRegistryHost` method:

| `tool-registry.ts` Usage | IToolRegistryHost Method | Config Method |
| --- | --- | --- |
| `this.config.getCoreTools()` | `getCoreTools()` | `Config.getCoreTools()` |
| `this.config.getExcludeTools()` | `getExcludeTools()` | `Config.getExcludeTools()` |
| `this.config.isToolEnabled(name)` | `isToolEnabled(toolName)` | `Config.isToolEnabled(name)` |
| `this.config.getToolDiscoveryCommand()` | `getToolDiscoveryCommand()` | `Config.getToolDiscoveryCommand()` |
| `this.config.getToolCallCommand()` | `getToolCallCommand()` | `Config.getToolCallCommand()` |
| `this.config.getSettingsService()` | `getSettingsService()` | `Config.getSettingsService()` |
| `this.config.getPromptRegistry()` | `getPromptRegistry()` | `Config.getPromptRegistry()` |
| `this.config.getProviderManager()` | `getProviderManager()` | `Config.getProviderManager()` |

**Verification command** (run before P11 Group 6):
```bash
# Verify all tool-registry.ts config usages are mapped
rg -n "this\.config\." packages/core/src/tools/tool-registry.ts -g "*.ts" | sort
# Every occurrence must have a corresponding row above
```

## 11. Types That Move As Package-Local (No Interface Needed)

| Type | Current Location | New Location | Rationale |
| --- | --- | --- | --- |
| SchemaValidator | packages/core/src/utils/schemaValidator.ts | packages/tools/src/utils/ | Static utility, no dependencies |
| AnsiOutput | packages/core/src/utils/terminalSerializer.ts | packages/tools/src/utils/ | Type-only, no dependencies |
| ToolResultDisplay | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Union type: string \| FileDiff \| FileRead \| AnsiOutput |
| DiffStat | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Plain interface |
| FileDiff | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Plain interface |
| FileRead | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Plain interface |
| ToolResult | packages/core/src/tools/tools.ts | packages/tools/src/types/ | llmContent, returnDisplay, metadata?, error?, suppressDisplay? |
| ToolCallConfirmationDetails | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Discriminated union of edit/exec/mcp/info |
| Kind enum | packages/core/src/tools/tools.ts | packages/tools/src/types/ | Read/Edit/Delete/Move/Search/Execute/Think/Fetch/Other |

## 12. ToolFormatter/Provider/History Type Ownership

ToolFormatter and related formatters require provider and history content shapes. To avoid `packages/tools` importing from `packages/core/src/runtime/contracts` or `packages/core/src/services/history`, tools-owned structural replacement types MUST be defined in `packages/tools/src/types/`. Importing from `packages/core/src/runtime/contracts/RuntimeProviderChat` or `packages/core/src/services/history/IContent` in `packages/tools` is FORBIDDEN.

### Tools-Owned Structural Types

```typescript
// packages/tools/src/types/provider-content-types.ts

/**
 * Tools-owned structural replacement for RuntimeProviderChat.
 * Replaces import from packages/core/src/runtime/contracts/RuntimeProviderChat.
 * Shape matches the provider content fields that ToolFormatter and tool registry consume.
 */
export interface ProviderChatContent {
  role: string;
  content?: string;
  toolCalls?: ProviderToolCallBlock[];
  toolResults?: ProviderToolResultBlock[];
  [key: string]: unknown;
}

/**
 * Tools-owned structural replacement for tool call blocks in history content.
 * Replaces import from packages/core/src/services/history IContent shapes.
 */
export interface ProviderToolCallBlock {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tools-owned structural replacement for tool result blocks in history content.
 */
export interface ProviderToolResultBlock {
  toolCallId: string;
  output: string;
}

/**
 * Tools-owned structural type for RuntimeProviderTool.
 * Replaces import from packages/core/src/runtime/contracts.
 */
export interface ProviderToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
```

### Forbidden Import Rule

`packages/tools/src/` MUST NOT import from:
- `packages/core/src/runtime/contracts/RuntimeProviderChat`
- `packages/core/src/runtime/contracts/RuntimeProviderTool`
- `packages/core/src/services/history`
- Any core runtime/history contract module

These types are replaced by the tools-owned structural types above. If a moved tool file currently imports any of these, classify the import as `REPLACE_WITH_TOOLS_OWNED_TYPE` in `analysis/non-tools-core-dependency-map.md` and replace with the appropriate structural type from `packages/tools/src/types/provider-content-types.ts`.

### Verification

```bash
# Verify no core runtime/history imports in packages/tools
! rg -n "runtime/contracts|services/history" packages/tools/src -g "*.ts"
# Expected: exit code 0 (no matches found)
```