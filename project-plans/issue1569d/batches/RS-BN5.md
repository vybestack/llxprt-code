# Batch RS-BN5 — `@typescript-eslint/strict-boolean-expressions`

## Target rule

`@typescript-eslint/strict-boolean-expressions`

Flags nullable, object, number, and other non-boolean values used directly in boolean contexts. Fixes must preserve runtime behavior by making intent explicit: compare nullable values to `null`/`undefined`, compare numeric values explicitly, use string checks intentionally according to the configured allowances, or keep defensive boundary checks with a targeted disable and justification when external/runtime data can violate static types.

## Baseline (current issue1569d state)

- Warnings: 1502
- Offending files: 442
- Source lint JSON files: `/tmp/bn5-packages/a2a-server.json`, `/tmp/bn5-packages/vscode-ide-companion.json`, `/tmp/bn5-packages/core.json`, `/tmp/bn5-packages/cli.json` (captured by package path with slash-derived temp names)

## Split policy

- Production sub-batches are capped at 25 files.
- Test sub-batches are capped at 40 files.
- Files are sorted within each package/scope by warning count descending, then path.
- Subagents must not expand the file list during implementation. If a listed file cannot be fixed safely, stop and report the blocker.
- The coordinator promotes the rule globally only after every sub-batch reaches zero repo-wide for this rule.

## Frozen sub-batches

### BN5-A-P01 — a2a-server + vscode-ide-companion production

- Type: production
- Files: 8
- Warnings: 20

- `packages/a2a-server/src/agent/task-support.ts` — 5
- `packages/a2a-server/src/http/app.ts` — 5
- `packages/a2a-server/src/utils/testing_utils.ts` — 2
- `packages/vscode-ide-companion/src/extension.ts` — 2
- `packages/vscode-ide-companion/src/ide-server.ts` — 2
- `packages/vscode-ide-companion/src/open-files-manager.ts` — 2
- `packages/a2a-server/src/config/extension.ts` — 1
- `packages/vscode-ide-companion/src/utils/logger.ts` — 1

### BN5-A-T01 — a2a-server + vscode-ide-companion test

- Type: test
- Files: 1
- Warnings: 1

- `packages/a2a-server/src/persistence/gcs.test.ts` — 1

### BN5-C-P01 — core production

- Type: production
- Files: 25
- Warnings: 408

