# Batch RS-BN4 — `@typescript-eslint/no-unnecessary-condition`

## Target rule

`@typescript-eslint/no-unnecessary-condition`

Flags conditions that TypeScript can prove are always truthy or always falsy. Fixes must preserve runtime behavior: remove genuinely impossible checks, narrow types when the current type is too broad, or keep intentionally defensive runtime guards with a targeted disable and justification when external data, async races, public API boundaries, or malformed persisted state make the check meaningful despite the static type.

## Baseline (at commit `eb10f2488`)

- Warnings: 2193
- Offending files: 527
- Source lint JSON: `/tmp/issue1569d-current-lint.json`

## Split policy

- Production sub-batches are capped at 25 files.
- Test sub-batches are capped at 40 files.
- Files are sorted within each package/scope by warning count descending, then path.
- Subagents must not expand the file list during implementation. If a listed file cannot be fixed safely, stop and report the blocker.
- The coordinator promotes the rule globally only after every sub-batch reaches zero repo-wide for this rule.

## Frozen sub-batches

### BN4-A-P1 — a2a-server + vscode-ide-companion production

- Type: production
- Files: 10
- Warnings: 18

- `packages/a2a-server/src/utils/testing_utils.ts` — 6
- `packages/a2a-server/src/config/settings.ts` — 2
- `packages/vscode-ide-companion/src/extension.ts` — 2
- `packages/vscode-ide-companion/src/ide-server.ts` — 2
- `packages/a2a-server/src/agent/task-support.ts` — 1
- `packages/a2a-server/src/config/config.ts` — 1
- `packages/a2a-server/src/http/app.ts` — 1
- `packages/a2a-server/src/types.ts` — 1
- `packages/vscode-ide-companion/src/diff-manager.ts` — 1
- `packages/vscode-ide-companion/src/open-files-manager.ts` — 1

### BN4-A-T1 — a2a-server + vscode-ide-companion test

- Type: test
- Files: 5
- Warnings: 6

- `packages/a2a-server/src/http/app.test.ts` — 2
- `packages/a2a-server/src/commands/restore.test.ts` — 1
- `packages/a2a-server/src/http/endpoints.test.ts` — 1
- `packages/a2a-server/src/persistence/gcs.test.ts` — 1
- `packages/vscode-ide-companion/src/ide-server.test.ts` — 1

### BN4-C-P01 — core production

- Type: production
- Files: 25
- Warnings: 508

- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` — 54
- `packages/core/src/providers/LoggingProviderWrapper.ts` — 34
- `packages/core/src/providers/gemini/GeminiProvider.ts` — 32
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` — 30
- `packages/core/src/tools/task.ts` — 29
- `packages/core/src/providers/logging/ProviderContentExtractor.ts` — 24
- `packages/core/src/config/profileManager.ts` — 23
- `packages/core/src/services/history/HistoryService.ts` — 23
- `packages/core/src/core/StreamProcessor.ts` — 21
- `packages/core/src/core/DirectMessageProcessor.ts` — 19
- `packages/core/src/providers/ProviderManager.ts` — 18
- `packages/core/src/services/shellExecutionService.ts` — 18
- `packages/core/src/tools/shell.ts` — 18
- `packages/core/src/core/subagentRuntimeSetup.ts` — 17
- `packages/core/src/providers/openai/OpenAIStreamProcessor.ts` — 16
- `packages/core/src/tools/tool-registry.ts` — 16
- `packages/core/src/core/MessageConverter.ts` — 14
- `packages/core/src/providers/BaseProvider.ts` — 14
- `packages/core/src/providers/openai/OpenAIProvider.ts` — 14
- `packages/core/src/config/config.ts` — 13
- `packages/core/src/providers/anthropic/AnthropicRequestPreparation.ts` — 13
- `packages/core/src/providers/openai/OpenAINonStreamHandler.ts` — 12
- `packages/core/src/providers/openai/OpenAIRequestPreparation.ts` — 12
- `packages/core/src/tools/mcp-client.ts` — 12
- `packages/core/src/tools/ToolFormatter.ts` — 12

### BN4-C-P02 — core production

- Type: production
- Files: 25
- Warnings: 219

- `packages/core/src/core/MessageStreamOrchestrator.ts` — 11
- `packages/core/src/core/subagent.ts` — 11
- `packages/core/src/core/subagentToolProcessing.ts` — 11
- `packages/core/src/config/subagentManager.ts` — 10
- `packages/core/src/core/lifecycleHookTriggers.ts` — 10
- `packages/core/src/prompt-config/defaults/provider-defaults.ts` — 10
- `packages/core/src/services/history/ContentConverters.ts` — 10
- `packages/core/src/tools/todo-write.ts` — 10
- `packages/core/src/mcp/token-storage/keychain-token-storage.ts` — 9
- `packages/core/src/prompt-config/defaults/core-defaults.ts` — 9
- `packages/core/src/prompt-config/TemplateEngine.ts` — 9
- `packages/core/src/providers/anthropic/AnthropicProvider.ts` — 9
- `packages/core/src/providers/RetryOrchestrator.ts` — 9
- `packages/core/src/core/clientHelpers.ts` — 8
- `packages/core/src/core/TodoContinuationService.ts` — 8
- `packages/core/src/hooks/hookRegistry.ts` — 8
- `packages/core/src/prompt-config/defaults/tool-defaults.ts` — 8
- `packages/core/src/prompt-config/prompt-cache.ts` — 8
- `packages/core/src/recording/ReplayEngine.ts` — 8
- `packages/core/src/tools/mcp-tool.ts` — 8
- `packages/core/src/core/compression/CompressionHandler.ts` — 7
- `packages/core/src/core/geminiChat.ts` — 7
- `packages/core/src/core/TurnProcessor.ts` — 7
- `packages/core/src/providers/LoadBalancingProvider.ts` — 7
- `packages/core/src/runtime/AgentRuntimeLoader.ts` — 7

