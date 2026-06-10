# Integration Contract Definition

Plan ID: PLAN-20260608-ISSUE1585
Phase: P02b integration-contract
Status: Contract definition only

## Scope

This document defines the cycle-free integration contracts between the future `@vybestack/llxprt-code-tools` package, core-owned adapters, provider-facing tool utility exports, registry factory integration, scheduler integration, and moved-tool consumers. It is an analysis artifact only; no implementation files are changed in this phase.

## Tools-Owned Interface Contracts

| Contract | Interface File | Key Method Signatures | Core Adapter File | Consumed By Moved Tools |
| --- | --- | --- | --- | --- |
| `IToolHost` | `packages/tools/src/interfaces/IToolHost.ts` | `getTargetDir(): string`; `getWorkspaceRoots(): string[]`; `getApprovalMode(): ApprovalMode`; `isInteractive(): boolean`; `hasFeatureFlag(flag: string): boolean` | `packages/core/src/tools-adapters/CoreToolHostAdapter.ts` | `write-file`, `insert_at_line`, `delete_line_range`, `apply-patch`, `read_line_range`, `glob`, `grep`, `edit` |
| `IToolRegistryHost` | `packages/tools/src/interfaces/IToolRegistryHost.ts` | `getCoreTools(): string[]`; `getExcludeTools(): string[]`; `getDiscoveryCommand(): string \| undefined`; `isToolEnabled(name: string): boolean` | `packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts` | `tool-registry` |
| `IToolMessageBus` | `packages/tools/src/interfaces/IToolMessageBus.ts` | `requestConfirmation(details: ToolCallConfirmationDetails, abortSignal?: AbortSignal): Promise<ToolConfirmationOutcome>`; `publishPolicyUpdate(outcome: ToolConfirmationOutcome, options?: PolicyUpdateOptions): Promise<void>`; `subscribe?(handler: ToolMessageHandler): Unsubscribe` | `packages/core/src/tools-adapters/CoreMessageBusAdapter.ts` | `tools.ts` / `BaseToolInvocation`, `modifiable-tool`, `shell`, `mcp-tool` |
| `IShellToolHost` | `packages/tools/src/interfaces/IShellToolHost.ts` | `execute(command: string, options?: ShellOptions): Promise<ShellResult>`; `isCommandAllowed(command: string): boolean` | `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts` | `shell` |
| `ISubagentService` | `packages/tools/src/interfaces/ISubagentService.ts` | `executeSubagent(request: SubagentRequest): Promise<SubagentResult>`; `listSubagents(): SubagentInfo[]`; `getSubagentConfig(name: string): SubagentConfig \| undefined` | `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts` | `task`, `list-subagents` |
| `IAsyncTaskService` | `packages/tools/src/interfaces/IAsyncTaskService.ts` | `checkAsyncTask(taskId: string): Promise<TaskStatus>`; `getTaskStatus(): TaskInfo[]` | `packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts` | `check-async-tasks` |
| `ISkillService` | `packages/tools/src/interfaces/ISkillService.ts` | `activateSkill(name: string): Promise<SkillActivationResult>`; `getSkillManager(): SkillManager` | `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts` | `activate-skill` |
| `IMcpToolService` | `packages/tools/src/interfaces/IMcpToolService.ts` | `callTool(serverName: string, toolName: string, params: Record<string, unknown>): Promise<Part[]>`; `discoverTools(): Promise<DiscoveredMCPTool[]>`; `getTool(serverName: string, toolName: string): McpDiscoveredTool \| undefined` | `packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts` (conditional: only required if `mcp-tool.ts` moves) | `mcp-tool` (if moved) |
| `IIdeService` | `packages/tools/src/interfaces/IIdeService.ts` | `applyDiff(params: DiffParams): Promise<DiffUpdateResult>`; `getConnectionStatus(): IDEConnectionStatus`; `openDiff(params: OpenDiffParams): Promise<void>` | `packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts` | `apply-patch`, `edit` |
| `ILspService` | `packages/tools/src/interfaces/ILspService.ts` | `getDiagnostics(filePath: string): Diagnostic[]`; `waitForDiagnostics(filePath: string, timeout: number): Promise<Diagnostic[]>` | `packages/core/src/tools-adapters/CoreLspServiceAdapter.ts` | `lsp-diagnostics-helper`, `ast-edit` |
| `IStorageService` | `packages/tools/src/interfaces/IStorageService.ts` | `getLLXPRTDir(): string`; `readFile(path: string): Promise<string>`; `writeFile(path: string, content: string): Promise<void>`; `ensureDir(path: string): Promise<void>` | `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts` | `memoryTool` |
| `IToolKeyStorage` | `packages/tools/src/interfaces/IToolKeyStorage.ts` | `saveKey(toolName: string, key: string): Promise<void>`; `getKey(toolName: string): Promise<string \| null>`; `deleteKey(toolName: string): Promise<void>`; `hasKey(toolName: string): Promise<boolean>`; `resolveKey(toolName: string): Promise<string \| null>`; `maskKeyForDisplay(key: string): string`; `getSupportedToolNames(): string[]` | `packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts` | `tool-key-storage`, `codesearch`, `exa-web-search`, `google-web-search` |
| `ITodoService` | `packages/tools/src/interfaces/ITodoService.ts` | `getTodoStore(): TodoStore`; `getReminderService(): TodoReminderService`; `getContextTracker(): TodoContextTracker`; `getDefaultAgentId(): string` | `packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts` | `todo-read`, `todo-write`, `todo-pause`, `todo-store` |
| `ISettingsService` | `packages/tools/src/interfaces/ISettingsService.ts` | `getSettingsService(): SettingsService`; `getSetting(key: string): unknown`; `setSetting(key: string, value: unknown): Promise<void>` | `packages/core/src/tools-adapters/CoreSettingsServiceAdapter.ts` | `task`, `tool-registry` |
| `IPromptRegistryService` | `packages/tools/src/interfaces/IPromptRegistryService.ts` | `getPromptRegistry(): PromptRegistry`; `getPrompt(name: string): Prompt \| undefined` | `packages/core/src/tools-adapters/CorePromptRegistryServiceAdapter.ts` | `tool-registry` |