- `packages/core/src/providers/LoggingProviderWrapper.ts` — 54
- `packages/core/src/providers/ProviderManager.ts` — 30
- `packages/core/src/prompt-config/prompt-installer.ts` — 25
- `packages/core/src/core/StreamProcessor.ts` — 22
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` — 20
- `packages/core/src/providers/openai/OpenAIStreamProcessor.ts` — 19
- `packages/core/src/services/shellExecutionService.ts` — 19
- `packages/core/src/providers/logging/ProviderContentExtractor.ts` — 18
- `packages/core/src/tools/shell.ts` — 16
- `packages/core/src/tools/ToolFormatter.ts` — 16
- `packages/core/src/providers/gemini/GeminiProvider.ts` — 15
- `packages/core/src/services/history/HistoryService.ts` — 15
- `packages/core/src/utils/retry.ts` — 15
- `packages/core/src/providers/LoadBalancingProvider.ts` — 13
- `packages/core/src/core/DirectMessageProcessor.ts` — 12
- `packages/core/src/providers/openai/OpenAINonStreamHandler.ts` — 11
- `packages/core/src/tools/read-file.ts` — 11
- `packages/core/src/config/profileManager.ts` — 10
- `packages/core/src/core/TurnProcessor.ts` — 10
- `packages/core/src/providers/RetryOrchestrator.ts` — 10
- `packages/core/src/services/history/ContentConverters.ts` — 10
- `packages/core/src/utils/getFolderStructure.ts` — 10
- `packages/core/src/auth/precedence.ts` — 9
- `packages/core/src/core/MessageStreamOrchestrator.ts` — 9
- `packages/core/src/providers/utils/retryStrategy.ts` — 9

### BN5-C-P02 — core production

- Type: production
- Files: 25
- Warnings: 169

- `packages/core/src/core/MessageConverter.ts` — 8
- `packages/core/src/policy/stable-stringify.ts` — 8
- `packages/core/src/providers/anthropic/AnthropicStreamProcessor.ts` — 8
- `packages/core/src/providers/BaseProvider.ts` — 8
- `packages/core/src/tools/mcp-client.ts` — 8
- `packages/core/src/tools/read_line_range.ts` — 8
- `packages/core/src/tools/tool-registry.ts` — 8
- `packages/core/src/config/config.ts` — 7
- `packages/core/src/hooks/hookRegistry.ts` — 7
- `packages/core/src/providers/anthropic/schemaConverter.ts` — 7
- `packages/core/src/providers/gemini/thoughtSignatures.ts` — 7
- `packages/core/src/providers/utils/toolResponsePayload.ts` — 7
- `packages/core/src/settings/SettingsService.ts` — 7
- `packages/core/src/tools/ast-edit/ast-edit-invocation.ts` — 7
- `packages/core/src/agents/executor.ts` — 6
- `packages/core/src/core/clientHelpers.ts` — 6
- `packages/core/src/providers/openai-responses/OpenAIResponsesProvider.ts` — 6
- `packages/core/src/providers/openai-responses/schemaConverter.ts` — 6
- `packages/core/src/providers/openai-vercel/schemaConverter.ts` — 6
- `packages/core/src/providers/openai/schemaConverter.ts` — 6
- `packages/core/src/providers/utils/cacheMetricsExtractor.ts` — 6
- `packages/core/src/utils/googleErrors.ts` — 6
- `packages/core/src/utils/schemaValidator.ts` — 6
- `packages/core/src/config/configConstructor.ts` — 5
- `packages/core/src/config/toolRegistryFactory.ts` — 5

### BN5-C-P03 — core production

- Type: production
- Files: 25
- Warnings: 108

- `packages/core/src/hooks/hookRunner.ts` — 5
- `packages/core/src/mcp/file-token-store.ts` — 5
- `packages/core/src/parsers/TextToolCallParser.ts` — 5
- `packages/core/src/providers/openai-vercel/messageConversion.ts` — 5
- `packages/core/src/providers/openai/OpenAIProvider.ts` — 5
- `packages/core/src/providers/openai/parseResponsesStream.ts` — 5
- `packages/core/src/runtime/createAgentRuntimeContext.ts` — 5
- `packages/core/src/tools/write-file.ts` — 5
- `packages/core/src/utils/terminalSerializer.ts` — 5
- `packages/core/src/core/client.ts` — 4
- `packages/core/src/core/geminiChat.ts` — 4
- `packages/core/src/core/IdeContextTracker.ts` — 4
- `packages/core/src/core/subagent.ts` — 4
- `packages/core/src/core/subagentOrchestrator.ts` — 4
- `packages/core/src/core/turn.ts` — 4
- `packages/core/src/hooks/types.ts` — 4
- `packages/core/src/models/profiles.ts` — 4
- `packages/core/src/policy/config.ts` — 4
- `packages/core/src/policy/toml-loader.ts` — 4
- `packages/core/src/providers/openai-vercel/errors.ts` — 4
- `packages/core/src/providers/openai/OpenAIResponseParser.ts` — 4
- `packages/core/src/telemetry/loggers.ts` — 4
- `packages/core/src/utils/extensionLoader.ts` — 4
- `packages/core/src/utils/googleQuotaErrors.ts` — 4
- `packages/core/src/auth/codex-device-flow.ts` — 3

### BN5-C-P04 — core production

- Type: production
- Files: 25
- Warnings: 74

- `packages/core/src/code_assist/converter.ts` — 3
- `packages/core/src/code_assist/setup.ts` — 3
- `packages/core/src/config/schedulerSingleton.ts` — 3
- `packages/core/src/core/subagentExecution.ts` — 3
- `packages/core/src/hooks/hookTranslator.ts` — 3
- `packages/core/src/mcp/oauth-provider.ts` — 3
- `packages/core/src/mcp/oauth-utils.ts` — 3
- `packages/core/src/models/provider-integration.ts` — 3
- `packages/core/src/prompt-config/prompt-loader.ts` — 3
- `packages/core/src/prompt-config/prompt-resolver.ts` — 3
- `packages/core/src/prompt-config/TemplateEngine.ts` — 3
- `packages/core/src/providers/openai/OpenAIApiExecution.ts` — 3
- `packages/core/src/providers/openai/OpenAIClientFactory.ts` — 3
- `packages/core/src/providers/openai/OpenAIRequestPreparation.ts` — 3
- `packages/core/src/scheduler/result-aggregator.ts` — 3
- `packages/core/src/scheduler/tool-executor.ts` — 3
- `packages/core/src/skills/skillLoader.ts` — 3
- `packages/core/src/telemetry/types.ts` — 3
- `packages/core/src/tools/edit.ts` — 3
- `packages/core/src/tools/structural-analysis.ts` — 3
- `packages/core/src/utils/fileUtils.ts` — 3
- `packages/core/src/utils/generateContentResponseUtilities.ts` — 3
- `packages/core/src/utils/memoryDiscovery.ts` — 3
- `packages/core/src/utils/tool-utils.ts` — 3
- `packages/core/src/code_assist/oauth-credential-storage.ts` — 2

### BN5-C-P05 — core production

- Type: production
- Files: 25
- Warnings: 50

- `packages/core/src/config/configBaseCore.ts` — 2
- `packages/core/src/core/baseLlmClient.ts` — 2
- `packages/core/src/core/subagentToolProcessing.ts` — 2
- `packages/core/src/core/TodoContinuationService.ts` — 2
- `packages/core/src/debug/ConfigurationManager.ts` — 2
- `packages/core/src/mcp/google-auth-provider.ts` — 2
- `packages/core/src/mcp/sa-impersonation-provider.ts` — 2
- `packages/core/src/mcp/token-storage/base-token-storage.ts` — 2
- `packages/core/src/mcp/token-storage/keychain-token-storage.ts` — 2
- `packages/core/src/prompt-config/defaults/core-defaults.ts` — 2
- `packages/core/src/prompt-config/defaults/provider-defaults.ts` — 2
- `packages/core/src/prompt-config/defaults/tool-defaults.ts` — 2
- `packages/core/src/prompt-config/prompt-cache.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicProvider.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicRequestBuilder.ts` — 2
- `packages/core/src/providers/anthropic/AnthropicResponseParser.ts` — 2
- `packages/core/src/providers/openai/getOpenAIProviderInfo.ts` — 2
- `packages/core/src/providers/openai/ToolCallPipeline.ts` — 2
- `packages/core/src/recording/sessionCleanupUtils.ts` — 2
- `packages/core/src/runtime/AgentRuntimeLoader.ts` — 2
- `packages/core/src/runtime/AgentRuntimeState.ts` — 2
- `packages/core/src/scheduler/confirmation-coordinator.ts` — 2
- `packages/core/src/scheduler/status-transitions.ts` — 2
- `packages/core/src/scheduler/tool-dispatcher.ts` — 2
- `packages/core/src/services/environmentSanitization.ts` — 2

### BN5-C-P06 — core production

- Type: production
- Files: 25
- Warnings: 39

- `packages/core/src/test-utils/tools.ts` — 2
- `packages/core/src/tools/apply-patch.ts` — 2
- `packages/core/src/tools/ast-edit/ast-read-file-invocation.ts` — 2
- `packages/core/src/tools/grep.ts` — 2
- `packages/core/src/tools/lsp-diagnostics-helper.ts` — 2
- `packages/core/src/tools/mcp-tool.ts` — 2
- `packages/core/src/tools/memoryTool.ts` — 2
- `packages/core/src/tools/task.ts` — 2
- `packages/core/src/tools/tools.ts` — 2
- `packages/core/src/utils/errors.ts` — 2
- `packages/core/src/utils/filesearch/fileSearch.ts` — 2
- `packages/core/src/utils/partUtils.ts` — 2
- `packages/core/src/utils/quotaErrorDetection.ts` — 2
- `packages/core/src/utils/shell-parser.ts` — 2
- `packages/core/src/auth/anthropic-device-flow.ts` — 1
- `packages/core/src/code_assist/codeAssist.ts` — 1
- `packages/core/src/code_assist/oauth2.ts` — 1
- `packages/core/src/config/configBase.ts` — 1
- `packages/core/src/config/lspIntegration.ts` — 1
- `packages/core/src/core/bucketFailoverIntegration.ts` — 1
- `packages/core/src/core/clientToolGovernance.ts` — 1
- `packages/core/src/core/compression/CompressionHandler.ts` — 1
- `packages/core/src/core/compression/HighDensityStrategy.ts` — 1
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — 1
- `packages/core/src/core/compression/OneShotStrategy.ts` — 1

### BN5-C-P07 — core production

- Type: production
- Files: 25
- Warnings: 25

- `packages/core/src/core/contentGenerator.ts` — 1
- `packages/core/src/core/logger.ts` — 1
- `packages/core/src/core/prompts.ts` — 1
- `packages/core/src/core/tokenLimits.ts` — 1
- `packages/core/src/debug/FileOutput.ts` — 1
- `packages/core/src/filters/EmojiFilter.ts` — 1
- `packages/core/src/hooks/hookAggregator.ts` — 1
- `packages/core/src/ide/process-utils.ts` — 1
- `packages/core/src/mcp/oauth-token-storage.ts` — 1
- `packages/core/src/mcp/token-store.ts` — 1
- `packages/core/src/models/registry.ts` — 1
- `packages/core/src/policy/policy-engine.ts` — 1
- `packages/core/src/policy/utils.ts` — 1
- `packages/core/src/prompt-config/prompt-service.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicMessageNormalizer.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicMessageValidator.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicRateLimitHandler.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicRequestPreparation.ts` — 1
- `packages/core/src/providers/chutes/usageInfo.ts` — 1
- `packages/core/src/providers/fake/FakeProvider.ts` — 1
- `packages/core/src/providers/openai/buildResponsesRequest.ts` — 1
- `packages/core/src/providers/openai/OpenAIRequestBuilder.ts` — 1
- `packages/core/src/providers/openai/openaiRequestParams.ts` — 1
- `packages/core/src/providers/openai/syntheticToolResponses.ts` — 1
- `packages/core/src/providers/openai/ToolCallNormalizer.ts` — 1

### BN5-C-P08 — core production

- Type: production
- Files: 25
- Warnings: 25

- `packages/core/src/providers/openai/toolNameUtils.ts` — 1
- `packages/core/src/providers/reasoning/reasoningUtils.ts` — 1
- `packages/core/src/providers/zai/usageInfo.ts` — 1
- `packages/core/src/recording/ReplayEngine.ts` — 1
- `packages/core/src/recording/SessionDiscovery.ts` — 1
- `packages/core/src/runtime/RuntimeInvocationContext.ts` — 1
- `packages/core/src/services/history/IContent.ts` — 1
- `packages/core/src/services/loopDetectionService.ts` — 1
- `packages/core/src/services/todo-reminder-service.ts` — 1
- `packages/core/src/settings/settingsRegistry.ts` — 1
- `packages/core/src/skills/skillManager.ts` — 1
- `packages/core/src/telemetry/uiTelemetry.ts` — 1
- `packages/core/src/tools/ast-edit/context-collector.ts` — 1
- `packages/core/src/tools/check-async-tasks.ts` — 1
- `packages/core/src/tools/direct-web-fetch.ts` — 1
- `packages/core/src/tools/exa-web-search.ts` — 1
- `packages/core/src/tools/glob.ts` — 1
- `packages/core/src/tools/google-web-fetch.ts` — 1
- `packages/core/src/tools/read-many-files.ts` — 1
- `packages/core/src/tools/todo-pause.ts` — 1
- `packages/core/src/tools/todo-store.ts` — 1
- `packages/core/src/tools/todo-write.ts` — 1
- `packages/core/src/utils/bfsFileSearch.ts` — 1
- `packages/core/src/utils/fetch.ts` — 1
- `packages/core/src/utils/fileDiffUtils.ts` — 1

### BN5-C-P09 — core production

- Type: production
- Files: 6
- Warnings: 6

- `packages/core/src/utils/parameterCoercion.ts` — 1
- `packages/core/src/utils/ripgrepPathResolver.ts` — 1
- `packages/core/src/utils/secure-browser-launcher.ts` — 1
- `packages/core/src/utils/shell-utils.ts` — 1
- `packages/core/src/utils/streamIdleTimeout.ts` — 1
- `packages/core/src/utils/toolOutputLimiter.ts` — 1

### BN5-C-T01 — core test

- Type: test
- Files: 40
- Warnings: 141

- `packages/core/src/tools/ripGrep.test.ts` — 31
- `packages/core/src/providers/anthropic/AnthropicProvider.test.ts` — 8
- `packages/core/src/providers/openai/OpenAIProvider.emptyResponseRetry.test.ts` — 8
- `packages/core/src/providers/__tests__/LoadBalancingProvider.test.ts` — 6
- `packages/core/src/tools/__tests__/ast-edit-characterization.test.ts` — 6
- `packages/core/src/tools/shell.test.ts` — 6
- `packages/core/src/auth/qwen-device-flow.spec.ts` — 5
- `packages/core/src/providers/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` — 5
- `packages/core/src/types/__tests__/modelParams.bucket.spec.ts` — 5
- `packages/core/src/config/config-lsp-integration.test.ts` — 4
- `packages/core/src/core/geminiChat.thinking-toolcalls.test.ts` — 4
- `packages/core/src/core/TodoContinuationService.test.ts` — 4
- `packages/core/src/tools/edit.test.ts` — 4
- `packages/core/src/tools/ls.test.ts` — 4
- `packages/core/src/providers/__tests__/LoadBalancingProvider.timeout.test.ts` — 3
- `packages/core/src/providers/openai/OpenAIProvider.mediaBlock.test.ts` — 3
- `packages/core/src/auth/token-store.refresh-race.spec.ts` — 2
- `packages/core/src/core/coreToolScheduler.interactiveMode.test.ts` — 2
- `packages/core/src/core/subagent.test.ts` — 2
- `packages/core/src/hooks/tool-render-suppression-hook.test.ts` — 2
- `packages/core/src/providers/__tests__/LoadBalancingProvider.tpm.test.ts` — 2
- `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts` — 2
- `packages/core/src/providers/integration/multi-provider.integration.test.ts` — 2
- `packages/core/src/providers/openai/parseResponsesStream.issue1844.test.ts` — 2
- `packages/core/src/services/history/HistoryService.test.ts` — 2
- `packages/core/src/tools/__tests__/ast-edit-empty-file.test.ts` — 2
- `packages/core/src/tools/confirmation-policy.test.ts` — 2
- `packages/core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` — 1
- `packages/core/src/core/__tests__/turn.thinking.test.ts` — 1
- `packages/core/src/core/baseLlmClient.test.ts` — 1
- `packages/core/src/core/client.test.ts` — 1
- `packages/core/src/core/coreToolScheduler.contextBudget.test.ts` — 1
- `packages/core/src/core/geminiChat.contextlimit.test.ts` — 1
- `packages/core/src/core/geminiChat.issue1150.integration.test.ts` — 1
- `packages/core/src/core/turn.test.ts` — 1
- `packages/core/src/filters/EmojiFilter.consistency.test.ts` — 1
- `packages/core/src/filters/EmojiFilter.property.test.ts` — 1
- `packages/core/src/providers/anthropic/AnthropicProvider.stateless.test.ts` — 1
- `packages/core/src/providers/gemini/GeminiProvider.test.ts` — 1
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.reasoning.test.ts` — 1