### BN4-C-P03 — core production

- Type: production
- Files: 25
- Warnings: 126

- `packages/core/src/storage/secure-store.ts` — 7
- `packages/core/src/agents/executor.ts` — 6
- `packages/core/src/config/toolRegistryFactory.ts` — 6
- `packages/core/src/core/coreToolHookTriggers.ts` — 6
- `packages/core/src/core/subagentOrchestrator.ts` — 6
- `packages/core/src/core/turn.ts` — 6
- `packages/core/src/hooks/hookEventHandler.ts` — 6
- `packages/core/src/providers/openai/toolNameUtils.ts` — 6
- `packages/core/src/runtime/createAgentRuntimeContext.ts` — 6
- `packages/core/src/settings/SettingsService.ts` — 6
- `packages/core/src/utils/googleQuotaErrors.ts` — 6
- `packages/core/src/config/lspIntegration.ts` — 5
- `packages/core/src/providers/gemini/thoughtSignatures.ts` — 5
- `packages/core/src/providers/openai-vercel/messageConversion.ts` — 5
- `packages/core/src/providers/openai/buildResponsesRequest.ts` — 5
- `packages/core/src/providers/openai/parseResponsesStream.ts` — 5
- `packages/core/src/services/loopDetectionService.ts` — 5
- `packages/core/src/hooks/types.ts` — 4
- `packages/core/src/parsers/TextToolCallParser.ts` — 4
- `packages/core/src/prompt-config/prompt-loader.ts` — 4
- `packages/core/src/providers/openai/OpenAIClientFactory.ts` — 4
- `packages/core/src/tools/write-file.ts` — 4
- `packages/core/src/auth/precedence.ts` — 3
- `packages/core/src/core/client.ts` — 3
- `packages/core/src/hooks/hookRunner.ts` — 3

### BN4-C-P04 — core production

- Type: production
- Files: 25
- Warnings: 65

- `packages/core/src/models/provider-integration.ts` — 3
- `packages/core/src/prompt-config/prompt-installer.ts` — 3
- `packages/core/src/prompt-config/prompt-service.ts` — 3
- `packages/core/src/providers/fake/FakeProvider.ts` — 3
- `packages/core/src/providers/openai/getOpenAIProviderInfo.ts` — 3
- `packages/core/src/providers/openai/OpenAIRequestBuilder.ts` — 3
- `packages/core/src/providers/utils/thinkingExtraction.ts` — 3
- `packages/core/src/tools/ast-edit/cross-file-analyzer.ts` — 3
- `packages/core/src/tools/edit.ts` — 3
- `packages/core/src/utils/filesearch/result-cache.ts` — 3
- `packages/core/src/utils/generateContentResponseUtilities.ts` — 3
- `packages/core/src/utils/ignorePatterns.ts` — 3
- `packages/core/src/utils/memoryDiscovery.ts` — 3
- `packages/core/src/utils/memoryImportProcessor.ts` — 3
- `packages/core/src/utils/shell-utils.ts` — 3
- `packages/core/src/auth/codex-device-flow.ts` — 2
- `packages/core/src/auth/proxy/proxy-token-store.ts` — 2
- `packages/core/src/config/configBase.ts` — 2
- `packages/core/src/config/configBaseCore.ts` — 2
- `packages/core/src/config/schedulerSingleton.ts` — 2
- `packages/core/src/core/bucketFailoverIntegration.ts` — 2
- `packages/core/src/core/clientToolGovernance.ts` — 2
- `packages/core/src/core/contentGenerator.ts` — 2
- `packages/core/src/core/ConversationManager.ts` — 2
- `packages/core/src/mcp/oauth-token-storage.ts` — 2

### BN4-C-P05 — core production

- Type: production
- Files: 25
- Warnings: 50