## Core Adapter Coverage

Mandatory core adapters are bijective with the 14 non-conditional tools-owned interfaces:

1. `packages/core/src/tools-adapters/CoreToolHostAdapter.ts` implements `IToolHost`.
2. `packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts` implements `IToolRegistryHost`.
3. `packages/core/src/tools-adapters/CoreMessageBusAdapter.ts` implements `IToolMessageBus`.
4. `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts` implements `IShellToolHost`.
5. `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts` implements `ISubagentService`.
6. `packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts` implements `IAsyncTaskService`.
7. `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts` implements `ISkillService`.
8. `packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts` implements `IIdeService`.
9. `packages/core/src/tools-adapters/CoreLspServiceAdapter.ts` implements `ILspService`.
10. `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts` implements `IStorageService`.
11. `packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts` implements `IToolKeyStorage`.
12. `packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts` implements `ITodoService`.
13. `packages/core/src/tools-adapters/CoreSettingsServiceAdapter.ts` implements `ISettingsService`.
14. `packages/core/src/tools-adapters/CorePromptRegistryServiceAdapter.ts` implements `IPromptRegistryService`.

Conditional adapter:

15. `packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts` implements `IMcpToolService` only if `mcp-tool.ts` moves into `packages/tools`.

No adapter may implement more than one tools-owned interface unless a later phase explicitly changes the contract and preserves the no-service-bag invariant.

## Provider Export Contracts

| Contract | Direction | Package Export Path |
| --- | --- | --- |
| `ToolFormat` type | tools → providers | `@vybestack/llxprt-code-tools/IToolFormatter.js` |
| `ToolFormatter` | tools → providers | `@vybestack/llxprt-code-tools/ToolFormatter.js` |
| `ToolIdStrategy` + `ToolIdMapper` | tools → providers | `@vybestack/llxprt-code-tools/ToolIdStrategy.js` |
| `toolIdNormalization` | tools → providers | `@vybestack/llxprt-code-tools/toolIdNormalization.js` |
| `doubleEscapeUtils` | tools → providers | `@vybestack/llxprt-code-tools/doubleEscapeUtils.js` |
| `toolNameUtils` | tools → providers | `@vybestack/llxprt-code-tools/toolNameUtils.js` |

Provider consumers must import these paths directly from `@vybestack/llxprt-code-tools`. Core must not retain moved deep-import wrapper shims for these provider-facing exports.

## Core Registry Factory Integration Contract

`packages/core/src/config/toolRegistryFactory.ts` is the primary core integration point for moved tool construction.

Required registry factory directions:

- Import moved tool classes from `@vybestack/llxprt-code-tools` or its approved public subpaths after the tools package exists.
- Import core adapter classes from `packages/core/src/tools-adapters/**`.
- Construct adapters from core-owned runtime objects such as `Config`, core `MessageBus`, `shellExecutionService`, `SubagentManager`, `ProfileManager`, `AsyncTaskManager`, `SkillManager`, `IdeClient`, `LspDiagnosticsHelper`, `ToolKeyStorage`, `SecureStore`, `TodoReminderService`, `TodoContextTracker`, `SettingsService`, and `PromptRegistry`.
- Pass only the narrow adapter interfaces required by each moved tool constructor.
- Do not pass `Config`, concrete core services, concrete `MessageBus`, or a generic service bag into moved tool constructors.
- For `mcp-tool`, construct and pass `CoreMcpToolServiceAdapter` only if `mcp-tool.ts` is moved; MCP client and manager ownership remains in core.

