# Phase 02b: Integration Contract Definition

## Phase ID

`PLAN-20260608-ISSUE1585.P02b`

## Purpose

Define exact contracts between packages/tools, core adapters, providers, registry factory, and scheduler. Every contract must specify which interface file defines it, which adapter implements it, and which moved tools consume it.

## Prerequisites

- Required: P02a completed (pseudocode verified).
- Previous artifacts: all analysis and pseudocode files.

## Requirements Implemented

### REQ-API-001, REQ-DEP-001, REQ-TEST-001

## Implementation Tasks

### Step 1: Create analysis/integration-contract.md

Define exact contracts in the following table format:

| Contract | Interface File | Key Method Signatures | Core Adapter File | Consumed By Moved Tools |
| --- | --- | --- | --- | --- |
| IToolHost | packages/tools/src/interfaces/IToolHost.ts | getTargetDir(): string; getWorkspaceRoots(): string[]; getApprovalMode(): ApprovalMode; isInteractive(): boolean; hasFeatureFlag(flag: string): boolean | packages/core/src/tools-adapters/CoreToolHostAdapter.ts | write-file, insert_at_line, delete_line_range, apply-patch, read_line_range, glob, grep, edit |
| IToolRegistryHost | packages/tools/src/interfaces/IToolRegistryHost.ts | getCoreTools(): string[]; getExcludeTools(): string[]; isToolEnabled(name: string): boolean | packages/core/src/tools-adapters/CoreToolRegistryHostAdapter.ts | tool-registry |
| IToolMessageBus | packages/tools/src/interfaces/IToolMessageBus.ts | requestConfirmation(details: ToolCallConfirmationDetails): Promise\<ToolConfirmationOutcome\>; publishPolicyUpdate(outcome: ToolConfirmationOutcome, options?: PolicyUpdateOptions): Promise\<void\> | packages/core/src/tools-adapters/CoreMessageBusAdapter.ts | tools.ts (BaseToolInvocation), modifiable-tool, shell, mcp-tool |
| IShellToolHost | packages/tools/src/interfaces/IShellToolHost.ts | executeShellCommand(command: string, options: ShellExecutionOptions): Promise<ShellExecutionResult>; validatePath(path: string): PathValidationResult | packages/core/src/tools-adapters/CoreShellToolHostAdapter.ts | shell |
| ISubagentService | packages/tools/src/interfaces/ISubagentService.ts | executeSubagent(request: SubagentRequest): Promise\<SubagentResult\>; listSubagents(): SubagentInfo[] | packages/core/src/tools-adapters/CoreSubagentServiceAdapter.ts | task, list-subagents |
| IAsyncTaskService | packages/tools/src/interfaces/IAsyncTaskService.ts | checkAsyncTask(taskId: string): Promise\<TaskStatus\> | packages/core/src/tools-adapters/CoreAsyncTaskServiceAdapter.ts | check-async-tasks |
| ISkillService | packages/tools/src/interfaces/ISkillService.ts | activateSkill(name: string): Promise\<SkillActivationResult\> | packages/core/src/tools-adapters/CoreSkillServiceAdapter.ts | activate-skill |
| IMcpToolService | packages/tools/src/interfaces/IMcpToolService.ts | callTool(serverName: string, toolName: string, params: Record\<string, unknown\>): Promise\<Part[]\>; discoverTools(): Promise\<DiscoveredMCPTool[]> | packages/core/src/tools-adapters/CoreMcpToolServiceAdapter.ts | mcp-tool (if moved) |
| IIdeService | packages/tools/src/interfaces/IIdeService.ts | applyDiff(params: DiffParams): Promise\<DiffUpdateResult\>; getConnectionStatus(): IDEConnectionStatus | packages/core/src/tools-adapters/CoreIdeServiceAdapter.ts | apply-patch, edit |
| ILspService | packages/tools/src/interfaces/ILspService.ts | getDiagnostics(filePath: string): Diagnostic[]; waitForDiagnostics(filePath: string, timeout: number): Promise\<Diagnostic[]> | packages/core/src/tools-adapters/CoreLspServiceAdapter.ts | lsp-diagnostics-helper, ast-edit |
| IStorageService | packages/tools/src/interfaces/IStorageService.ts | getLLXPRTDir(): string; readFile(path: string): Promise\<string\>; writeFile(path: string, content: string): Promise\<void\> | packages/core/src/tools-adapters/CoreStorageServiceAdapter.ts | memoryTool |
| IToolKeyStorage | packages/tools/src/interfaces/IToolKeyStorage.ts | saveKey(toolName: string, key: string): Promise\<void\>; getKey(toolName: string): Promise\<string\|null\>; deleteKey(toolName: string): Promise\<void\>; hasKey(toolName: string): Promise\<boolean\>; resolveKey(toolName: string): Promise\<string\|null\>; maskKeyForDisplay(key: string): string; getSupportedToolNames(): string[] | packages/core/src/tools-adapters/CoreToolKeyStorageAdapter.ts | tool-key-storage, codesearch, exa-web-search, google-web-search |
| ITodoService | packages/tools/src/interfaces/ITodoService.ts | getTodoStore(): TodoStore; getReminderService(): TodoReminderService; getDefaultAgentId(): string | packages/core/src/tools-adapters/CoreTodoServiceAdapter.ts | todo-read, todo-write, todo-pause, todo-store |

### Step 2: Provider Contract

| Contract | Direction | Package Export Path |
| --- | --- | --- |
| ToolFormat type | tools → providers | @vybestack/llxprt-code-tools/IToolFormatter.js |
| ToolFormatter | tools → providers | @vybestack/llxprt-code-tools/ToolFormatter.js |
| ToolIdStrategy + ToolIdMapper | tools → providers | @vybestack/llxprt-code-tools/ToolIdStrategy.js |
| toolIdNormalization | tools → providers | @vybestack/llxprt-code-tools/toolIdNormalization.js |
| doubleEscapeUtils | tools → providers | @vybestack/llxprt-code-tools/doubleEscapeUtils.js |
| toolNameUtils | tools → providers | @vybestack/llxprt-code-tools/toolNameUtils.js |

### Files To Create Or Modify

- Create: `analysis/integration-contract.md` with the tables above
- Create: `project-plans/issue1585/.completed/P02b.md`

## Verification Commands

```bash
# Verify integration contract exists
test -s project-plans/issue1585/analysis/integration-contract.md
grep -c "packages/tools/src/interfaces/" project-plans/issue1585/analysis/integration-contract.md
grep -c "packages/core/src/tools-adapters/" project-plans/issue1585/analysis/integration-contract.md
```

## Semantic Verification Checklist

- [ ] Every interface names exact file, methods, adapter, and consumer.
- [ ] Provider contracts specify exact export paths.
- [ ] No cycles in the dependency graph.
- [ ] No code changed (integration contract definition, no code markers required).

## Success Criteria

- Integration contract covers all 15 tools-owned interface files and 14 mandatory + 1 conditional core adapter files.
- Adapter mapping is bijective (one adapter per interface).
- No code changed.

## Failure Recovery

Return to P02b to add missing contracts.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P02b.md` with contract coverage assessment.