- `packages/core/src/mcp/token-storage/file-token-storage.ts` — 2
- `packages/core/src/policy/policy-engine.ts` — 2
- `packages/core/src/prompt-config/prompt-resolver.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicApiExecution.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicMessageNormalizer.ts` — 2
- `packages/core/src/providers/errors.ts` — 2
- `packages/core/src/providers/openai-responses/buildResponsesInputFromContent.ts` — 2
- `packages/core/src/providers/openai/OpenAIApiExecution.ts` — 2
- `packages/core/src/providers/ProviderContentGenerator.ts` — 2
- `packages/core/src/services/environmentSanitization.ts` — 2
- `packages/core/src/services/history/IContent.ts` — 2
- `packages/core/src/settings/settingsRegistry.ts` — 2
- `packages/core/src/skills/skillLoader.ts` — 2
- `packages/core/src/telemetry/types.ts` — 2
- `packages/core/src/telemetry/uiTelemetry.ts` — 2
- `packages/core/src/tools/ast-edit/ast-edit-invocation.ts` — 2
- `packages/core/src/tools/codesearch.ts` — 2
- `packages/core/src/tools/exa-web-search.ts` — 2
- `packages/core/src/tools/grep.ts` — 2
- `packages/core/src/tools/ls.ts` — 2
- `packages/core/src/tools/mcp-client-manager.ts` — 2
- `packages/core/src/tools/modifiable-tool.ts` — 2
- `packages/core/src/tools/structural-analysis.ts` — 2
- `packages/core/src/utils/ast-grep-utils.ts` — 2
- `packages/core/src/utils/bfsFileSearch.ts` — 2

### BN4-C-P06 — core production

- Type: production
- Files: 25
- Warnings: 31

- `packages/core/src/utils/fileUtils.ts` — 2
- `packages/core/src/utils/gitUtils.ts` — 2
- `packages/core/src/utils/googleErrors.ts` — 2
- `packages/core/src/utils/parameterCoercion.ts` — 2
- `packages/core/src/utils/retry.ts` — 2
- `packages/core/src/utils/shell-parser.ts` — 2
- `packages/core/src/auth/proxy/proxy-socket-client.ts` — 1
- `packages/core/src/auth/qwen-device-flow.ts` — 1
- `packages/core/src/code_assist/converter.ts` — 1
- `packages/core/src/config/configConstructor.ts` — 1
- `packages/core/src/config/configTypes.ts` — 1
- `packages/core/src/core/ChatSessionFactory.ts` — 1
- `packages/core/src/core/compression/compressionBudgeting.ts` — 1
- `packages/core/src/core/compression/HighDensityStrategy.ts` — 1
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — 1
- `packages/core/src/core/compression/OneShotStrategy.ts` — 1
- `packages/core/src/core/compression/types.ts` — 1
- `packages/core/src/core/compression/utils.ts` — 1
- `packages/core/src/core/coreToolScheduler.ts` — 1
- `packages/core/src/core/logger.ts` — 1
- `packages/core/src/core/prompts.ts` — 1
- `packages/core/src/debug/MockConfigurationManager.ts` — 1
- `packages/core/src/debug/MockFileOutput.ts` — 1
- `packages/core/src/hooks/trustedHooks.ts` — 1
- `packages/core/src/ide/ide-client.ts` — 1

### BN4-C-P07 — core production

- Type: production
- Files: 25
- Warnings: 25

- `packages/core/src/ide/ide-installer.ts` — 1
- `packages/core/src/ide/process-utils.ts` — 1
- `packages/core/src/mcp/file-token-store.ts` — 1
- `packages/core/src/mcp/google-auth-provider.ts` — 1
- `packages/core/src/mcp/oauth-provider.ts` — 1
- `packages/core/src/mcp/token-storage/base-token-storage.ts` — 1
- `packages/core/src/models/registry.ts` — 1
- `packages/core/src/policy/toml-loader.ts` — 1
- `packages/core/src/prompts/mcp-prompts.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicRateLimitHandler.ts` — 1
- `packages/core/src/providers/anthropic/schemaConverter.ts` — 1
- `packages/core/src/providers/openai-responses/schemaConverter.ts` — 1
- `packages/core/src/providers/openai-vercel/errors.ts` — 1
- `packages/core/src/providers/openai/schemaConverter.ts` — 1
- `packages/core/src/providers/openai/ToolCallNormalizer.ts` — 1
- `packages/core/src/providers/utils/authToken.ts` — 1
- `packages/core/src/providers/utils/dumpContext.ts` — 1
- `packages/core/src/providers/utils/mediaUtils.ts` — 1
- `packages/core/src/providers/utils/toolResponsePayload.ts` — 1
- `packages/core/src/recording/SessionLockManager.ts` — 1
- `packages/core/src/runtime/runtimeAdapters.ts` — 1
- `packages/core/src/runtime/runtimeStateFactory.ts` — 1
- `packages/core/src/scheduler/confirmation-coordinator.ts` — 1
- `packages/core/src/scheduler/result-aggregator.ts` — 1
- `packages/core/src/services/asyncTaskReminderService.ts` — 1

### BN4-C-P08 — core production

- Type: production
- Files: 21
- Warnings: 21

- `packages/core/src/skills/skillManager.ts` — 1
- `packages/core/src/storage/SessionPersistenceService.ts` — 1
- `packages/core/src/test-utils/providerCallOptions.ts` — 1
- `packages/core/src/todo/todoFormatter.ts` — 1
- `packages/core/src/tools/ast-edit/context-collector.ts` — 1
- `packages/core/src/tools/ast-edit/edit-helpers.ts` — 1
- `packages/core/src/tools/ast-edit/local-context-analyzer.ts` — 1
- `packages/core/src/tools/ast-grep.ts` — 1
- `packages/core/src/tools/fuzzy-replacer.ts` — 1
- `packages/core/src/tools/glob.ts` — 1
- `packages/core/src/tools/google-web-fetch.ts` — 1
- `packages/core/src/tools/google-web-search-invocation.ts` — 1
- `packages/core/src/tools/read-many-files.ts` — 1
- `packages/core/src/tools/ripGrep.ts` — 1
- `packages/core/src/tools/ToolIdStrategy.ts` — 1
- `packages/core/src/utils/errors.ts` — 1
- `packages/core/src/utils/filesearch/crawler.ts` — 1
- `packages/core/src/utils/filesearch/fileSearch.ts` — 1
- `packages/core/src/utils/partUtils.ts` — 1
- `packages/core/src/utils/quotaErrorDetection.ts` — 1
- `packages/core/src/utils/tool-utils.ts` — 1