## Scheduler And Non-Registry Consumer Contract

Any scheduler or non-registry core integration file that directly instantiates or invokes moved tools must follow the same boundary as `toolRegistryFactory.ts`:

- Moved tool imports flow from tools into core: `packages/core` imports `@vybestack/llxprt-code-tools` public API.
- Adapter imports remain core-local: `packages/core` imports `packages/core/src/tools-adapters/**`.
- Constructor arguments are explicit narrow adapters, never `Config` or a service bag.
- CLI and provider packages do not instantiate moved tools through tools-owned service interfaces.
- CLI continues to consume core top-level re-exports or core runtime APIs only; no direct CLI dependency on `@vybestack/llxprt-code-tools` is introduced by this contract.

## Moved-Tool Constructor Dependency Contract

Moved tools must depend on the smallest interface set that covers their existing behavior:

| Moved Tool / Module | Required Interface Dependencies |
| --- | --- |
| `write-file`, `insert_at_line`, `delete_line_range`, `read_line_range` | `IToolHost`, `IToolMessageBus` where confirmation or policy updates are required |
| `apply-patch`, `edit`, `ast-edit` | `IToolHost`, `IToolMessageBus`, `IIdeService`, `ILspService` where diagnostics are required |
| `glob`, `grep` | `IToolHost` |
| `shell` | `IToolHost`, `IToolMessageBus`, `IShellToolHost` |
| `task`, `list-subagents` | `ISubagentService`, plus `ISettingsService` for settings-backed behavior |
| `check-async-tasks` | `IAsyncTaskService` |
| `activate-skill` | `ISkillService` |
| `mcp-tool` if moved | `IToolMessageBus`, `IMcpToolService` |
| `memoryTool` | `IStorageService` |
| `tool-key-storage`, `codesearch`, `exa-web-search`, `google-web-search` | `IToolKeyStorage` |
| `todo-read`, `todo-write`, `todo-pause`, `todo-store` | `ITodoService` |
| `tool-registry` | `IToolRegistryHost`, `ISettingsService`, `IPromptRegistryService` |

## Cycle-Free Dependency Directions

Allowed dependency directions:

1. `packages/tools` may depend on external runtime libraries allowed by its package metadata and on its own source files.
2. `packages/tools/src/interfaces/**` owns all tool-facing contracts listed above.
3. `packages/core` may depend on `@vybestack/llxprt-code-tools` to construct moved tools and implement tools-owned interfaces through core adapters.
4. `packages/core/src/tools-adapters/**` may depend on core-owned runtime services and on tools-owned interface types.
5. `packages/providers` may depend on `@vybestack/llxprt-code-tools` provider export paths for formatter and tool ID utilities.
6. `packages/cli` may depend on core top-level APIs and must not gain a direct tools dependency for this migration.

Forbidden dependency directions:

1. `packages/tools` must not import `packages/core`, `packages/cli`, `packages/providers`, or `@vybestack/llxprt-code-core`.
2. `packages/tools` must not import core-local `Config`, concrete `MessageBus`, MCP client/manager, IDE client, LSP helper, settings service, prompt registry, secure store, or todo services directly.
3. `packages/providers` must not import moved tool utility paths from `@vybestack/llxprt-code-core/tools/*` after consumer migration.
4. Core must not add deep-import wrapper shims under `packages/core/src/tools/**` for moved modules.
5. No moved tool constructor may accept a generic service bag or concrete `Config` as a substitute for the contracts above.

Resulting acyclic graph:

```text
providers ───────────────▶ tools public provider exports
core adapters ───────────▶ tools-owned interfaces
core registry/scheduler ─▶ tools public tool exports
core adapters ───────────▶ core runtime services
tools moved modules ─────▶ tools-owned interfaces
cli ─────────────────────▶ core top-level APIs
```

There is no edge from `packages/tools` back to `packages/core`, `packages/providers`, or `packages/cli`, so the package graph remains cycle-free.

## Coverage Assessment

- Tools-owned interface files covered: 15 of 15.
- Mandatory core adapter files covered: 14 of 14.
- Conditional core adapter files covered: 1 of 1 (`CoreMcpToolServiceAdapter.ts`, required only if `mcp-tool.ts` moves).
- Provider export paths covered: 6 of 6 required provider-facing tool utility paths.
- Registry factory direction defined: yes.
- Scheduler / non-registry direction defined: yes.
- Cycle-free dependency directions defined: yes.
- Implementation code changed in this phase: no.