### BN5-C-T02 — core test

- Type: test
- Files: 5
- Warnings: 5

- `packages/core/src/services/shellExecutionService.test.ts` — 1
- `packages/core/src/tools/__tests__/shell-params.test.ts` — 1
- `packages/core/src/tools/direct-web-fetch.test.ts` — 1
- `packages/core/src/tools/google-web-fetch.test.ts` — 1
- `packages/core/src/tools/mcp-client.test.ts` — 1

### BN5-L-P01 — cli production

- Type: production
- Files: 25
- Warnings: 158

- `packages/cli/src/ui/hooks/useSlashCompletion.tsx` — 14
- `packages/cli/src/zed-integration/zedIntegration.ts` — 12
- `packages/cli/src/config/cliArgParser.ts` — 9
- `packages/cli/src/config/settings-validation.ts` — 8
- `packages/cli/src/gemini.tsx` — 8
- `packages/cli/src/ui/components/ModelDialog.tsx` — 8
- `packages/cli/src/config/extension.ts` — 7
- `packages/cli/src/nonInteractiveCli.ts` — 7
- `packages/cli/src/ui/hooks/atCommandProcessor.ts` — 7
- `packages/cli/src/ui/utils/terminalSetup.ts` — 7
- `packages/cli/src/utils/sandbox.ts` — 7
- `packages/cli/src/ui/commands/chatCommand.ts` — 6
- `packages/cli/src/ui/containers/AppContainer/hooks/useKeybindings.ts` — 6
- `packages/cli/src/ui/hooks/useSelectionList.ts` — 6
- `packages/cli/src/ui/commands/modelCommand.ts` — 5
- `packages/cli/src/ui/components/messages/ToolConfirmationMessage.tsx` — 5
- `packages/cli/src/extensions/extensionAutoUpdater.ts` — 4
- `packages/cli/src/ui/commands/restoreCommand.ts` — 4
- `packages/cli/src/ui/commands/schema/index.ts` — 4
- `packages/cli/src/ui/components/FolderTrustDialog.tsx` — 4
- `packages/cli/src/ui/components/InputPrompt.tsx` — 4
- `packages/cli/src/ui/components/messages/ToolMessage.tsx` — 4
- `packages/cli/src/ui/components/SecureKeyInput.tsx` — 4
- `packages/cli/src/ui/components/shared/buffer-reducer.ts` — 4
- `packages/cli/src/ui/components/views/SkillsList.tsx` — 4