### BN4-C-T01 — core test

- Type: test
- Files: 40
- Warnings: 226

- `packages/core/src/core/geminiChat.tokenSync.test.ts` — 22
- `packages/core/src/providers/gemini/__tests__/gemini.thoughtSignature.test.ts` — 13
- `packages/core/src/providers/integration/multi-provider.integration.test.ts` — 12
- `packages/core/src/config/onAuthErrorHandler.test.ts` — 11
- `packages/core/src/core/client.test.ts` — 11
- `packages/core/src/core/coreToolScheduler.test.ts` — 11
- `packages/core/src/providers/gemini/__tests__/gemini.thinkingLevel.test.ts` — 11
- `packages/core/src/core/__tests__/geminiChat.runtimeState.test.ts` — 9
- `packages/core/src/core/geminiChat.thinkingHistory.test.ts` — 9
- `packages/core/src/hooks/hooks-caller-application.test.ts` — 8
- `packages/core/src/providers/anthropic/AnthropicProvider.test.ts` — 8
- `packages/core/src/core/subagent.test.ts` — 6
- `packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts` — 6
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.toolIdNormalization.test.ts` — 6
- `packages/core/src/providers/openai/ToolCallPipeline.toolCallId.test.ts` — 6
- `packages/core/src/tools/tool-registry.test.ts` — 6
- `packages/core/src/core/geminiChat.issue1150.integration.test.ts` — 5
- `packages/core/src/services/history/HistoryService.test.ts` — 5
- `packages/core/src/tools/write-file.test.ts` — 5
- `packages/core/src/core/compression/__tests__/compression-retry.test.ts` — 4
- `packages/core/src/core/geminiChat.contextlimit.test.ts` — 4
- `packages/core/src/core/geminiChat.thinking-toolcalls.test.ts` — 4
- `packages/core/src/providers/openai/OpenAIProvider.emptyResponseRetry.test.ts` — 4
- `packages/core/src/config/profileManager.test.ts` — 3
- `packages/core/src/core/__tests__/geminiClient.runtimeState.test.ts` — 3
- `packages/core/src/core/coreToolScheduler.cancellation.test.ts` — 3
- `packages/core/src/core/coreToolScheduler.duplication.test.ts` — 3
- `packages/core/src/core/subagentOrchestrator.test.ts` — 3
- `packages/core/src/providers/anthropic/AnthropicProvider.thinking.test.ts` — 3
- `packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts` — 2
- `packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` — 2
- `packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts` — 2
- `packages/core/src/core/compression/__tests__/compression-recency.test.ts` — 2
- `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts` — 2
- `packages/core/src/core/geminiChat.hook-control.test.ts` — 2
- `packages/core/src/core/geminiChat.runtime.test.ts` — 2
- `packages/core/src/hooks/hookRegistry.test.ts` — 2
- `packages/core/src/integration-tests/profile-integration.test.ts` — 2
- `packages/core/src/providers/__tests__/baseProvider.stateless.test.ts` — 2
- `packages/core/src/providers/__tests__/LoadBalancingProvider.circuitbreaker.test.ts` — 2

### BN4-C-T02 — core test

- Type: test
- Files: 39
- Warnings: 47

- `packages/core/src/providers/BaseProvider.test.ts` — 2
- `packages/core/src/providers/gemini/__tests__/gemini.stateless.test.ts` — 2
- `packages/core/src/providers/openai-responses/__tests__/openaiResponses.stateless.test.ts` — 2
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.reasoningInclude.test.ts` — 2
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` — 2
- `packages/core/src/providers/openai/parseResponsesStream.responsesToolCalls.test.ts` — 2
- `packages/core/src/recording/integration.test.ts` — 2
- `packages/core/src/tools/grep.timeout.test.ts` — 2
- `packages/core/src/auth/__tests__/authRuntimeScope.test.ts` — 1
- `packages/core/src/auth/__tests__/codex-device-flow.test.ts` — 1
- `packages/core/src/auth/auth-integration.spec.ts` — 1
- `packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts` — 1
- `packages/core/src/auth/qwen-device-flow.spec.ts` — 1
- `packages/core/src/commands/types.test.ts` — 1
- `packages/core/src/core/__tests__/geminiChat-density.test.ts` — 1
- `packages/core/src/core/__tests__/sandwich-compression.test.ts` — 1
- `packages/core/src/core/compression/MiddleOutStrategy.test.ts` — 1
- `packages/core/src/core/geminiChat.thinking-spacing.test.ts` — 1
- `packages/core/src/core/logger.test.ts` — 1
- `packages/core/src/core/nonInteractiveToolExecutor.test.ts` — 1
- `packages/core/src/core/StreamProcessor.retryBoundary.test.ts` — 1
- `packages/core/src/core/StreamProcessor.yieldAsYouGo.test.ts` — 1
- `packages/core/src/core/turn.test.ts` — 1
- `packages/core/src/debug/FileOutput.test.ts` — 1
- `packages/core/src/mcp/oauth-token-storage.test.ts` — 1
- `packages/core/src/providers/__tests__/ProviderManager.settingsSeparation.test.ts` — 1
- `packages/core/src/providers/__tests__/RetryOrchestrator.onAuthError.test.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicProvider.issue1150.shape.test.ts` — 1
- `packages/core/src/providers/gemini/GeminiProvider.test.ts` — 1
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.ephemerals.toolOutput.test.ts` — 1
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` — 1
- `packages/core/src/providers/openai/OpenAIProvider.deepseekReasoning.test.ts` — 1
- `packages/core/src/providers/openai/OpenAIProvider.integration.test.ts` — 1
- `packages/core/src/providers/openai/OpenAIProvider.modelParamsAndHeaders.test.ts` — 1
- `packages/core/src/recording/SessionRecordingService.test.ts` — 1
- `packages/core/src/tools/ast-grep.test.ts` — 1
- `packages/core/src/tools/edit.test.ts` — 1
- `packages/core/src/tools/task.test.ts` — 1
- `packages/core/src/utils/asyncIterator.test.ts` — 1

### BN4-L-P01 — cli production

- Type: production
- Files: 25
- Warnings: 294

- `packages/cli/src/ui/components/SettingsDialog.tsx` — 38
- `packages/cli/src/runtime/profileApplication.ts` — 23
- `packages/cli/src/ui/commands/mcpCommand.ts` — 18
- `packages/cli/src/nonInteractiveCli.ts` — 14
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` — 14
- `packages/cli/src/ui/commands/profileCommand.ts` — 14
- `packages/cli/src/ui/hooks/useAtCompletion.ts` — 13
- `packages/cli/src/runtime/profileSnapshot.ts` — 12
- `packages/cli/src/providers/logging/git-stats.ts` — 11
- `packages/cli/src/ui/commands/aboutCommand.ts` — 11
- `packages/cli/src/ui/contexts/KeypressContext.tsx` — 11
- `packages/cli/src/zed-integration/zedIntegration.ts` — 11
- `packages/cli/src/utils/sandbox.ts` — 10
- `packages/cli/src/providers/providerManagerInstance.ts` — 9
- `packages/cli/src/ui/commands/schema/index.ts` — 9
- `packages/cli/src/ui/hooks/geminiStream/useGeminiStream.ts` — 9
- `packages/cli/src/utils/settingsUtils.ts` — 9
- `packages/cli/src/gemini.tsx` — 8
- `packages/cli/src/ui/commands/statsCommand.ts` — 8
- `packages/cli/src/ui/hooks/useSessionBrowser.ts` — 8
- `packages/cli/src/runtime/runtimeContextFactory.ts` — 7
- `packages/cli/src/services/McpPromptLoader.ts` — 7
- `packages/cli/src/ui/commands/providerCommand.ts` — 7
- `packages/cli/src/ui/hooks/geminiStream/streamUtils.ts` — 7
- `packages/cli/src/config/settings.ts` — 6

