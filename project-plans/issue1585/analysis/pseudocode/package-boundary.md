# Pseudocode: Tools Package Boundary

Plan ID: PLAN-20260608-ISSUE1585
Phase: P02 Contract-First Pseudocode

## Interface Contracts

Inputs this boundary receives:

- Tool constructor dependencies supplied by explicit core adapters in `packages/core/src/tools-adapters/**`.
- Tool invocation parameters from existing registry/scheduler paths.
- Tool confirmation requests and policy updates through a tools-owned message bus contract.

Outputs this boundary produces:

- Public `@vybestack/llxprt-code-tools` API from `packages/tools/src/index.ts`.
- Subpath exports matching current provider-facing `@vybestack/llxprt-code-core/tools/*` deep paths.
- Tool classes whose constructors depend only on tools-owned interfaces and allowed external packages.

Boundary invariants:

- `packages/tools/**` imports zero modules from `packages/core/**`, `packages/cli/**`, or `packages/providers/**`.
- Interfaces consumed by moved tools are owned by `packages/tools/src/interfaces/**`.
- Core implements those interfaces only through `packages/core/src/tools-adapters/**`.
- No core deep-import compatibility shims are created.

## Numbered Pseudocode

10: METHOD defineToolsPackageBoundary()
11:   CREATE `packages/tools/src/interfaces/IToolHost.ts`
12:     DEFINE interface `IToolHost`
13:     METHODS: `getTargetDir(): string`, `getWorkspaceRoots(): string[]`, `getApprovalMode(): ApprovalMode`, `isInteractive(): boolean`, `hasFeatureFlag(flag: string): boolean`
14:     CONSUMED BY: `write-file`, `insert_at_line`, `delete_line_range`, `apply-patch`, `edit`, `glob`, `grep`
15:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreToolHostAdapter.ts` delegates to `Config`
16:   CREATE `packages/tools/src/interfaces/IToolRegistryHost.ts`
17:     DEFINE interface `IToolRegistryHost`
18:     METHODS: `getCoreTools(): string[]`, `getExcludeTools(): string[]`, `getDiscoveryCommand(): string | undefined`, `isToolEnabled(name: string): boolean`
19:     CONSUMED BY: `tool-registry`
20:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts` delegates to `Config`
21:   CREATE `packages/tools/src/interfaces/IToolMessageBus.ts`
22:     DEFINE interface `IToolMessageBus`
23:     METHODS: `requestConfirmation(details: ToolConfirmationDetails, abortSignal?: AbortSignal): Promise<ToolConfirmationOutcome>`, `publishPolicyUpdate(outcome: ToolConfirmationOutcome): Promise<void>`, `subscribe?(handler: ToolMessageHandler): Unsubscribe`
24:     CONSUMED BY: `tools.ts` / `BaseToolInvocation`, `modifiable-tool`, `shell`, `mcp-tool`
25:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreMessageBusAdapter.ts` delegates to core `MessageBus`
26:   CREATE `packages/tools/src/interfaces/IShellToolHost.ts`
27:     DEFINE interface `IShellToolHost`
28:     METHODS: `execute(command: string, options: ShellExecutionOptions): Promise<ShellResult>`, `isCommandAllowed(command: string): boolean`
29:     CONSUMED BY: `shell`
30:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts` delegates to `shellExecutionService`
31:   CREATE `packages/tools/src/interfaces/ISubagentService.ts`
32:     DEFINE interface `ISubagentService`
33:     METHODS: `executeSubagent(request: SubagentRequest): Promise<SubagentResult>`, `listSubagents(): SubagentInfo[]`, `getSubagentConfig(name: string): SubagentConfig | undefined`
34:     CONSUMED BY: `task`, `list-subagents`
35:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts` delegates to `SubagentManager` and `ProfileManager`
36:   CREATE `packages/tools/src/interfaces/IAsyncTaskService.ts`
37:     DEFINE interface `IAsyncTaskService`
38:     METHODS: `checkAsyncTask(taskId: string): Promise<TaskStatus>`, `getTaskStatus(): TaskInfo[]`
39:     CONSUMED BY: `check-async-tasks`
40:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts` delegates to `AsyncTaskManager`
41:   CREATE `packages/tools/src/interfaces/ISkillService.ts`
42:     DEFINE interface `ISkillService`
43:     METHODS: `activateSkill(name: string): Promise<SkillResult>`, `getSkillManager(): SkillManager`
44:     CONSUMED BY: `activate-skill`
45:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts` delegates to `Config.getSkillManager()`
46:   CREATE `packages/tools/src/interfaces/IMcpToolService.ts`
47:     DEFINE interface `IMcpToolService`
48:     METHODS: `callTool(serverName: string, toolName: string, params: unknown): Promise<Part[]>`, `discoverTools(): Promise<DiscoveredTool[]>`, `getTool(serverName: string, toolName: string): McpDiscoveredTool | undefined`
49:     CONSUMED BY: `mcp-tool` if it moves
50:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts` delegates to `McpClientManager` only if `mcp-tool.ts` moves
51:   CREATE `packages/tools/src/interfaces/IIdeService.ts`
52:     DEFINE interface `IIdeService`
53:     METHODS: `applyDiff(params: ApplyDiffParams): Promise<DiffResult>`, `getConnectionStatus(): IDEConnectionStatus`, `openDiff(params: OpenDiffParams): Promise<void>`
54:     CONSUMED BY: `apply-patch`, `edit`
55:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts` delegates to `IdeClient`
56:   CREATE `packages/tools/src/interfaces/ILspService.ts`
57:     DEFINE interface `ILspService`
58:     METHODS: `getDiagnostics(filePath: string): Diagnostic[]`, `waitForDiagnostics(filePath: string, timeout: number): Promise<Diagnostic[]>`
59:     CONSUMED BY: `lsp-diagnostics-helper`, `ast-edit`
60:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreLspServiceAdapter.ts` delegates to `LspDiagnosticsHelper`
61:   CREATE `packages/tools/src/interfaces/IStorageService.ts`
62:     DEFINE interface `IStorageService`
63:     METHODS: `getLLXPRTDir(): string`, `readFile(path: string): Promise<string>`, `writeFile(path: string, content: string): Promise<void>`, `ensureDir(path: string): Promise<void>`
64:     CONSUMED BY: `memoryTool`
65:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts` delegates to `Config` storage APIs and `fs`
66:   CREATE `packages/tools/src/interfaces/IToolKeyStorage.ts`
67:     DEFINE interface `IToolKeyStorage`
68:     METHODS: `saveKey(toolName: string, key: string): Promise<void>`, `getKey(toolName: string): Promise<string | null>`, `deleteKey(toolName: string): Promise<void>`, `hasKey(toolName: string): Promise<boolean>`, `resolveKey(toolName: string): Promise<string | null>`, `maskKeyForDisplay(key: string): string`, `getSupportedToolNames(): string[]`
69:     CONSUMED BY: `codesearch`, `exa-web-search`, `google-web-search`, key-storage helpers
70:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts` owns `ToolKeyStorage` plus `SecureStore` lifecycle; `ToolKeyStorage` class stays in core
71:   CREATE `packages/tools/src/interfaces/ITodoService.ts`
72:     DEFINE interface `ITodoService`
73:     METHODS: `getTodoStore(): TodoStore`, `getReminderService(): TodoReminderService`, `getContextTracker(): TodoContextTracker`, `getDefaultAgentId(): string`
74:     CONSUMED BY: `todo-read`, `todo-write`, `todo-pause`, `todo-store`
75:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts` delegates to `TodoReminderService` and `TodoContextTracker`
76:   CREATE `packages/tools/src/interfaces/ISettingsService.ts`
77:     DEFINE interface `ISettingsService`
78:     METHODS: `getSettingsService(): SettingsService`, `getSetting(key: string): unknown`, `setSetting(key: string, value: unknown): Promise<void>`
79:     CONSUMED BY: `task`, `tool-registry`
80:     CORE ADAPTER: `packages/core/src/tools-adapters/CoreSettingsServiceAdapter.ts` delegates to `Config.getSettingsService()`
81:   CREATE `packages/tools/src/interfaces/IPromptRegistryService.ts`
82:     DEFINE interface `IPromptRegistryService`
83:     METHODS: `getPromptRegistry(): PromptRegistry`, `getPrompt(name: string): Prompt | undefined`
84:     CONSUMED BY: `tool-registry`
85:     CORE ADAPTER: `packages/core/src/tools-adapters/CorePromptRegistryServiceAdapter.ts` delegates to `Config.getPromptRegistry()`
86:   FOR each moved tool class constructor in `packages/core/src/tools/**`
87:     REPLACE concrete `Config` parameter with one or more of `IToolHost`, `IToolRegistryHost`, `ISettingsService`, `IPromptRegistryService`, `IStorageService`, `IToolKeyStorage`, `ITodoService`, `IShellToolHost`, `ISubagentService`, `IAsyncTaskService`, `ISkillService`, `IMcpToolService`, `IIdeService`, `ILspService`
88:     REPLACE concrete `MessageBus` parameter with `IToolMessageBus`
89:     REPLACE direct imports from core services with injected tools-owned interface parameters
90:     PRESERVE constructor-visible behavior and runtime defaults through the corresponding core adapter
91:   ENDFOR
92:   CREATE or update `packages/tools/src/index.ts`
93:     EXPORT moved tool classes, tool types, formatter utilities, ID utilities, `maskKeyForDisplay`, `getSupportedToolNames`, and all interfaces in `packages/tools/src/interfaces/**`
94:   DEFINE `packages/tools/package.json` subpath exports matching current core tools deep paths used by providers
95:     EXPORT `./IToolFormatter.js` to the moved formatter module
96:     EXPORT `./ToolFormatter.js` to the moved formatter module
97:     EXPORT `./ToolIdStrategy.js` to the moved formatter module
98:     EXPORT `./toolIdNormalization.js` to the moved formatter module
99:     EXPORT `./doubleEscapeUtils.js` to the moved formatter module
100:     EXPORT `./toolNameUtils.js` to the moved formatter module
101:   ENSURE `packages/tools/**` imports ZERO `packages/core/**`, `packages/cli/**`, `packages/providers/**`, or `@vybestack/llxprt-code-core`
102:   ENSURE moved tool constructors receive adapters from core registry/scheduler integration rather than a service bag
103:   RETURN interface boundary ready for P03 stub creation

## Verification Pseudocode

110: RUN `rg -n "(@vybestack/llxprt-code-core|packages/core|../core|../config|../services|../mcp|../ide|../lsp|../storage)" packages/tools -g "*.ts"`
111: EXPECT zero forbidden imports after implementation phases
112: RUN `rg -n "IToolHost|IToolRegistryHost|IToolMessageBus|IShellToolHost|ISubagentService|IAsyncTaskService|ISkillService|IMcpToolService|IIdeService|ILspService|IStorageService|IToolKeyStorage|ITodoService|ISettingsService|IPromptRegistryService" packages/tools/src/interfaces -g "*.ts"`
113: EXPECT all 15 interface files present after P03/P05

## Anti-Pattern Warnings

[ERROR] DO NOT: move files into `packages/tools` while preserving imports from `packages/core`.
[ERROR] DO NOT: store `Config` inside `ToolContext` as a generic service locator.
[ERROR] DO NOT: create core deep-import wrapper files forwarding to `@vybestack/llxprt-code-tools`.
[ERROR] DO NOT: collapse adapters into a broad service bag.
[OK] DO: use narrow tools-owned interfaces and behavioral tests through existing runtime paths.