### BN5-L-P02 — cli production

- Type: production
- Files: 25
- Warnings: 68

- `packages/cli/src/ui/hooks/geminiStream/useStreamEventHandlers.ts` — 4
- `packages/cli/src/utils/privacy/ConversationDataRedactor.ts` — 4
- `packages/cli/src/auth/auth-utils.ts` — 3
- `packages/cli/src/auth/profile-utils.ts` — 3
- `packages/cli/src/config/approvalModeResolver.ts` — 3
- `packages/cli/src/config/interactiveContext.ts` — 3
- `packages/cli/src/config/profileBootstrap.ts` — 3
- `packages/cli/src/ui/commands/bugCommand.ts` — 3
- `packages/cli/src/ui/commands/skillsCommand.ts` — 3
- `packages/cli/src/ui/commands/todoCommand.ts` — 3
- `packages/cli/src/ui/components/LoggingDialog.tsx` — 3
- `packages/cli/src/ui/components/messages/ToolResultDisplay.tsx` — 3
- `packages/cli/src/ui/components/ModelStatsDisplay.tsx` — 3
- `packages/cli/src/ui/components/ProfileCreateWizard/utils.ts` — 3
- `packages/cli/src/utils/sessionCleanup.ts` — 3
- `packages/cli/src/utils/windowTitle.ts` — 3
- `packages/cli/src/auth/gemini-oauth-provider.ts` — 2
- `packages/cli/src/auth/token-access-coordinator.ts` — 2
- `packages/cli/src/commands/extensions/update.ts` — 2
- `packages/cli/src/config/extensions/consent.ts` — 2
- `packages/cli/src/config/extensions/settingsIntegration.ts` — 2
- `packages/cli/src/config/postConfigRuntime.ts` — 2
- `packages/cli/src/config/toolGovernance.ts` — 2
- `packages/cli/src/providers/providerAliases.ts` — 2
- `packages/cli/src/services/BuiltinCommandLoader.ts` — 2