### BN4-L-P02 — cli production

- Type: production
- Files: 25
- Warnings: 130

- `packages/cli/src/extensions/extensionAutoUpdater.ts` — 6
- `packages/cli/src/providers/oauth-provider-registration.ts` — 6
- `packages/cli/src/services/todo-continuation/todoContinuationService.ts` — 6
- `packages/cli/src/ui/commands/loggingCommand.ts` — 6
- `packages/cli/src/ui/components/DialogManager.tsx` — 6
- `packages/cli/src/ui/components/SubagentManagement/SubagentManagerDialog.tsx` — 6
- `packages/cli/src/ui/containers/AppContainer/hooks/useTokenMetricsTracking.ts` — 6
- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts` — 6
- `packages/cli/src/ui/hooks/useMouseSelection.ts` — 6
- `packages/cli/src/ui/hooks/useWelcomeOnboarding.ts` — 6
- `packages/cli/src/ui/utils/CodeColorizer.tsx` — 6
- `packages/cli/src/config/extensions/github.ts` — 5
- `packages/cli/src/config/sandboxConfig.ts` — 5
- `packages/cli/src/runtime/providerSwitch.ts` — 5
- `packages/cli/src/ui/components/SessionBrowserDialog.tsx` — 5
- `packages/cli/src/ui/hooks/geminiStream/toolCompletionHandler.ts` — 5
- `packages/cli/src/ui/hooks/useSlashCompletion.tsx` — 5
- `packages/cli/src/ui/utils/MarkdownDisplay.tsx` — 5
- `packages/cli/src/utils/dynamicSettings.ts` — 5
- `packages/cli/src/auth/proxy/credential-proxy-server.ts` — 4
- `packages/cli/src/auth/token-bucket-failover-helper.ts` — 4
- `packages/cli/src/config/extensions/extensionEnablement.ts` — 4
- `packages/cli/src/runtime/runtimeAccessors.ts` — 4
- `packages/cli/src/ui/containers/AppContainer/hooks/useModelTracking.ts` — 4
- `packages/cli/src/ui/contexts/SessionContext.tsx` — 4

### BN4-L-P03 — cli production

- Type: production
- Files: 25
- Warnings: 83

- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` — 4
- `packages/cli/src/ui/hooks/useFocus.ts` — 4
- `packages/cli/src/ui/hooks/useProfileManagement.ts` — 4
- `packages/cli/src/ui/hooks/useTerminalSize.ts` — 4
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` — 4
- `packages/cli/src/ui/utils/commandUtils.ts` — 4
- `packages/cli/src/ui/utils/fuzzyFilter.ts` — 4
- `packages/cli/src/validateNonInterActiveAuth.ts` — 4
- `packages/cli/src/auth/codex-oauth-provider.ts` — 3
- `packages/cli/src/commands/mcp/add.ts` — 3
- `packages/cli/src/config/cliArgParser.ts` — 3
- `packages/cli/src/config/extension.ts` — 3
- `packages/cli/src/runtime/runtimeLifecycle.ts` — 3
- `packages/cli/src/ui/commands/bugCommand.ts` — 3
- `packages/cli/src/ui/commands/chatCommand.ts` — 3
- `packages/cli/src/ui/commands/keyfileCommand.ts` — 3
- `packages/cli/src/ui/commands/setupGithubCommand.ts` — 3
- `packages/cli/src/ui/commands/tasksCommand.ts` — 3
- `packages/cli/src/ui/components/InputPrompt.tsx` — 3
- `packages/cli/src/ui/components/shared/MaxSizedBox.tsx` — 3
- `packages/cli/src/ui/contexts/ScrollProvider.tsx` — 3
- `packages/cli/src/ui/hooks/useReactToolScheduler.ts` — 3
- `packages/cli/src/ui/hooks/useToolsDialog.ts` — 3
- `packages/cli/src/ui/IdeIntegrationNudge.tsx` — 3
- `packages/cli/src/ui/utils/autoPromptGenerator.ts` — 3

### BN4-L-P04 — cli production

- Type: production
- Files: 25
- Warnings: 53

- `packages/cli/src/ui/utils/clipboardUtils.ts` — 3
- `packages/cli/src/ui/utils/highlight.ts` — 3
- `packages/cli/src/utils/sessionUtils.ts` — 3
- `packages/cli/src/auth/gemini-oauth-provider.ts` — 2
- `packages/cli/src/auth/token-access-coordinator.ts` — 2
- `packages/cli/src/config/extensions/settingsStorage.ts` — 2
- `packages/cli/src/config/postConfigRuntime.ts` — 2
- `packages/cli/src/config/profileResolution.ts` — 2
- `packages/cli/src/services/BuiltinCommandLoader.ts` — 2
- `packages/cli/src/ui/commands/baseurlCommand.ts` — 2
- `packages/cli/src/ui/commands/copyCommand.ts` — 2
- `packages/cli/src/ui/commands/keyCommand.ts` — 2
- `packages/cli/src/ui/commands/restoreCommand.ts` — 2
- `packages/cli/src/ui/commands/setCommand.ts` — 2
- `packages/cli/src/ui/commands/skillsCommand.ts` — 2
- `packages/cli/src/ui/components/LBStatsDisplay.tsx` — 2
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` — 2
- `packages/cli/src/ui/components/ProfileCreateWizard/AdvancedParamsStep.tsx` — 2
- `packages/cli/src/ui/components/ProfileDetailDialog.tsx` — 2
- `packages/cli/src/ui/components/ProviderDialog.tsx` — 2
- `packages/cli/src/ui/components/shared/buffer-reducer.ts` — 2
- `packages/cli/src/ui/components/shared/text-buffer.ts` — 2
- `packages/cli/src/ui/components/shared/transformations.ts` — 2
- `packages/cli/src/ui/components/shared/VirtualizedList.tsx` — 2
- `packages/cli/src/ui/components/StatsDisplay.tsx` — 2

