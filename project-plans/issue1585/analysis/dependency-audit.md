# Dependency Audit: Tools Package Extraction

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Revised: 2026-06-08 (review-02)

## Evidence Collected

### Tools Tree Size

- 150 TypeScript files in packages/core/src/tools/
- 79 test/spec files
- 152 total relevant files including snapshots

### Current Built-In Tool Registration

packages/core/src/config/toolRegistryFactory.ts imports:

- ToolRegistry
- LSTool, ReadFileTool, GrepTool, RipGrepTool, GlobTool
- EditTool, ShellTool, ASTEditTool, ASTReadFileTool
- AstGrepTool, StructuralAnalysisTool, WriteFileTool
- GoogleWebFetchTool, ReadManyFilesTool, ReadLineRangeTool
- DeleteLineRangeTool, InsertAtLineTool, ApplyPatchTool
- MemoryTool, GoogleWebSearchTool, ExaWebSearchTool
- CodeSearchTool, DirectWebFetchTool
- TaskTool, ListSubagentsTool, CheckAsyncTasksTool

### Consumer Groups (Extended Inventory)

1. **Core config**: toolRegistryFactory.ts, configBaseCore.ts, config.ts
2. **Core runtime**: TurnProcessor, subagentOrchestrator, TodoContinuationService, coreToolHookTriggers, subagentRuntimeSetup, clientToolGovernance, ChatSessionFactory, subagentToolProcessing, turn, StreamProcessor, MessageStreamOrchestrator, prompts, compression/utils, toolGovernance
3. **Core scheduler**: coreToolScheduler (ToolContext, ContextAwareTool)
4. **Core agents**: agents/* (ToolRegistry, validation tools)
5. **Core confirmation-bus**: ToolConfirmationOutcome, payload types
6. **Core telemetry**: ToolConfirmationOutcome, DiscoveredMCPTool, CallableTool, DiffStat, ToolErrorType
7. **Core prompts**: DiscoveredMCPPrompt from mcp-client
8. **Core storage**: SessionPersistenceService (ToolResult display types)
9. **Core policy**: tool governance/policy types
10. **Core hooks**: hook/trigger types from tools
11. **Core runtime services**: service definitions
12. **Core test-utils**: tools.ts, mock-tool.ts types
13. **Core utils**: utility types from tools
14. **LSP tests/integration**: packages/lsp test files
15. **Package exports**: packages/core/package.json ./tools/* entries (5: doubleEscapeUtils, IToolFormatter, ToolFormatter, ToolIdStrategy, toolNameUtils, toolIdNormalization)
16. **Provider test mocks**: vi.mock(@vybestack/llxprt-code-core/tools/ToolFormatter) in 4+ test files
17. **Provider production imports**: 20+ imports across anthropic, openai, openai-vercel, reasoning, utils
18. **Dynamic imports**: import() of tool modules

### Tools Imports From Core (Production Files Only)

47 production files in packages/core/src/tools/ import from core modules (../config, ../confirmation-bus, ../services, ../core, ../ide, ../lsp, ../storage, ../debug, ../utils, ../mcp).

Key dependencies by target:
- config: Config, ApprovalMode, Storage, subagentManager, profileManager, types
- confirmation-bus: MessageBus
- services: shellExecutionService, fileDiscoveryService, fileSystemService, git-stats-service, todo-reminder-service, todo-context-tracker, tool-call-tracker-service, asyncTaskManager, history/IContent
- core: turn (DEFAULT_AGENT_ID), subagentTypes, subagentOrchestrator
- ide: ideContext, ide-client
- storage: secure-store, ProviderKeyStorage
- utils: schemaValidator, safeJsonStringify, debugLogger, paths, fileUtils, unicodeUtils, errors, terminalSerializer, fetch, gitUtils, shell-parser, shell-utils, getFolderStructure, editor, workspaceContext, ignorePatterns, ripgrepPathResolver, ast-grep-utils, resolveTextSearchTarget, generateContentResponseUtilities, events, retry
- mcp: google-auth-provider, oauth-provider, oauth-token-storage
- debug: DebugLogger, debugLogger

### Provider Deep Imports After Issue #1584

20+ imports of @vybestack/llxprt-code-core/tools/* in providers/src across:
- utils/toolFormatDetection.ts
- reasoning/reasoningUtils.ts
- openai-vercel/messageConversion.ts, OpenAIVercelProvider.ts
- anthropic/AnthropicProvider.ts, AnthropicStreamProcessor.ts, AnthropicMessageNormalizer.ts, AnthropicResponseParser.ts
- openai/OpenAIResponseParser.ts
- Plus 4+ vi.mock() paths in test files

### Missing Desired Dependency Packages

packages/settings, packages/storage, and packages/mcp do not exist. Approved temporary tools-owned interface/core-adapter path documented in this plan.

### Release Process Evidence

- release.yml: publishes core, lsp, providers, cli (not tools)
- release-process.test.js: verifies publish order, tarball prep, sandbox, Dockerfile
- build_sandbox.js: packs cli, core, providers (not tools)
- Dockerfile: copies/installs core, providers, cli tarballs (not tools)

## Hard Blockers (Resolved)

### BLOCKER-001: Missing packages/settings and packages/storage
Resolution: Approved temporary tools-owned interface/core-adapter path. Implementation proceeds.

### BLOCKER-002: Direct tools-to-core imports
Resolution: Move tools only after replacing core imports with tools-owned interfaces.

### BLOCKER-003: ToolRegistry currently imports Config
Resolution: Define IToolRegistryHost in packages/tools; core adapter implements it.

### BLOCKER-004: tools.ts currently imports MessageBus and IDE diff types
Resolution: Define IToolMessageBus, IIdeService in packages/tools; core adapters implement them.

### BLOCKER-005: High-coupling tools need service interfaces
Resolution: Create explicit service interfaces in packages/tools and concrete adapters in core.

### BLOCKER-006: Release and sandbox packaging omit tools
Resolution: P14 updates release.yml, release-process.test.js, build_sandbox.js, Dockerfile, and creates manual-trusted-publishing.md. P14 also covers scripts/version.js, scripts/prepare-package.js, and scripts/build.js.

---

### Group 1: Core config
- Matches: 71; files: 10
  - packages/core/src/config/config-lsp-integration.test.ts (14 matches)
  - packages/core/src/config/config.test.ts (15 matches)
  - packages/core/src/config/config.ts (3 matches)
  - packages/core/src/config/configBase.ts (1 matches)
  - packages/core/src/config/configBaseCore.ts (3 matches)
  - packages/core/src/config/configConstructor.ts (1 matches)
  - packages/core/src/config/configTypes.ts (1 matches)
  - packages/core/src/config/lspIntegration.ts (2 matches)
  - packages/core/src/config/schedulerSingleton.ts (1 matches)
  - packages/core/src/config/toolRegistryFactory.ts (30 matches)

### Group 2: Core runtime (core/)
- Matches: 38; files: 26
  - packages/core/src/core/ChatSessionFactory.ts (1 matches)
  - packages/core/src/core/MessageStreamOrchestrator.ts (1 matches)
  - packages/core/src/core/StreamProcessor.ts (1 matches)
  - packages/core/src/core/TodoContinuationService.test.ts (2 matches)
  - packages/core/src/core/TodoContinuationService.ts (2 matches)
  - packages/core/src/core/TurnProcessor.ts (1 matches)
  - packages/core/src/core/__tests__/subagent.stateless.test.ts (1 matches)
  - packages/core/src/core/client.test.ts (1 matches)
  - packages/core/src/core/clientToolGovernance.test.ts (1 matches)
  - packages/core/src/core/clientToolGovernance.ts (1 matches)
  - packages/core/src/core/compression/utils.ts (1 matches)
  - packages/core/src/core/coreToolHookTriggers.ts (1 matches)
  - packages/core/src/core/coreToolScheduler.interactiveMode.test.ts (1 matches)
  - packages/core/src/core/coreToolScheduler.test.ts (2 matches)
  - packages/core/src/core/messageBus.core-integration.tdd.test.ts (2 matches)
  - packages/core/src/core/prompts.ts (1 matches)
  - packages/core/src/core/subagent.test.ts (3 matches)
  - packages/core/src/core/subagentOrchestrator.ts (1 matches)
  - packages/core/src/core/subagentRuntimeSetup.ts (1 matches)
  - packages/core/src/core/subagentToolProcessing.test.ts (2 matches)
  - packages/core/src/core/subagentToolProcessing.ts (3 matches)
  - packages/core/src/core/subagentTypes.ts (1 matches)
  - packages/core/src/core/toolExecutorUnification.integration.test.ts (1 matches)
  - packages/core/src/core/toolGovernance.ts (1 matches)
  - packages/core/src/core/turn.ts (3 matches)
  - packages/core/src/core/turn.undefined_issue.test.ts (2 matches)

### Group 3: Core scheduler
- Matches: 23; files: 9
  - packages/core/src/scheduler/confirmation-coordinator.test.ts (4 matches)
  - packages/core/src/scheduler/confirmation-coordinator.ts (4 matches)
  - packages/core/src/scheduler/result-aggregator.test.ts (2 matches)
  - packages/core/src/scheduler/result-aggregator.ts (2 matches)
  - packages/core/src/scheduler/tool-dispatcher.test.ts (3 matches)
  - packages/core/src/scheduler/tool-dispatcher.ts (3 matches)
  - packages/core/src/scheduler/tool-executor.ts (1 matches)
  - packages/core/src/scheduler/types.ts (2 matches)
  - packages/core/src/scheduler/utils.ts (2 matches)

### Group 4: Core agents
- Matches: 17; files: 6
  - packages/core/src/agents/executor-validation.ts (9 matches)
  - packages/core/src/agents/executor.test.ts (3 matches)
  - packages/core/src/agents/executor.ts (1 matches)
  - packages/core/src/agents/invocation.test.ts (1 matches)
  - packages/core/src/agents/invocation.ts (2 matches)
  - packages/core/src/agents/types.ts (1 matches)

### Group 5: Core confirmation-bus
- Matches: 4; files: 4
  - packages/core/src/confirmation-bus/integration.test.ts (1 matches)
  - packages/core/src/confirmation-bus/message-bus.test.ts (1 matches)
  - packages/core/src/confirmation-bus/message-bus.ts (1 matches)
  - packages/core/src/confirmation-bus/types.ts (1 matches)

### Group 6: Core telemetry
- Matches: 9; files: 6
  - packages/core/src/telemetry/loggers.test.ts (2 matches)
  - packages/core/src/telemetry/metrics.ts (1 matches)
  - packages/core/src/telemetry/tool-call-decision.test.ts (1 matches)
  - packages/core/src/telemetry/tool-call-decision.ts (1 matches)
  - packages/core/src/telemetry/types.ts (2 matches)
  - packages/core/src/telemetry/uiTelemetry.test.ts (2 matches)

### Group 7: Core prompts
- Matches: 2; files: 2
  - packages/core/src/prompts/mcp-prompts.ts (1 matches)
  - packages/core/src/prompts/prompt-registry.ts (1 matches)

### Group 8: Core storage
- Matches: 2; files: 2
  - packages/core/src/storage/SessionPersistenceService.ts (1 matches)
  - packages/core/src/storage/secure-store-integration.test.ts (1 matches)

### Group 9: Core policy
- Matches: 5; files: 3
  - packages/core/src/policy/policy-helpers.test.ts (1 matches)
  - packages/core/src/policy/policy-helpers.ts (2 matches)
  - packages/core/src/policy/policy-updater.test.ts (2 matches)

### Group 10: Core hooks
- Matches: 1; files: 1
  - packages/core/src/hooks/notification-hook.test.ts (1 matches)

### Group 11: Core runtime services
- Matches: 2; files: 2
  - packages/core/src/services/todo-reminder-service.ts (1 matches)
  - packages/core/src/services/tool-call-tracker-service.ts (1 matches)

### Group 12: Core test-utils
- Matches: 4; files: 2
  - packages/core/src/test-utils/mock-tool.ts (2 matches)
  - packages/core/src/test-utils/tools.ts (2 matches)

### Group 13: Core utils
- Matches: 14; files: 14
  - packages/core/src/utils/environmentContext.test.ts (1 matches)
  - packages/core/src/utils/events.ts (1 matches)
  - packages/core/src/utils/extensionLoader.test.ts (1 matches)
  - packages/core/src/utils/fileDiffUtils.test.ts (1 matches)
  - packages/core/src/utils/fileDiffUtils.ts (1 matches)
  - packages/core/src/utils/fileUtils.ts (1 matches)
  - packages/core/src/utils/ignorePatterns.test.ts (1 matches)
  - packages/core/src/utils/ignorePatterns.ts (1 matches)
  - packages/core/src/utils/memoryDiscovery.subfunctions.test.ts (1 matches)
  - packages/core/src/utils/memoryDiscovery.test.ts (1 matches)
  - packages/core/src/utils/memoryDiscovery.ts (1 matches)
  - packages/core/src/utils/summarizer.test.ts (1 matches)
  - packages/core/src/utils/summarizer.ts (1 matches)
  - packages/core/src/utils/tool-utils.test.ts (1 matches)

### Group 14: LSP tests and integration
- Matches: 34; files: 2
  - packages/core/src/lsp/__tests__/e2e-lsp.test.ts (17 matches)
  - packages/core/src/lsp/__tests__/system-integration.test.ts (17 matches)

### Group 16: Provider test mocks
- Matches: 9; files: 8
  - packages/providers/src/anthropic/AnthropicProvider.issue276.test.ts (1 matches)
  - packages/providers/src/anthropic/AnthropicProvider.mediaBlock.test.ts (1 matches)
  - packages/providers/src/anthropic/AnthropicProvider.test.ts (1 matches)
  - packages/providers/src/anthropic/AnthropicProvider.toolFormatDetection.test.ts (1 matches)
  - packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts (1 matches)
  - packages/providers/src/openai/OpenAIProvider.toolNameErrors.test.ts (1 matches)
  - packages/providers/src/openai/ToolCallNormalizer.test.ts (2 matches)
  - packages/providers/src/openai/__tests__/ToolNameValidator.test.ts (1 matches)

### Group 17: Provider production imports
- Matches: 36; files: 20
  - packages/providers/src/anthropic/AnthropicMessageNormalizer.ts (1 matches)
  - packages/providers/src/anthropic/AnthropicProvider.ts (1 matches)
  - packages/providers/src/anthropic/AnthropicResponseParser.ts (2 matches)
  - packages/providers/src/anthropic/AnthropicStreamProcessor.ts (2 matches)
  - packages/providers/src/openai-responses/OpenAIResponsesInputBuilder.ts (1 matches)
  - packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts (1 matches)
  - packages/providers/src/openai-responses/buildResponsesInputFromContent.ts (1 matches)
  - packages/providers/src/openai-vercel/OpenAIVercelProvider.ts (3 matches)
  - packages/providers/src/openai-vercel/messageConversion.ts (2 matches)
  - packages/providers/src/openai/OpenAINonStreamHandler.ts (2 matches)
  - packages/providers/src/openai/OpenAIProvider.ts (2 matches)
  - packages/providers/src/openai/OpenAIRequestBuilder.ts (3 matches)
  - packages/providers/src/openai/OpenAIResponseParser.ts (2 matches)
  - packages/providers/src/openai/OpenAIStreamProcessor.ts (3 matches)
  - packages/providers/src/openai/ToolCallNormalizer.ts (1 matches)
  - packages/providers/src/openai/ToolNameValidator.ts (2 matches)
  - packages/providers/src/openai/buildResponsesRequest.ts (2 matches)
  - packages/providers/src/openai/syntheticToolResponses.ts (1 matches)
  - packages/providers/src/reasoning/reasoningUtils.ts (2 matches)
  - packages/providers/src/utils/toolFormatDetection.ts (2 matches)

### Group 15: Package exports
- Exports: 6
  - ./tools/doubleEscapeUtils.js
  - ./tools/IToolFormatter.js
  - ./tools/ToolFormatter.js
  - ./tools/ToolIdStrategy.js
  - ./tools/toolNameUtils.js
  - ./tools/toolIdNormalization.js

### Group 18: Dynamic imports
- Matches: 7; files: 6
  - packages/core/src/config/lspIntegration.ts:302:  const { DiscoveredMCPTool } = await import('../tools/mcp-tool.js');
  - packages/core/src/core/subagentToolProcessing.test.ts:79:      } as unknown as import('../tools/tools.js').ToolResultDisplay;
  - packages/core/src/core/turn.undefined_issue.test.ts:233:      const { normalizeToolName } = await import('../tools/toolNameUtils.js');
  - packages/core/src/core/turn.undefined_issue.test.ts:253:        const { normalizeToolName } = await import('../tools/toolNameUtils.js');
  - packages/core/src/runtime/contracts/toolIdNormalization-contract.test.ts:146:    const mod = await import('../../tools/toolIdNormalization.js');
  - packages/core/src/scheduler/confirmation-coordinator.test.ts:23:    await importOriginal<typeof import('../tools/modifiable-tool.js')>();
  - packages/core/src/tools/__tests__/ast-edit-characterization.test.ts:596:      const { ToolConfirmationOutcome } = await import('../tools.js');

## P01 Extended Consumer Inventory Evidence

Generated artifacts:
- `analysis/current-tools-files.txt`: 150 TypeScript files.
- `analysis/current-tools-non-ts.txt`: 2 non-TypeScript tool artifacts (`.snap` files).
- `analysis/all-tool-consumers.txt`: 279 tracked TypeScript consumer matches, split into 75 production source files and 48 test files.
- `analysis/tools-to-core-imports.txt`: 206 production import matches from tools into core/config/services/etc.
- `analysis/core-tools-exports.txt`: 6 current core package deep tool exports.
- `analysis/release-baseline.txt`: 36 release-process baseline matches.

### Production vs Test Classification

- Production consumer files: 75.
- Test consumer files: 48.
- Provider production imports: 36 matches across 20 files.
- Provider test/mock imports: 9 matches across 8 files, including the 4 Anthropic `ToolFormatter` mocks plus OpenAI/OpenAI Responses tool helper test consumers.

### Tools-to-Core Production Dependency Classification

`analysis/tools-to-core-imports.txt` contains production-only imports from `packages/core/src/tools` after excluding `__tests__`, `.test.`, and `.spec.` files.

- config: 44 matches (`Config`, `ApprovalMode`, `Storage`, subagent/profile manager and config types).
- confirmation-bus: 31 matches (`MessageBus`, confirmation outcome/details/payload flow).
- services: 15 matches (`shellExecutionService`, file discovery/filesystem, git stats, todo reminder/context tracker, tool-call tracker, async tasks, history `IContent`).
- core: 8 matches (`DEFAULT_AGENT_ID`, subagent types/orchestrator/runtime helpers).
- ide: 6 matches (`ideContext`, IDE client and diff support).
- storage: 1 match (`secure-store`, provider key storage ownership).
- utils: 84 matches (schema validation, safe JSON, debug logging helpers, paths/file/unicode/errors/terminal/fetch/git/shell/editor/workspace/ignore/ripgrep/ast-grep/search/generate-content/events/retry utilities).
- mcp: 6 matches (`google-auth-provider`, OAuth provider/token storage).
- debug: 11 matches (`DebugLogger`, `debugLogger`).

### Dynamic Import Coverage

Dynamic imports are included in `analysis/all-tool-consumers.txt`. There are 7 matches across 6 files. Production dynamic import: `packages/core/src/config/lspIntegration.ts` imports `../tools/mcp-tool.js`. Remaining dynamic imports are test/type-only characterization or contract references.

### Release Impact Baseline

`analysis/release-baseline.txt` captures current release workflow/script state: core publish steps in `.github/workflows/release.yml`, release-process tests referencing providers/tools expectations, sandbox pack commands in `scripts/build_sandbox.js`, and Docker tarball install/copy baselines. No production release files were modified in P01.

### Gaps Found In P01 Analysis

- `packages/lsp` has no tracked direct `packages/core/src/tools` or `@vybestack/llxprt-code-core/tools/*` consumers. LSP-related tool consumers found for Group 14 are under `packages/core/src/lsp/__tests__/`.
- `packages/cli` and `packages/a2a-server` have no tracked direct tool deep-import matches in this inventory.
- `rg` with default ignore rules omitted tracked `packages/core/src/prompts/*` consumer files because an ignore rule affects that directory name; the final inventory was therefore generated with `git grep` over tracked TypeScript files to avoid omitting tracked source while excluding ignored `dist` outputs.
- `debug` is an additional tools-to-core dependency bucket beyond the plan's listed classification bullets and must be covered by later interface/adapter work.
- Existing provider test mocks include one additional `doubleEscapeUtils` mock beyond the four Anthropic `ToolFormatter` mocks named in the plan.