### BN5-L-P03 — cli production

- Type: production
- Files: 25
- Warnings: 50

- `packages/cli/src/services/FileCommandLoader.ts` — 2
- `packages/cli/src/services/McpPromptLoader.ts` — 2
- `packages/cli/src/ui/commands/authCommand.ts` — 2
- `packages/cli/src/ui/commands/diagnosticsCommand.ts` — 2
- `packages/cli/src/ui/commands/keyCommand.ts` — 2
- `packages/cli/src/ui/commands/statsCommand.ts` — 2
- `packages/cli/src/ui/components/AppHeader.tsx` — 2
- `packages/cli/src/ui/components/Notifications.tsx` — 2
- `packages/cli/src/ui/components/PermissionsModifyTrustDialog.tsx` — 2
- `packages/cli/src/ui/components/ProfileCreateWizard/TextInput.tsx` — 2
- `packages/cli/src/ui/components/shared/BaseSelectionList.tsx` — 2
- `packages/cli/src/ui/components/Table.tsx` — 2
- `packages/cli/src/ui/components/views/HooksList.tsx` — 2
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppInput.ts` — 2
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppLayout.ts` — 2
- `packages/cli/src/ui/containers/AppContainer/hooks/useInputHandling.ts` — 2
- `packages/cli/src/ui/containers/SessionController.tsx` — 2
- `packages/cli/src/ui/hooks/shellCommandProcessor.ts` — 2
- `packages/cli/src/ui/hooks/useWorkspaceMigration.ts` — 2
- `packages/cli/src/ui/hooks/vim.ts` — 2
- `packages/cli/src/ui/themes/theme.ts` — 2
- `packages/cli/src/ui/utils/rewindFileOps.ts` — 2
- `packages/cli/src/utils/commands.ts` — 2
- `packages/cli/src/utils/handleAutoUpdate.ts` — 2
- `packages/cli/src/utils/skillSettings.ts` — 2