### BN4-L-P05 — cli production

- Type: production
- Files: 25
- Warnings: 38

- `packages/cli/src/ui/components/TodoPanel.tsx` — 2
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` — 2
- `packages/cli/src/ui/containers/AppContainer/hooks/useSessionInitialization.ts` — 2
- `packages/cli/src/ui/contexts/RuntimeContext.tsx` — 2
- `packages/cli/src/ui/hooks/geminiStream/checkpointPersistence.ts` — 2
- `packages/cli/src/ui/hooks/toolMapping.ts` — 2
- `packages/cli/src/ui/hooks/useLoadProfileDialog.ts` — 2
- `packages/cli/src/ui/hooks/vim.ts` — 2
- `packages/cli/src/ui/privacy/PrivacyNotice.tsx` — 2
- `packages/cli/src/ui/themes/theme-manager.ts` — 2
- `packages/cli/src/ui/themes/theme.ts` — 2
- `packages/cli/src/utils/envVarResolver.ts` — 2
- `packages/cli/src/utils/privacy/ConversationDataRedactor.ts` — 2
- `packages/cli/src/auth/anthropic-oauth-provider.ts` — 1
- `packages/cli/src/auth/auth-flow-orchestrator.ts` — 1
- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts` — 1
- `packages/cli/src/auth/oauth-manager.ts` — 1
- `packages/cli/src/auth/provider-registry.ts` — 1
- `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts` — 1
- `packages/cli/src/auth/qwen-oauth-provider.ts` — 1
- `packages/cli/src/commands/mcp/list.ts` — 1
- `packages/cli/src/commands/mcp/remove.ts` — 1
- `packages/cli/src/config/approvalModeResolver.ts` — 1
- `packages/cli/src/config/environmentLoader.ts` — 1
- `packages/cli/src/config/extensions/settingsIntegration.ts` — 1

