# Consumer Rewrite Map Final: Current Tools Import Surface

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08
Revised: 2026-06-08 (review-02)

Generated from actual `rg` output. Every current tools import is classified exactly once across the categories below.

## Evidence Command

```bash
rg -rn "from ['\"][^'\"]*\.\./tools/|from ['\"][^'\"]*\.\./\.\./tools/|@vybestack/llxprt-code-core/tools/" packages -g "*.ts"
# Full current consumer map, including CLI, vi.mock, dynamic imports, and new URL patterns
rg -n "@vybestack/llxprt-code-core/tools/|['\"]\.\.?/.*tools/|import\(.*tools|vi\.mock\(.*tools|new URL\(.*tools" packages -g "*.ts" > project-plans/issue1585/analysis/all-tool-consumers-final.txt
```

## Category: providers (40 imports)

Provider deep imports from `@vybestack/llxprt-code-core/tools/` — rewrite to `@vybestack/llxprt-code-tools/`:

| File | Old Import | Import Type |
| --- | --- | --- |
| providers/src/anthropic/AnthropicProvider.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/anthropic/AnthropicMessageNormalizer.ts | `{ normalizeToAnthropicToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/anthropic/AnthropicResponseParser.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/anthropic/AnthropicResponseParser.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/anthropic/AnthropicStreamProcessor.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/anthropic/AnthropicStreamProcessor.ts | `imports from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai-responses/OpenAIResponsesInputBuilder.ts | `{ normalizeToOpenAIToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai-responses/OpenAIResponsesProviderBase.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/openai-responses/buildResponsesInputFromContent.ts | `{ normalizeToOpenAIToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAIProvider.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/openai/OpenAIProvider.ts | `{ ToolFormatter } from .../ToolFormatter.js` | concrete |
| providers/src/openai/OpenAIRequestBuilder.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/openai/OpenAIRequestBuilder.ts | `imports from .../ToolIdStrategy.js` | concrete |
| providers/src/openai/OpenAIRequestBuilder.ts | `{ normalizeToOpenAIToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAIResponseParser.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAIResponseParser.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai/OpenAINonStreamHandler.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAINonStreamHandler.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai/OpenAIStreamProcessor.ts | `imports from .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAIStreamProcessor.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai/OpenAIStreamProcessor.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/openai/ToolCallNormalizer.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai/ToolNameValidator.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/openai/ToolNameValidator.ts | `imports from .../toolNameUtils.js` | concrete |
| providers/src/openai/syntheticToolResponses.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai/buildResponsesRequest.ts | `type { ResponsesTool } from .../IToolFormatter.js` | type |
| providers/src/openai/buildResponsesRequest.ts | `{ normalizeToOpenAIToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | `{ getToolIdStrategy } from .../ToolIdStrategy.js` | concrete |
| providers/src/openai-vercel/OpenAIVercelProvider.ts | `imports from .../toolIdNormalization.js` | concrete |
| providers/src/openai-vercel/messageConversion.ts | `imports from .../toolIdNormalization.js` | concrete |
| providers/src/openai-vercel/messageConversion.ts | `type { ToolIdMapper } from .../ToolIdStrategy.js` | type |
| providers/src/reasoning/reasoningUtils.ts | `{ processToolParameters } from .../doubleEscapeUtils.js` | concrete |
| providers/src/reasoning/reasoningUtils.ts | `{ normalizeToHistoryToolId } from .../toolIdNormalization.js` | concrete |
| providers/src/utils/toolFormatDetection.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |
| providers/src/utils/toolFormatDetection.ts | `imports from .../ToolIdStrategy.js` | concrete |

Provider test mocks:
| providers/src/anthropic/AnthropicProvider.issue276.test.ts | `vi.mock(.../ToolFormatter.js)` | mock |
| providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts | `vi.mock(.../ToolFormatter.js)` | mock |
| providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts | `vi.mock(.../ToolFormatter.js)` | mock |
| providers/src/anthropic/AnthropicProvider.test.ts | `vi.mock(.../ToolFormatter.js)` | mock |
| providers/src/openai-responses/__tests__/...test.ts | `import .../toolIdNormalization.js` | concrete |
| providers/src/openai/OpenAIProvider.toolNameErrors.test.ts | `import .../ToolFormatter.js` | concrete |
| providers/src/openai/ToolCallNormalizer.test.ts | `vi.mock(.../doubleEscapeUtils.js)` | mock |
| providers/src/openai/ToolCallNormalizer.test.ts | `import .../doubleEscapeUtils.js` | concrete |
| providers/src/openai/__tests__/ToolNameValidator.test.ts | `type { ToolFormat } from .../IToolFormatter.js` | type |

## Category: core/config (6 files, 10 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/config/toolRegistryFactory.ts | ToolRegistry + 26 concrete tool classes from ../tools/ | `@vybestack/llxprt-code-tools` + adapter construction |
| core/src/config/config.ts | `type { ToolRegistry }`, `{ ActivateSkillTool }`, `{ McpClientManager }` | tools: ToolRegistry/ActivateSkillTool; core: McpClientManager |
| core/src/config/configBase.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/config/configBaseCore.ts | `type { ToolRegistry }`, `type { McpClientManager }`, `{ LLXPRT_CONFIG_DIR }` | tools: ToolRegistry; core: McpClientManager; mixed: LLXPRT_CONFIG_DIR |
| core/src/config/configTypes.ts | `type { AnyToolInvocation }` | `@vybestack/llxprt-code-tools` |
| core/src/config/lspIntegration.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/config/schedulerSingleton.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/config/configConstructor.ts | `{ setLlxprtMdFilename }` | `@vybestack/llxprt-code-tools` |

## Category: core/confirmation-bus (3 files, 3 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/confirmation-bus/message-bus.ts | `ToolConfirmationOutcome, ToolConfirmationPayload` from ../tools/tool-confirmation-types | `@vybestack/llxprt-code-tools` |
| core/src/confirmation-bus/types.ts | `ToolConfirmationOutcome, ToolConfirmationPayload` from ../tools/tool-confirmation-types | `@vybestack/llxprt-code-tools` |
| core/src/confirmation-bus/message-bus.test.ts | `ToolConfirmationOutcome` from ../tools/tool-confirmation-types | `@vybestack/llxprt-code-tools` |
| core/src/confirmation-bus/integration.test.ts | `ToolConfirmationOutcome` from ../tools/tool-confirmation-types | `@vybestack/llxprt-code-tools` |

## Category: core/scheduler (5 files, 12 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/scheduler/types.ts | `AnyToolInvocation, AnyDeclarativeTool, ToolResult, ...` + `ToolConfirmationOutcome` | `@vybestack/llxprt-code-tools` |
| core/src/scheduler/confirmation-coordinator.ts | `ToolConfirmationOutcome`, `ToolCallConfirmationDetails`, `tool-confirmation-types`, `modifiable-tool` | `@vybestack/llxprt-code-tools` |
| core/src/scheduler/tool-executor.ts | `type { ToolResult }` | `@vybestack/llxprt-code-tools` |
| core/src/scheduler/result-aggregator.ts | `type { ToolResult }`, `ToolErrorType` | `@vybestack/llxprt-code-tools` |
| core/src/scheduler/tool-dispatcher.ts | `ToolErrorType`, `AnyDeclarativeTool, AnyToolInvocation`, `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |

## Category: core/core (10 files, 18 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/core/turn.ts | `BaseToolInvocation, ToolResult, ToolErrorType, normalizeToolName, ...` | `@vybestack/llxprt-code-tools` |
| core/src/core/TurnProcessor.ts | `{ hasCycleInSchema }` | `@vybestack/llxprt-code-tools` |
| core/src/core/StreamProcessor.ts | `{ hasCycleInSchema }` | `@vybestack/llxprt-code-tools` |
| core/src/core/MessageStreamOrchestrator.ts | `type { Todo }` | `@vybestack/llxprt-code-tools` |
| core/src/core/ChatSessionFactory.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/core/subagentOrchestrator.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/core/subagentRuntimeSetup.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/core/subagentToolProcessing.ts | `TodoStore`, `ToolErrorType`, `type { ToolResultDisplay }` | `@vybestack/llxprt-code-tools` |
| core/src/core/TodoContinuationService.ts | `TodoStore`, `type { Todo }` | `@vybestack/llxprt-code-tools` |
| core/src/core/toolGovernance.ts | `normalizeToolName, toSnakeCase` | `@vybestack/llxprt-code-tools` |
| core/src/core/clientToolGovernance.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/core/coreToolHookTriggers.ts | `imports from ../tools/tools.js` | `@vybestack/llxprt-code-tools` |

## Category: core/agents (4 files, 9 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/agents/executor.ts | `ToolRegistry` | `@vybestack/llxprt-code-tools` |
| core/src/agents/executor-validation.ts | `ToolRegistry`, `GlobTool, GrepTool, RipGrepTool, LSTool, MemoryTool, ReadFileTool, ReadManyFilesTool, GoogleWebSearchTool` | `@vybestack/llxprt-code-tools` |
| core/src/agents/invocation.ts | `BaseToolInvocation, type ToolResult, ToolErrorType` | `@vybestack/llxprt-code-tools` |
| core/src/agents/types.ts | `type { AnyDeclarativeTool }` | `@vybestack/llxprt-code-tools` |

## Category: core/policy (2 files, 3 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/policy/policy-helpers.ts | `BaseToolInvocation`, `type { AnyToolInvocation }` | `@vybestack/llxprt-code-tools` |
| core/src/policy/policy-updater.test.ts | `ShellToolInvocation`, `tools.js types` | `@vybestack/llxprt-code-tools` |

## Category: core/telemetry (4 files, 6 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/telemetry/metrics.ts | `type { DiffStat }` | `@vybestack/llxprt-code-tools` |
| core/src/telemetry/types.ts | `DiscoveredMCPTool`, `ToolConfirmationOutcome` | tools: DiscoveredMCPTool (if moved), else core; tools: ToolConfirmationOutcome |
| core/src/telemetry/tool-call-decision.ts | `ToolConfirmationOutcome` | `@vybestack/llxprt-code-tools` |
| core/src/telemetry/loggers.test.ts | `DiscoveredMCPTool`, `type { CallableTool }` | see mcp-tool decision |

## Category: core/storage (2 files, 2 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/storage/SessionPersistenceService.ts | `ToolResultDisplay, ...` from ../tools/tools.js | `@vybestack/llxprt-code-tools` |
| core/src/storage/secure-store-integration.test.ts | `{ maskKeyForDisplay }` from ../tools/tool-key-storage.js | `@vybestack/llxprt-code-tools` (pure function) |

## Category: core/utils (5 files, 8 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/utils/fileUtils.ts | `ToolErrorType` | `@vybestack/llxprt-code-tools` |
| core/src/utils/ignorePatterns.ts | `getCurrentLlxprtMdFilename` from ../tools/memoryTool | `@vybestack/llxprt-code-tools` |
| core/src/utils/memoryDiscovery.ts | `setLlxprtMdFilename, getCurrentLlxprtMdFilename, LLXPRT_CONFIG_DIR` | `@vybestack/llxprt-code-tools` |
| core/src/utils/events.ts | `type { McpClient }` from ../tools/mcp-client.js | **KEEP IN CORE** — McpClient stays |
| core/src/utils/summarizer.ts | `type { ToolResult }` | `@vybestack/llxprt-code-tools` |

## Category: core/test-utils (2 files, 6 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/test-utils/mock-tool.ts | `ToolInvocation, ToolResult, BaseToolInvocation, ...` from ../tools/tools.js | `@vybestack/llxprt-code-tools` |
| core/src/test-utils/tools.ts | `BaseToolInvocation, ...` + `modifiable-tool` from ../tools/ | `@vybestack/llxprt-code-tools` |

**Note**: `@vybestack/llxprt-code-test-utils` is devDependency-only of packages/tools.

## Category: core/hooks (1 file, 1 import)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/hooks/notification-hook.test.ts | `type { ToolCallConfirmationDetails }` | `@vybestack/llxprt-code-tools` |

## Category: core/runtime (2 files, 2 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/runtime/AgentRuntimeLoader.ts | `normalizeToolName`, `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |
| core/src/runtime/runtimeAdapters.ts | `type { ToolRegistry }` | `@vybestack/llxprt-code-tools` |

## Category: core/prompts (1 file, mixed)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/core/prompts.ts | `memoryTool` exports | `@vybestack/llxprt-code-tools` |

## Category: core/services (2 files, 2 imports)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/services/todo-reminder-service.ts | `type { Todo }` from ../tools/todo-schemas | `@vybestack/llxprt-code-tools` |
| core/src/services/tool-call-tracker-service.ts | `type { TodoToolCall }` from ../tools/todo-schemas | `@vybestack/llxprt-code-tools` |

## Category: core/lsp (1 file, 1 import)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/lsp/__tests__/system-integration.test.ts | `{ setLlxprtMdFilename }` from ../../tools/memoryTool | `@vybestack/llxprt-code-tools` |

## Category: core/todo (1 file, 1 import)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/todo/todoFormatter.ts | `type { Todo, TodoToolCall }` from ../tools/todo-schemas | `@vybestack/llxprt-code-tools` |

## Category: cli (via core top-level re-export, 0 direct tools imports)

CLI imports tool types ONLY from `@vybestack/llxprt-code-core` top-level re-export. No CLI file imports directly from `@vybestack/llxprt-code-core/tools/`.

| File | Tool Types Used | Source | Rewrite Needed? |
| --- | --- | --- | --- |
| cli/src/zed-integration/zedIntegration.ts | ToolResult, ToolConfirmationOutcome, ToolConfirmationPayload, ContextAwareTool, DiscoveredMCPTool, AnyToolInvocation, AnyDeclarativeTool, Todo, DEFAULT_AGENT_ID | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/nonInteractiveCliSupport.ts | ToolResult display | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/nonInteractiveCli.test-helpers.ts | Test helpers via core | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/nonInteractiveCli.ts | Tool types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/nonInteractiveCli*.test.ts | Test types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/ui/hooks/slashCommandHandlers.ts | No tool types directly | N/A | No |
| cli/src/ui/hooks/useToolScheduler.test.ts | Tool types via core | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/ui/hooks/atCommandProcessor.ts | No tool types directly | N/A | No |
| cli/src/ui/hooks/atCommandProcessor*.ts | No tool types directly | N/A | No |
| cli/src/ui/types.ts | ToolCallConfirmationDetails, ToolResultDisplay | `@vybestack/llxprt-code-core` (top-level) | No |
| cli/src/types/message-bus-augmentation.d.ts | ToolConfirmationOutcome, ToolConfirmationPayload | `@vybestack/llxprt-code-core` (top-level) | No |

**Migration decision**: CLI uses core top-level re-exports. After tools extraction, core re-exports these types from `@vybestack/llxprt-code-tools`. CLI does NOT need a direct `@vybestack/llxprt-code-tools` dependency. CLI's dependency on core transitively provides tools types. No CLI import rewrites required unless core removes a re-export that CLI needs.

## Category: core compression (1 file)

| File | Import | Rewrites To |
| --- | --- | --- |
| core/src/core/compression/utils.ts | `classifyMediaBlock` from ../tools/mediaUtils.js | `@vybestack/llxprt-code-tools` |

## Summary Counts

| Category | Files | Imports |
| --- | --- | --- |
| providers | 36+ | 40+ |
| core/config | 8 | 10+ |
| core/confirmation-bus | 4 | 4 |
| core/scheduler | 5 | 12+ |
| core/core | 12 | 18+ |
| core/agents | 4 | 9+ |
| core/policy | 2 | 3 |
| core/telemetry | 4 | 6 |
| core/storage | 2 | 2 |
| core/utils | 5 | 8 |
| core/test-utils | 2 | 6 |
| core/hooks | 1 | 1 |
| core/runtime | 2 | 2 |
| core/services | 2 | 2 |
| core/lsp | 1 | 1 |
| core/todo | 1 | 1 |
| core/prompts | 1 | 1+ |
| core/compression | 1 | 1 |
| cli | 4+ | 0 direct tools imports (all via core re-export) |
| **Total** | **~100** | **~130+** |