### BN5-L-P04 — cli production

- Type: production
- Files: 25
- Warnings: 26

- `packages/cli/src/zed-integration/fileSystemService.ts` — 2
- `packages/cli/src/auth/auth-flow-orchestrator.ts` — 1
- `packages/cli/src/commands/extensions/link.ts` — 1
- `packages/cli/src/commands/extensions/settings.ts` — 1
- `packages/cli/src/commands/extensions/validate.ts` — 1
- `packages/cli/src/commands/skills/install.ts` — 1
- `packages/cli/src/commands/skills/list.ts` — 1
- `packages/cli/src/config/environmentLoader.ts` — 1
- `packages/cli/src/config/extensions/settingsStorage.ts` — 1
- `packages/cli/src/config/extensions/update.ts` — 1
- `packages/cli/src/config/extensions/variables.ts` — 1
- `packages/cli/src/config/profileResolution.ts` — 1
- `packages/cli/src/config/profileRuntimeApplication.ts` — 1
- `packages/cli/src/runtime/bucketFailover.ts` — 1
- `packages/cli/src/runtime/providerMutations.ts` — 1
- `packages/cli/src/services/prompt-processors/shellProcessor.ts` — 1
- `packages/cli/src/test-utils/customMatchers.ts` — 1
- `packages/cli/src/ui/AppContainerRuntime.tsx` — 1
- `packages/cli/src/ui/commands/compressCommand.ts` — 1
- `packages/cli/src/ui/commands/continueCommand.ts` — 1
- `packages/cli/src/ui/commands/copyCommand.ts` — 1
- `packages/cli/src/ui/commands/extensionsCommand.ts` — 1
- `packages/cli/src/ui/commands/ideCommand.ts` — 1
- `packages/cli/src/ui/commands/keyfileCommand.ts` — 1
- `packages/cli/src/ui/commands/lspCommand.ts` — 1