### BN4-L-P06 — cli production

- Type: production
- Files: 25
- Warnings: 25

- `packages/cli/src/config/extensions/settingsPrompt.ts` — 1
- `packages/cli/src/config/extensions/update.ts` — 1
- `packages/cli/src/config/mcpServerConfig.ts` — 1
- `packages/cli/src/config/profileBootstrap.ts` — 1
- `packages/cli/src/config/providerModelResolver.ts` — 1
- `packages/cli/src/config/settings-validation.ts` — 1
- `packages/cli/src/config/trustedFolders.ts` — 1
- `packages/cli/src/providers/providerAliases.ts` — 1
- `packages/cli/src/runtime/providerMutations.ts` — 1
- `packages/cli/src/runtime/runtimeRegistry.ts` — 1
- `packages/cli/src/services/FileCommandLoader.ts` — 1
- `packages/cli/src/services/performResume.ts` — 1
- `packages/cli/src/test-utils/async.ts` — 1
- `packages/cli/src/ui/commands/compressCommand.ts` — 1
- `packages/cli/src/ui/commands/directoryCommand.tsx` — 1
- `packages/cli/src/ui/commands/dumpcontextCommand.ts` — 1
- `packages/cli/src/ui/commands/ideCommand.ts` — 1
- `packages/cli/src/ui/commands/logoutCommand.ts` — 1
- `packages/cli/src/ui/commands/todoCommand.ts` — 1
- `packages/cli/src/ui/commands/toolformatCommand.ts` — 1
- `packages/cli/src/ui/commands/toolsCommand.ts` — 1
- `packages/cli/src/ui/components/AboutBox.tsx` — 1
- `packages/cli/src/ui/components/AuthDialog.tsx` — 1
- `packages/cli/src/ui/components/CacheStatsDisplay.tsx` — 1
- `packages/cli/src/ui/components/Footer.tsx` — 1

### BN4-L-P07 — cli production

- Type: production
- Files: 25
- Warnings: 25