### BN5-L-P05 — cli production

- Type: production
- Files: 25
- Warnings: 25

- `packages/cli/src/ui/commands/subagentCommand.ts` — 1
- `packages/cli/src/ui/commands/terminalSetupCommand.ts` — 1
- `packages/cli/src/ui/components/AnsiOutput.tsx` — 1
- `packages/cli/src/ui/components/DetailedMessagesDisplay.tsx` — 1
- `packages/cli/src/ui/components/DialogManager.tsx` — 1
- `packages/cli/src/ui/components/Footer.tsx` — 1
- `packages/cli/src/ui/components/LBStatsDisplay.tsx` — 1
- `packages/cli/src/ui/components/LoadingIndicator.tsx` — 1
- `packages/cli/src/ui/components/messages/ToolGroupMessage.tsx` — 1
- `packages/cli/src/ui/components/ProfileCreateWizard/AuthenticationStep.tsx` — 1
- `packages/cli/src/ui/components/ProfileCreateWizard/ProfileSaveStep.tsx` — 1
- `packages/cli/src/ui/components/shared/text-buffer.ts` — 1
- `packages/cli/src/ui/components/shared/VirtualizedList.tsx` — 1
- `packages/cli/src/ui/components/ShellInputPrompt.tsx` — 1
- `packages/cli/src/ui/components/SuggestionsDisplay.tsx` — 1
- `packages/cli/src/ui/components/ToolsDialog.tsx` — 1
- `packages/cli/src/ui/components/views/ExtensionsList.tsx` — 1
- `packages/cli/src/ui/containers/AppContainer/hooks/useAppBootstrap.ts` — 1
- `packages/cli/src/ui/containers/AppContainer/hooks/useMemoryRefreshAction.ts` — 1
- `packages/cli/src/ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.ts` — 1
- `packages/cli/src/ui/contexts/KeypressContext.tsx` — 1
- `packages/cli/src/ui/contexts/MouseContext.tsx` — 1
- `packages/cli/src/ui/hooks/slashCommandProcessor.ts` — 1
- `packages/cli/src/ui/hooks/toolMapping.ts` — 1
- `packages/cli/src/ui/hooks/useAutoAcceptIndicator.ts` — 1

### BN5-L-P06 — cli production

- Type: production
- Files: 16
- Warnings: 16

- `packages/cli/src/ui/hooks/useExtensionAutoUpdate.ts` — 1
- `packages/cli/src/ui/hooks/useOAuthOrchestration.ts` — 1
- `packages/cli/src/ui/hooks/usePermissionsModifyTrust.ts` — 1
- `packages/cli/src/ui/hooks/usePrivacySettings.ts` — 1
- `packages/cli/src/ui/hooks/useShellHistory.ts` — 1
- `packages/cli/src/ui/hooks/useThemeCommand.ts` — 1
- `packages/cli/src/ui/privacy/CloudFreePrivacyNotice.tsx` — 1
- `packages/cli/src/ui/state/extensions.ts` — 1
- `packages/cli/src/ui/utils/ConsolePatcher.ts` — 1
- `packages/cli/src/ui/utils/TableRenderer.tsx` — 1
- `packages/cli/src/ui/utils/ui-sizing.ts` — 1
- `packages/cli/src/ui/utils/updateCheck.ts` — 1
- `packages/cli/src/utils/envVarResolver.ts` — 1
- `packages/cli/src/utils/gitUtils.ts` — 1
- `packages/cli/src/utils/persistentState.ts` — 1
- `packages/cli/src/utils/singleSettingSaver.ts` — 1