- `packages/cli/src/ui/components/LoggingDialog.tsx` — 1
- `packages/cli/src/ui/components/messages/ToolMessage.tsx` — 1
- `packages/cli/src/ui/components/ModelDialog.tsx` — 1
- `packages/cli/src/ui/components/Notifications.tsx` — 1
- `packages/cli/src/ui/components/ProfileCreateWizard/AuthenticationStep.tsx` — 1
- `packages/cli/src/ui/components/shared/visual-layout.ts` — 1
- `packages/cli/src/ui/components/SubagentManagement/ProfileAttachmentWizard.tsx` — 1
- `packages/cli/src/ui/components/SubagentManagement/SubagentEditForm.tsx` — 1
- `packages/cli/src/ui/components/SubagentManagement/SubagentListMenu.tsx` — 1
- `packages/cli/src/ui/components/SubagentManagement/SubagentShowView.tsx` — 1
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx` — 1
- `packages/cli/src/ui/components/ThemeDialog.tsx` — 1
- `packages/cli/src/ui/containers/AppContainer/hooks/useInputHandling.ts` — 1
- `packages/cli/src/ui/containers/AppContainer/hooks/useShellFocusAutoReset.ts` — 1
- `packages/cli/src/ui/containers/SessionController.tsx` — 1
- `packages/cli/src/ui/hooks/atCommandProcessor.ts` — 1
- `packages/cli/src/ui/hooks/useConsoleMessages.ts` — 1
- `packages/cli/src/ui/hooks/useExtensionUpdates.ts` — 1
- `packages/cli/src/ui/hooks/useFolderTrust.ts` — 1
- `packages/cli/src/ui/hooks/useHistoryManager.ts` — 1
- `packages/cli/src/ui/hooks/useInputHistoryStore.ts` — 1
- `packages/cli/src/ui/hooks/usePrivacySettings.ts` — 1
- `packages/cli/src/ui/hooks/usePromptCompletion.ts` — 1
- `packages/cli/src/ui/hooks/useSelectionList.ts` — 1
- `packages/cli/src/ui/utils/renderLoopDetector.ts` — 1

### BN4-L-P08 — cli production

- Type: production
- Files: 7
- Warnings: 7

- `packages/cli/src/ui/utils/terminalCapabilityManager.ts` — 1
- `packages/cli/src/ui/utils/terminalContract.ts` — 1
- `packages/cli/src/ui/utils/updateCheck.ts` — 1
- `packages/cli/src/utils/bootstrap.ts` — 1
- `packages/cli/src/utils/cleanup.ts` — 1
- `packages/cli/src/utils/commentJson.ts` — 1
- `packages/cli/src/utils/installationInfo.ts` — 1

### BN4-L-T01 — cli test

- Type: test
- Files: 40
- Warnings: 181

- `packages/cli/src/auth/BucketFailoverHandlerImpl.spec.ts` — 30
- `packages/cli/src/config/settingsSchema.test.ts` — 21
- `packages/cli/src/ui/commands/chatCommand.test.ts` — 20
- `packages/cli/src/ui/components/shared/RadioButtonSelect.test.tsx` — 11
- `packages/cli/src/ui/AppContainer.oauth-dismiss.test.ts` — 10
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts` — 10
- `packages/cli/src/config/config.test.ts` — 7
- `packages/cli/src/ui/commands/profileCommand.test.ts` — 6
- `packages/cli/src/coreToolToggle.test.ts` — 4
- `packages/cli/src/ui/commands/__tests__/continueCommand.spec.ts` — 4
- `packages/cli/src/ui/commands/schema/deepPathCompletion.test.ts` — 4
- `packages/cli/src/auth/qwen-oauth-provider.test.ts` — 3
- `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` — 3
- `packages/cli/src/ui/__tests__/integrationWiring.spec.tsx` — 3
- `packages/cli/src/ui/components/shared/buffer-types.test.ts` — 3
- `packages/cli/src/utils/relaunch.test.ts` — 3
- `packages/cli/src/auth/__tests__/auth-status-service.spec.ts` — 2
- `packages/cli/src/auth/proxy/__tests__/credential-proxy-server.test.ts` — 2
- `packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts` — 2
- `packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts` — 2
- `packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts` — 2
- `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts` — 2
- `packages/cli/src/config/extensions/github.test.ts` — 2
- `packages/cli/src/config/keyBindings.test.ts` — 2
- `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts` — 2
- `packages/cli/src/runtime/anthropic-oauth-defaults.test.ts` — 2
- `packages/cli/src/runtime/provider-alias-defaults.test.ts` — 2
- `packages/cli/src/ui/commands/test/setCommand.phase09.test.ts` — 2
- `packages/cli/src/ui/components/messages/ToolGroupMessage.test.tsx` — 2
- `packages/cli/src/ui/hooks/__tests__/useSlashCompletion.set.phase09.test.ts` — 2
- `packages/cli/src/utils/stdinErrorHandler.test.ts` — 2
- `packages/cli/src/__tests__/sessionBrowserE2E.spec.ts` — 1
- `packages/cli/src/auth/__tests__/behavioral/error-edge-cases.behavioral.spec.ts` — 1
- `packages/cli/src/auth/__tests__/multi-bucket-auth.spec.ts` — 1
- `packages/cli/src/auth/__tests__/oauth-manager.issue913.spec.ts` — 1
- `packages/cli/src/auth/oauth-manager.spec.ts` — 1
- `packages/cli/src/auth/proxy/__tests__/platform-uds-probe.test.ts` — 1
- `packages/cli/src/config/__tests__/mcpFilteringParity.test.ts` — 1
- `packages/cli/src/integration-tests/provider-multi-runtime.integration.test.ts` — 1
- `packages/cli/src/integration-tests/tools-governance.integration.test.ts` — 1

### BN4-L-T02 — cli test

- Type: test
- Files: 15
- Warnings: 15

- `packages/cli/src/providers/logging/LoggingProviderWrapper.test.ts` — 1
- `packages/cli/src/providers/providerAliases.staticModels.test.ts` — 1
- `packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts` — 1
- `packages/cli/src/runtime/agentRuntimeAdapter.spec.ts` — 1
- `packages/cli/src/services/FileCommandLoader.test.ts` — 1
- `packages/cli/src/settings/ephemeralSettings.reasoningSummary.test.ts` — 1
- `packages/cli/src/ui/__tests__/AppContainer.keybindings.test.tsx` — 1
- `packages/cli/src/ui/App.test.tsx` — 1
- `packages/cli/src/ui/commands/__tests__/profileCommand.failover.test.ts` — 1
- `packages/cli/src/ui/commands/__tests__/profileCommand.lb.test.ts` — 1
- `packages/cli/src/ui/commands/initCommand.test.ts` — 1
- `packages/cli/src/ui/containers/SessionController.test.tsx` — 1
- `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts` — 1
- `packages/cli/src/ui/hooks/useMouseClick.test.ts` — 1
- `packages/cli/src/utils/userStartupWarnings.test.ts` — 1

## Validation

- Total files covered: 527
- Total warnings covered: 2193
- Duplicate files: 0
- Missing files: 0
- Max production batch size: 25
- Max test batch size: 40

## Recommended start

Start with `BN4-A-P1` because it is the smallest low-risk production scope (small packages, 10 files, 18 warnings).

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx` reports 0 warnings for `@typescript-eslint/no-unnecessary-condition` in each completed sub-batch.
- Full-repo `npm run lint` reports 0 errors and eventually 0 warnings for this rule after all sub-batches.
- Full verification suite green for each committed sub-batch.