### BN5-L-T01 — cli test

- Type: test
- Files: 40
- Warnings: 87

- `packages/cli/src/ui/App.test.tsx` — 18
- `packages/cli/src/ui/components/shared/golden-snapshot.test.ts` — 8
- `packages/cli/src/ui/commands/clearCommand.test.ts` — 6
- `packages/cli/src/runtime/runtimeSettings.proactive-wiring.lb.spec.ts` — 4
- `packages/cli/src/config/config.test.ts` — 3
- `packages/cli/src/integration-tests/test-utils.ts` — 3
- `packages/cli/src/services/prompt-processors/shellProcessor.test.ts` — 3
- `packages/cli/src/ui/components/Footer.test.tsx` — 3
- `packages/cli/src/ui/hooks/useGeminiStream.test.tsx` — 3
- `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts` — 2
- `packages/cli/src/config/settingsSchema.test.ts` — 2
- `packages/cli/src/coreToolToggle.test.ts` — 2
- `packages/cli/src/ui/components/messages/UserMessage.test.tsx` — 2
- `packages/cli/src/ui/components/views/SkillsList.test.tsx` — 2
- `packages/cli/src/auth/__tests__/forceRefreshToken.test.ts` — 1
- `packages/cli/src/auth/__tests__/multi-bucket-auth.spec.ts` — 1
- `packages/cli/src/auth/__tests__/oauth-manager.issue913.spec.ts` — 1
- `packages/cli/src/auth/local-oauth-callback.spec.ts` — 1
- `packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts` — 1
- `packages/cli/src/commands/extensions/config.test.ts` — 1
- `packages/cli/src/commands/extensions/install.test.ts` — 1
- `packages/cli/src/nonInteractiveCli.test.ts` — 1
- `packages/cli/src/runtime/__tests__/profileApplication.test.ts` — 1
- `packages/cli/src/runtime/__tests__/runtimeIsolation.test.ts` — 1
- `packages/cli/src/runtime/anthropic-oauth-defaults.test.ts` — 1
- `packages/cli/src/runtime/provider-alias-defaults.test.ts` — 1
- `packages/cli/src/ui/commands/diagnosticsCommand.spec.ts` — 1
- `packages/cli/src/ui/commands/helpCommand.test.ts` — 1
- `packages/cli/src/ui/commands/themeCommand.test.ts` — 1
- `packages/cli/src/ui/components/ContextUsageDisplay.semantic.test.tsx` — 1
- `packages/cli/src/ui/components/InputPrompt.test.tsx` — 1
- `packages/cli/src/ui/components/shared/buffer-operations.test.ts` — 1
- `packages/cli/src/ui/components/shared/VirtualizedList.theme.test.tsx` — 1
- `packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts` — 1
- `packages/cli/src/ui/hooks/useGeminiStream.thinking.test.tsx` — 1
- `packages/cli/src/ui/hooks/useSelectionList.test.ts` — 1
- `packages/cli/src/ui/hooks/useToolScheduler.test.ts` — 1
- `packages/cli/src/ui/themes/semantic-tokens.test.ts` — 1
- `packages/cli/src/ui/themes/theme-manager.test.ts` — 1
- `packages/cli/src/utils/userStartupWarnings.test.ts` — 1

### BN5-L-T02 — cli test

- Type: test
- Files: 1
- Warnings: 1

- `packages/cli/src/utils/windowTitle.test.ts` — 1

## Validation

- Total files covered: 442
- Total warnings covered: 1502
- Duplicate files: 0
- Missing files: 0
- Max production batch size: 25
- Max test batch size: 40

## Recommended start

Start with `BN5-A-P01` because it is the smallest low-risk production scope.

## Exit criteria

- `npx eslint <listed-files> --ext .ts,.tsx` reports 0 warnings for `@typescript-eslint/strict-boolean-expressions` in each completed sub-batch.
- Full-repo `npm run lint` reports 0 errors and eventually 0 warnings for this rule after all sub-batches.
- Full verification suite green for each committed sub-batch, with known unrelated environmental/test timeouts documented by verifier when they occur.
