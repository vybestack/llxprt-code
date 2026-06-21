/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import vitest from '@vitest/eslint-plugin';
import sonarjs from 'eslint-plugin-sonarjs';
import eslintComments from 'eslint-plugin-eslint-comments';
import globals from 'globals';
import headers from 'eslint-plugin-headers';
import reactRenderSafety from './eslint-rules/react-render-safety.js';
import noInlineDeps from './eslint-rules/no-inline-deps.js';
import inkTextColorRequired from './eslint-rules/ink-text-color-required.js';
import path from 'node:path';
import url from 'node:url';

// --- ESM way to get __dirname ---
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// --- ---

// Determine the monorepo root (assuming eslint.config.js is at the root)
const projectRoot = __dirname;

const legacyDirectiveCleanupScopes = [
  'packages/core/src/code_assist/oauth-credential-storage.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/code_assist/setup.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/config-lsp-integration.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/config.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/configBaseCore.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/endpoints.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/lspIntegration.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/config/toolRegistryFactory.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/contentGenerator.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/coreToolHookTriggers.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/lifecycleHookTriggers.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/logger.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/subagentTypes.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/core/subagentTypes.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/debug/DebugLogger.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/debug/FileOutput.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/filters/EmojiFilter.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/filters/EmojiFilter.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/__tests__/hookEventHandler-messagebus.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/__tests__/hookSemantics.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/__tests__/hookSystem-lifecycle.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/__tests__/hookValidators.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/hookEventHandler.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/hookRegistry.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/hookRunner.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/hooks/types.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/integration/compression-duplicate-ids.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/models/hydration.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/models/registry.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/parsers/TextToolCallParser.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/parsers/tool-call-parser-utils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/policy/utils.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/prompt-config/prompt-cache.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/prompt-config/prompt-installer.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/prompt-config/prompt-loader.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/prompt-config/prompt-service.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/prompt-config/TemplateEngine.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/__tests__/SessionDiscovery.extensions.spec.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/integration.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/RecordingIntegration.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/ReplayEngine.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/ReplayEngine.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/resumeSession.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/sessionCleanupUtils.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/SessionDiscovery.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/SessionDiscovery.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/SessionLockManager.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/SessionLockManager.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/sessionManagement.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/recording/SessionRecordingService.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/AgentRuntimeLoader.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/AgentRuntimeState.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/contracts/boundary-guards.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/createAgentRuntimeContext.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/errors/MissingRuntimeProviderError.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/runtime/RuntimeInvocationContext.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/gitService.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/history/__tests__/density-history.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/history/canonicalToolIds.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/history/HistoryService.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/loopDetectionService.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/services/shellExecutionService.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/skills/skillLoader.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/skills/skillManager.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/storage/SessionPersistenceService.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/telemetry/loggers.test.circular.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/telemetry/loggers.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/test-utils/runtime.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/test-utils/tools.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/todo/todoFormatter.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/tools/tool-key-storage.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/__tests__/resolveTextSearchTarget.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/ast-grep-utils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/asyncIterator.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/bfsFileSearch.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/checkpointUtils.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/checkpointUtils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/editor.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/errorParsing.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/errorReporting.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/events.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/fileDiffUtils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/filesearch/crawler.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/filesearch/fileSearch.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/filesearch/fileSearch.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/fileUtils.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/fileUtils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/generateContentResponseUtilities.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/getFolderStructure.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/getPty.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/gitIgnoreParser.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/gitLineChanges.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/googleErrors.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/googleQuotaErrors.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/googleQuotaErrors.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/ignorePatterns.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/memoryDiscovery.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/memoryDiscovery.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/memoryImportProcessor.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/memoryImportProcessor.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/parameterCoercion.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/partUtils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/paths.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/quotaErrorDetection.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/retry.quota.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/retry.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/retry.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/safeJsonStringify.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/sanitization.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/schemaValidator.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/secure-browser-launcher.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shell-parser.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shell-parser.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shell-utils.shellReplacement.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shell-utils.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shell-utils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/shellPathCompletion.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/stdio.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/streamIdleTimeout.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/summarizer.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/systemEncoding.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/terminalSerializer.test.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/terminalSerializer.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/tool-utils.ts', // remaining core cleanup after #2081/#2082
  'packages/core/src/utils/userAccountManager.ts', // remaining core cleanup after #2081/#2082
  // #2083 completed files are locked in completedDirectiveCleanupScopes below.
  // Remaining #2084/#2092 provider files keep narrowed globs here.
  'packages/providers/src/**/*.{test,spec}.ts', // #2092 provider tests
  'packages/providers/src/anthropic/**/*.ts', // #2084/#2092
  'packages/providers/src/openai/**/*.ts', // #2084/#2092
  'packages/providers/src/openai-responses/**/*.ts', // #2084/#2092
  'packages/providers/src/openai-vercel/**/*.ts', // #2084/#2092
  'packages/providers/src/gemini/**/*.ts', // #2084/#2092
  'packages/providers/src/auth/**/*.ts', // #2092
  'packages/providers/src/BaseProvider.ts', // #2084
  'packages/providers/src/composition/**/*.ts', // #2084
  'packages/providers/src/fake/**/*.ts', // #2084
  'packages/providers/src/logging/ProviderContentExtractor.ts', // #2084
  'packages/providers/src/reasoning/**/*.ts', // #2084
  'packages/providers/src/runtime/bucketFailover.ts', // #2092
  'packages/providers/src/runtime/modelParamParser.ts', // #2084
  'packages/providers/src/runtime/runtimeAccessors.ts', // #2084
  'packages/providers/src/utils/localEndpoint.ts', // #2084
  'packages/providers/src/utils/toolNameNormalization.ts', // #2084
  'packages/providers/src/utils/toolResponsePayload.ts', // #2084
  'packages/agents/src/**/*.{ts,tsx}', // #2085/#2090
  'packages/cli/src/**/*.{ts,tsx}', // #2086/#2087/#2091
  'packages/policy/src/**/*.{ts,tsx}', // #2089 not yet decomposed
  'packages/storage/src/**/*.{ts,tsx}', // #2092
  // #2089 scope: the six target packages (mcp/auth/settings/telemetry/
  // ide-integration/a2a-server) still contain other files with legacy
  // inline lint directives. Those packages are kept in legacy scope so
  // existing directives do not break lint. The target files and extracted
  // modules are locked in completedDirectiveCleanupScopes below, which
  // overrides this block for those specific files.
  'packages/mcp/src/**/*.{ts,tsx}', // #2089/#2092 (non-target files)
  'packages/auth/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/settings/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/telemetry/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/ide-integration/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/a2a-server/src/**/*.{ts,tsx}', // #2089 (non-target files)
];

const completedDirectiveCleanupScopes = [
  'packages/core/src/services/complexity-analyzer.ts', // #2081
  'packages/core/src/services/environmentSanitization.ts', // #2081
  'packages/core/src/services/history/ContentConverters.ts', // #2081
  'packages/core/src/services/history/HistoryService.ts', // #2081
  'packages/core/src/services/history/IContent.ts', // #2081
  'packages/core/src/services/history/curationDebugLogger.ts', // #2081
  'packages/core/src/services/history/densityValidation.ts', // #2081
  'packages/core/src/services/history/historyCloneUtils.ts', // #2081
  'packages/core/src/services/history/historyContextWindow.ts', // #2081
  'packages/core/src/services/history/historyCuration.ts', // #2081
  'packages/core/src/services/history/historyEventTypes.ts', // #2081
  'packages/core/src/services/history/historyProviderPipeline.ts', // #2081
  'packages/core/src/services/history/historyQuery.ts', // #2081
  'packages/core/src/services/history/historyTokenEstimation.ts', // #2081
  'packages/core/src/services/history/historyTokenizerAdapter.ts', // #2081
  'packages/core/src/services/history/historyToolNormalization.ts', // #2081
  'packages/core/src/services/history/historyToolPairing.ts', // #2081
  'packages/core/src/services/shellCpExecution.ts', // #2081
  'packages/core/src/services/shellCpHelpers.ts', // #2081
  'packages/core/src/services/shellExecutionService.ts', // #2081
  'packages/core/src/services/shellExecutionTypes.ts', // #2081
  'packages/core/src/services/shellExitGuard.ts', // #2081
  'packages/core/src/services/shellOutputUtils.ts', // #2081
  'packages/core/src/services/shellProcessKill.ts', // #2081
  'packages/core/src/services/shellPtyExecution.ts', // #2081
  'packages/core/src/services/shellPtyHelpers.ts', // #2081
  'packages/core/src/services/shellPtyLifecycle.ts', // #2081
  'packages/core/src/services/shellPtyState.ts', // #2081
  'packages/core/src/code_assist/oauth2.ts', // #2082
  'packages/core/src/config/agentClientLifecycle.ts', // #2082
  'packages/core/src/config/asyncTaskServices.ts', // #2082
  'packages/core/src/config/config.ts', // #2082
  'packages/core/src/config/configBase.ts', // #2082
  'packages/core/src/config/configConstructor.ts', // #2082
  'packages/core/src/config/subagentManager.ts', // #2082
  'packages/core/src/config/subagentSettingsParser.ts', // #2082
  'packages/core/src/core/prompts.ts', // #2082
  'packages/core/src/core/tokenLimits.ts', // #2082
  'packages/core/src/hooks/hookAggregator.ts', // #2082
  'packages/core/src/hooks/hookRunner.ts', // #2082
  'packages/core/src/hooks/hookTranslator.ts', // #2082
  'packages/core/src/models/profiles.ts', // #2082
  'packages/core/src/policy/config.ts', // #2082
  'packages/core/src/prompt-config/defaults/core-defaults.ts', // #2082
  'packages/core/src/prompt-config/defaults/provider-defaults.ts', // #2082
  'packages/core/src/prompt-config/defaults/tool-defaults.ts', // #2082
  'packages/core/src/prompt-config/installer/**/*.{ts,tsx}', // #2082
  'packages/core/src/prompt-config/prompt-installer.ts', // #2082
  'packages/core/src/prompt-config/prompt-loader.ts', // #2082
  'packages/core/src/prompt-config/prompt-resolver.ts', // #2082
  'packages/core/src/prompt-config/resolver/**/*.{ts,tsx}', // #2082
  'packages/core/src/runtime/runtimeStateFactory.ts', // #2082
  'packages/tools/src/**/*.{ts,tsx}', // #2088
  // #2083 providers core cleanup — only these enumerated files are locked;
  // ProviderContentExtractor.ts remains in legacyDirectiveCleanupScopes for #2084.
  'packages/providers/src/LoadBalancingProvider.ts', // #2083
  'packages/providers/src/LoggingProviderWrapper.ts', // #2083
  'packages/providers/src/ProviderManager.ts', // #2083
  'packages/providers/src/RetryOrchestrator.ts', // #2083
  'packages/providers/src/runtime/profileSnapshot.ts', // #2083
  'packages/providers/src/runtime/runtimeContextFactory.ts', // #2083
  'packages/providers/src/runtime/runtimeRegistry.ts', // #2083
  'packages/providers/src/runtime/settingsResolver.ts', // #2083
  'packages/providers/src/utils/retryStrategy.ts', // #2083
  'packages/providers/src/baseUrlResolver.ts', // #2083
  'packages/providers/src/modelResolver.ts', // #2083
  'packages/providers/src/providerCapabilitiesService.ts', // #2083
  'packages/providers/src/runtimeNormalizer.ts', // #2083
  'packages/providers/src/tokenUsageTracker.ts', // #2083
  'packages/providers/src/loadBalancing/**/*.ts', // #2083
  'packages/providers/src/logging/ConfigBasedRedactor.ts', // #2083
  'packages/providers/src/logging/configValidator.ts', // #2083
  'packages/providers/src/logging/conversationLogger.ts', // #2083
  'packages/providers/src/logging/optionsNormalizer.ts', // #2083
  'packages/providers/src/logging/streamChunkUtils.ts', // #2083
  'packages/providers/src/logging/telemetryEmitter.ts', // #2083
  'packages/providers/src/logging/tokenAccumulator.ts', // #2083
  'packages/providers/src/logging/tokenCounts.ts', // #2083
  'packages/providers/src/runtime/keyResolution.ts', // #2083
  'packages/providers/src/runtime/runtimeIdentityResolution.ts', // #2083
  'packages/providers/src/utils/statusExtraction.ts', // #2083
  // #2089 scope — six target files and their extracted modules are fully
  // compliant: zero inline lint directives. Locked to error so any new
  // directive fails immediately.
  'packages/a2a-server/src/agent/task.ts', // #2089
  'packages/a2a-server/src/agent/task-runtime-helpers.ts', // #2089
  'packages/a2a-server/src/agent/task-support.ts', // #2089
  'packages/auth/src/oauth-errors.ts', // #2089
  'packages/ide-integration/src/lsp/lsp-service-client.ts', // #2089
  'packages/ide-integration/src/lsp/lsp-entry-resolver.ts', // #2089
  'packages/ide-integration/src/lsp/lsp-status-normalizer.ts', // #2089
  'packages/mcp/src/client/mcp-client.ts', // #2089
  'packages/mcp/src/client/mcp-status.ts', // #2089
  'packages/mcp/src/client/mcp-transport.ts', // #2089
  'packages/mcp/src/client/mcp-discovery.ts', // #2089
  'packages/mcp/src/client/mcp-connection.ts', // #2089
  'packages/mcp/src/client/mcp-oauth-helpers.ts', // #2089
  'packages/mcp/src/client/mcp-schema-validator.ts', // #2089
  'packages/mcp/src/client/mcp-callable-tool.ts', // #2089
  'packages/mcp/src/client/mcp-discovery-helpers.ts', // #2089
  'packages/settings/src/settings/settingsRegistry.ts', // #2089
  'packages/settings/src/settings/registry/registry-types.ts', // #2089
  'packages/settings/src/settings/registry/registry-entries-1.ts', // #2089
  'packages/settings/src/settings/registry/registry-entries-2.ts', // #2089
  'packages/settings/src/settings/registry/registry-entries-3.ts', // #2089
  'packages/telemetry/src/telemetry/types.ts', // #2089
  'packages/telemetry/src/telemetry/events/*.ts', // #2089
  // #2090 packages/agents test cleanup — target files and extracted helpers are
  // fully compliant: zero inline lint directives. Locked to error so any new
  // directive fails immediately while the rest of packages/agents remains in
  // legacy cleanup scope for other issues.
  'packages/agents/src/agents/executor.test.ts', // #2090
  'packages/agents/src/agents/executor-test-helpers.ts', // #2090
  'packages/agents/src/agents/executor.execution.test.ts', // #2090
  'packages/agents/src/agents/executor.recovery.test.ts', // #2090
  'packages/agents/src/agents/executor.stream-idle-timeout.test.ts', // #2090
  'packages/agents/src/agents/executor.termination-conditions.test.ts', // #2090
  'packages/agents/src/compression/MiddleOutStrategy-test-helpers.ts', // #2090
  'packages/agents/src/compression/MiddleOutStrategy-core.test.ts', // #2090
  'packages/agents/src/compression/MiddleOutStrategy-edge.test.ts', // #2090
  'packages/agents/src/compression/MiddleOutStrategy-error.test.ts', // #2090
  'packages/agents/src/compression/MiddleOutStrategy-media.test.ts', // #2090
  'packages/agents/src/compression/__tests__/compression-retry-helpers.ts', // #2090
  'packages/agents/src/compression/__tests__/compression-retry-behavior.test.ts', // #2090
  'packages/agents/src/compression/__tests__/compression-retry-classification.test.ts', // #2090
  'packages/agents/src/compression/__tests__/compression-retry-cooldown.test.ts', // #2090
  'packages/agents/src/compression/__tests__/compression-retry-hardlimit.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-helpers.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-dedup.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-failure.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-orchestration.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-property.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-recency.test.ts', // #2090
  'packages/agents/src/compression/__tests__/high-density-optimize-rwpruning.test.ts', // #2090
  'packages/agents/src/core/TodoContinuationService.complexity.test.ts', // #2090
  'packages/agents/src/core/TodoContinuationService.postturn.test.ts', // #2090
  'packages/agents/src/core/TodoContinuationService.reminders.test.ts', // #2090
  'packages/agents/src/core/TodoContinuationService.todoops.test.ts', // #2090
  'packages/agents/src/core/__tests__/chatSession-density.test.ts', // #2090
  'packages/agents/src/core/__tests__/chatSession-density-helpers.ts', // #2090
  'packages/agents/src/core/__tests__/chatSession-density.integration.test.ts', // #2090
  'packages/agents/src/core/__tests__/chatSession-density.property.test.ts', // #2090
  'packages/agents/src/core/__tests__/subagentOrchestrator-runtime.test.ts', // #2090
  'packages/agents/src/core/__tests__/subagentOrchestrator-test-helpers.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.integration.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop-test-helpers.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.auto-policy.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.cancellation.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.display-callbacks.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.prompt-id.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.scheduler-isolation.test.ts', // #2090
  'packages/agents/src/core/agenticLoop/__tests__/agenticLoop.terminal-outcomes.test.ts', // #2090
  'packages/agents/src/core/chatSession.runtime.test.ts', // #2090
  'packages/agents/src/core/chatSession-runtime-helpers.ts', // #2090
  'packages/agents/src/core/chatSession.runtime.history.test.ts', // #2090
  'packages/agents/src/core/chatSession.runtime.streaming.test.ts', // #2090
  'packages/agents/src/core/chatSession.runtime.timeout.test.ts', // #2090
  'packages/agents/src/core/chatSession.thinking-toolcalls.test.ts', // #2090
  'packages/agents/src/core/chatSession-thinking-helpers.ts', // #2090
  'packages/agents/src/core/chatSession.thinking-toolcalls.repro.test.ts', // #2090
  'packages/agents/src/core/chatSession.tokenSync.test.ts', // #2090
  'packages/agents/src/core/chatSession-tokenSync-helpers.ts', // #2090
  'packages/agents/src/core/chatSession.tokenSync.nonstream.test.ts', // #2090
  'packages/agents/src/core/client.test.ts', // #2090
  'packages/agents/src/core/client-test-helpers.ts', // #2090
  'packages/agents/src/core/client.editor-context.test.ts', // #2090
  'packages/agents/src/core/client.hooks.test.ts', // #2090
  'packages/agents/src/core/client.ide-context.test.ts', // #2090
  'packages/agents/src/core/client.lifecycle.test.ts', // #2090
  'packages/agents/src/core/client.methods.test.ts', // #2090
  'packages/agents/src/core/client.model-profile.test.ts', // #2090
  'packages/agents/src/core/client.sendMessageStream-errors.test.ts', // #2090
  'packages/agents/src/core/client.sendMessageStream-overflow.test.ts', // #2090
  'packages/agents/src/core/client.sendMessageStream-thinking.test.ts', // #2090
  'packages/agents/src/core/client.sendMessageStream.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler-test-helpers.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.agent-id.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.cancel-continuation.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.cancel-response.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.confirmation.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.context-aware.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.convert-response.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.edit-cancel.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.non-interactive.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.parallel.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.payload.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.policy.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.race-condition.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.suggest-edit.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.tool-suggestion.test.ts', // #2090
  'packages/agents/src/core/coreToolScheduler.yolo.test.ts', // #2090
  'packages/agents/src/core/subagent.test.ts', // #2090
  'packages/agents/src/core/subagent-test-helpers.ts', // #2090
  'packages/agents/src/core/subagent.buildParts.test.ts', // #2090
  'packages/agents/src/core/subagent.create.test.ts', // #2090
  'packages/agents/src/core/subagent.runNonInteractive-execution.test.ts', // #2090
  'packages/agents/src/core/subagent.runNonInteractive-term.test.ts', // #2090
  'packages/agents/src/core/subagent.runNonInteractive.test.ts', // #2090
  'packages/agents/src/core/subagent.stream-idle.test.ts', // #2090
  'packages/agents/src/core/subagentOrchestrator.test.ts', // #2090
  'packages/agents/src/core/subagentRuntimeSetup.test.ts', // #2090
  'packages/agents/src/core/subagentRuntimeSetup.chat.test.ts', // #2090
  'packages/agents/src/core/subagentRuntimeSetup.scheduler.test.ts', // #2090
  'packages/agents/src/core/turn.test.ts', // #2090
  'packages/agents/src/core/turn-test-helpers.ts', // #2090
  'packages/agents/src/core/turn.abort-timeout.test.ts', // #2090
  'packages/agents/src/core/turn.debug-responses.test.ts', // #2090
  'packages/agents/src/core/turn.hook-events.test.ts', // #2090
  'packages/agents/src/core/turn.idle-timeout.test.ts', // #2090
  'packages/agents/src/core/turn.tool-restrictions.test.ts', // #2090
  'packages/agents/src/scheduler/confirmation-coordinator.test.ts', // #2090
  'packages/agents/src/scheduler/confirmation-coordinator-confirmation.test.ts', // #2090
  'packages/agents/src/scheduler/confirmation-coordinator-test-helpers.ts', // #2090
  'packages/agents/src/tools/task.test.ts', // #2090
  'packages/agents/src/tools/task-test-helpers.ts', // #2090
  'packages/agents/src/tools/task.async-settings.test.ts', // #2090
  'packages/agents/src/tools/task.async.test.ts', // #2090
  'packages/agents/src/tools/task.issues.test.ts', // #2090
  'packages/agents/src/tools/task.max-turns.test.ts', // #2090
  'packages/agents/src/tools/task.timeout.test.ts', // #2090
];

export default tseslint.config(
  {
    // Global ignores
    ignores: [
      'node_modules/*',
      '.yalc/**',
      '**/.yalc/**',
      'yalc.lock',
      '**/yalc.lock',
      '.integration-tests/**',
      'eslint.config.js',
      'packages/**/dist/**',
      'bundle/**',
      'packages/cli/src/test-*.ts',
      'packages/cli/src/test-*.tsx',
      'packages/cli/src/debug-*.ts',
      'packages/cli/src/debug-*.tsx',
      'packages/cli/src/generated/**',
      'packages/core/src/prompts/*.d.ts',
      'debug-*.js',
      'test-*.js',
      'test-*.mjs',
      'suppress-deprecations.mjs',
      'reference/**',
      'research/**',
      'tmp/**',
      'package/bundle/**',
      '.integration-tests/**',
      '.stryker-tmp/**',
      '**/.stryker-tmp/**',
      'project-plans/**',
      'packages/opentui/**',
      'packages/ui/**',
      'packages/lsp/**',
      'evals/**',
      'packages/test-utils/**',
    ],
  },
  {
    // Issue #2079: stale disable directives are policy failures, not warnings.
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'], // Add this if you are using React 17+
  {
    // Settings for eslint-plugin-react
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    // Import specific config
    files: ['packages/cli/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      'import/no-default-export': 'error',
      'import/no-unresolved': 'off', // Disable for now, can be noisy with monorepos/paths
    },
  },
  {
    // General overrides and rules for the project (TS/TSX files)
    files: ['packages/*/src/**/*.{ts,tsx}'], // Target only TS/TSX in the cli package
    plugins: {
      import: importPlugin,
      sonarjs,
      'eslint-comments': eslintComments,
    },
    settings: {
      'import/resolver': {
        node: true,
      },
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: projectRoot,
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      // General Best Practice Rules (subset adapted for flat config)
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      'arrow-body-style': ['error', 'as-needed'],
      curly: ['error', 'multi-line'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-inferrable-types': [
        'error',
        { ignoreParameters: true, ignoreProperties: true },
      ],
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Prevent async errors from bypassing catch handlers
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      'import/no-internal-modules': [
        'error',
        {
          allow: [
            'react-dom/test-utils',
            'memfs/lib/volume.js',
            'vscode-jsonrpc/node.js',
            'yargs/**',
            '@anthropic-ai/sdk/**',
            '**/generated/**',
            '**/packages/core/src/prompts/*.js',
          ],
        },
      ],
      'import/no-relative-packages': 'error',
      'no-cond-assign': 'error',
      'no-debugger': 'error',
      'no-duplicate-case': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'Avoid using require(). Use ES6 imports instead.',
        },
        {
          selector: 'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
          message:
            'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
        },
      ],
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'off', // Disable base rule
      '@typescript-eslint/no-unused-expressions': [
        // Enable TS version
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-arrow-callback': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-console': 'error',
      radix: 'error',
      'default-case': 'error',
      '@typescript-eslint/await-thenable': ['error'],
      '@typescript-eslint/no-floating-promises': ['error'],
      '@typescript-eslint/no-unnecessary-type-assertion': ['error'],

      // --- Strict rules modeled after lsp/ui packages (enabled as warnings for core/cli) ---

      // Strict TypeScript rules
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowString: true,
          allowNumber: false,
          allowNullableObject: true,
          allowNullableBoolean: false,
          allowNullableString: true,
          allowNullableNumber: false,
          allowAny: false,
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',

      // General code quality
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',

      // Complexity limits
      complexity: ['error', 25],
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],

      // Issue #2079: warning-only SonarJS recommendations are not permitted
      // because lint:ci uses --max-warnings 0. Start from off, then promote
      // project-signal rules below to error. Future off decisions must be
      // explicit and justified so the guard in scripts/check-eslint-guard.js
      // can reject accidental policy weakening.
      ...Object.fromEntries(
        Object.entries(sonarjs.configs.recommended.rules ?? {}).map(
          ([rule, config]) => [
            rule,
            Array.isArray(config) ? ['off', ...config.slice(1)] : 'off', // eslint-policy-allow-off: #2079
          ],
        ),
      ),
      'sonarjs/cognitive-complexity': ['error', 30],
      'sonarjs/todo-tag': 'error',
      'sonarjs/no-ignored-exceptions': 'error',
      'sonarjs/regular-expr': 'error',
      'sonarjs/slow-regex': 'error',
      // Issue #2079: this CLI intentionally invokes user/platform tools such as
      // git, shells, editors, and ripgrep. These rules are not useful signal.
      'sonarjs/os-command': 'off', // eslint-policy-allow-off: #2079
      'sonarjs/no-os-command-from-path': 'off', // eslint-policy-allow-off: #2079
      'sonarjs/no-all-duplicated-branches': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-inconsistent-returns': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/nested-control-flow': 'error',
      'sonarjs/expression-complexity': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/too-many-break-or-continue-in-loop': 'error',

      'sonarjs/function-return-type': 'off',
      'sonarjs/no-wildcard-import': 'off',
      'sonarjs/file-header': 'off',

      // Irrelevant SonarJS rules for this Node.js CLI codebase

      // AWS infrastructure rules — no CloudFormation/Terraform/CDK usage
      'sonarjs/aws-apigateway-public-api': 'off',
      'sonarjs/aws-ec2-rds-dms-public': 'off',
      'sonarjs/aws-ec2-unencrypted-ebs-volume': 'off',
      'sonarjs/aws-efs-unencrypted': 'off',
      'sonarjs/aws-iam-all-privileges': 'off',
      'sonarjs/aws-iam-all-resources-accessible': 'off',
      'sonarjs/aws-iam-privilege-escalation': 'off',
      'sonarjs/aws-iam-public-access': 'off',
      'sonarjs/aws-opensearchservice-domain': 'off',
      'sonarjs/aws-rds-unencrypted-databases': 'off',
      'sonarjs/aws-restricted-ip-admin-access': 'off',
      'sonarjs/aws-s3-bucket-granted-access': 'off',
      'sonarjs/aws-s3-bucket-insecure-http': 'off',
      'sonarjs/aws-s3-bucket-public-access': 'off',
      'sonarjs/aws-s3-bucket-server-encryption': 'off',
      'sonarjs/aws-s3-bucket-versioning': 'off',
      'sonarjs/aws-sagemaker-unencrypted-notebook': 'off',
      'sonarjs/aws-sns-unencrypted-topics': 'off',
      'sonarjs/aws-sqs-unencrypted-queue': 'off',

      // Web security / browser / HTTP rules — CLI does not serve HTTP, set cookies, or render HTML
      'sonarjs/certificate-transparency': 'off',
      'sonarjs/content-length': 'off',
      'sonarjs/content-security-policy': 'off',
      'sonarjs/cookie-no-httponly': 'off',
      'sonarjs/cookies': 'off',
      'sonarjs/cors': 'off',
      'sonarjs/csrf': 'off',
      'sonarjs/disabled-auto-escaping': 'off',
      'sonarjs/disabled-resource-integrity': 'off',
      'sonarjs/dns-prefetching': 'off',
      'sonarjs/frame-ancestors': 'off',
      'sonarjs/hidden-files': 'off',
      'sonarjs/insecure-cookie': 'off',
      'sonarjs/link-with-target-blank': 'off',
      'sonarjs/no-clear-text-protocols': 'off',
      'sonarjs/no-ip-forward': 'off',
      'sonarjs/no-mime-sniff': 'off',
      'sonarjs/no-mixed-content': 'off',
      'sonarjs/no-referrer-policy': 'off',
      'sonarjs/no-session-cookies-on-static-assets': 'off',
      'sonarjs/post-message': 'off',
      'sonarjs/session-regeneration': 'off',
      'sonarjs/strict-transport-security': 'off',
      'sonarjs/unverified-certificate': 'off',
      'sonarjs/unverified-hostname': 'off',
      'sonarjs/weak-ssl': 'off',
      'sonarjs/x-powered-by': 'off',

      // HTML/DOM/Accessibility rules — no server-rendered HTML or DOM manipulation
      'sonarjs/no-table-as-layout': 'off',
      'sonarjs/object-alt-content': 'off',
      'sonarjs/table-header': 'off',
      'sonarjs/table-header-reference': 'off',
      'sonarjs/no-intrusive-permissions': 'off',

      // Framework-specific rules — Angular/Vue not used; React SonarJS rules overlap with eslint-plugin-react
      'sonarjs/no-angular-bypass-sanitization': 'off',
      'sonarjs/no-vue-bypass-sanitization': 'off',
      'sonarjs/chai-determinate-assertion': 'off',
      'sonarjs/no-hook-setter-in-body': 'off',
      'sonarjs/no-useless-react-setstate': 'off',
      'sonarjs/prefer-read-only-props': 'off',
      'sonarjs/no-uniq-key': 'off',
      'sonarjs/jsx-no-leaked-render': 'off',

      // Database/SQL rules — no SQL or database usage
      'sonarjs/sql-queries': 'off',
      'sonarjs/web-sql-database': 'off',

      // Other irrelevant rules
      'sonarjs/review-blockchain-mnemonic': 'off',
      'sonarjs/xml-parser-xxe': 'off',
      'sonarjs/xpath': 'off',
      'sonarjs/file-uploads': 'off',

      // Expensive heuristic — NLP analysis on comments with no value for this codebase
      'sonarjs/no-commented-code': 'off',

      // TypeScript-incompatible rules — SonarJS doesn't understand TS global types
      'sonarjs/no-reference-error': 'off', // Flags NodeJS, describe, it, beforeEach as undefined

      // CLI-inappropriate rules — this is a CLI tool, not a web server
      'sonarjs/process-argv': 'off', // CLI needs command line args
      'sonarjs/standard-input': 'off', // CLI needs stdin for pipes
      'sonarjs/publicly-writable-directories': 'off', // CLI needs temp files
      'sonarjs/sockets': 'off', // MCP server uses stdio sockets

      // Module-scope misunderstanding — ESM module scope IS local scope
      'sonarjs/declarations-in-global-scope': 'off', // Top-level module decls are NOT global

      // API naming conflicts — tool API uses snake_case
      'sonarjs/variable-name': 'off', // file_path, old_string, new_string match tool params

      // Redundant with TypeScript-ESLint / other plugins (already have better versions)
      'sonarjs/cyclomatic-complexity': 'off', // ESLint 'complexity' already enabled
      'sonarjs/max-lines-per-function': 'off', // ESLint rule already enabled
      'sonarjs/max-lines': 'off', // ESLint rule already enabled
      'sonarjs/no-unused-vars': 'off', // @typescript-eslint/no-unused-vars handles this
      'sonarjs/no-unused-function-argument': 'off', // Covered by TS no-unused-vars with argsIgnorePattern
      'sonarjs/unused-import': 'off', // import plugin handles this
      'sonarjs/no-implicit-dependencies': 'off', // import plugin handles this
      'sonarjs/deprecation': 'off', // TypeScript compiler already warns on deprecated APIs

      // TypeScript-idiomatic patterns that SonarJS misunderstands
      'sonarjs/void-use': 'off', // Fire-and-forget promises are valid TS pattern
      'sonarjs/no-nested-functions': 'off', // Closures are idiomatic; nested-control-flow catches real issues
      'sonarjs/no-undefined-assignment': 'off', // TS uses undefined for optional properties (idiomatic)

      // Issue #1569c: Misfit SonarJS style rules turned off as documented noise.
      // These rules either conflict with Prettier, are pure stylistic preference,
      // or produce high false-positive rates with no correctness value for this codebase.
      'sonarjs/arrow-function-convention': 'off', // Conflicts with Prettier parens handling
      'sonarjs/no-duplicate-string': 'off', // 3-occurrence threshold produces pure noise
      'sonarjs/shorthand-property-grouping': 'off', // Pure ordering preference, no correctness value
      'sonarjs/elseif-without-else': 'off', // Pure style; conflicts with early-return pattern
      'sonarjs/max-union-size': 'off', // Discriminated unions legitimately exceed arbitrary limit
      'sonarjs/no-alphabetical-sort': 'off', // Heuristic is false-positive prone on typed arrays
      'sonarjs/prefer-regexp-exec': 'off', // String.match and RegExp.exec are both idiomatic
      'sonarjs/function-name': 'off', // Conflicts with TS class/method naming conventions
      'sonarjs/prefer-immediate-return': 'off', // Named intermediates improve readability/debuggability
      'sonarjs/pseudo-random': 'off', // CLI context: Math.random for IDs/jitter, not cryptography

      // Issue #2079: ESLint directive comments are policy controls, not code fixes.
      ...Object.fromEntries(
        Object.entries(eslintComments.configs.recommended.rules ?? {}).map(
          ([rule, config]) => [rule, Array.isArray(config) ? ['error', ...config.slice(1)] : 'error'],
        ),
      ),
      'eslint-comments/no-use': [
        'error',
        {
          allow: ['eslint-env', 'global', 'globals', 'exported'],
        },
      ],

      // --- End strict rules ---

      // Additional React-specific rules to prevent infinite loops
      'react-hooks/exhaustive-deps': [
        'error',
        {
          additionalHooks: '(useStateAndRef|useStableCallback|useStableGetter)',
        },
      ],
      'react/jsx-no-bind': [
        'error',
        {
          ignoreDOMComponents: false,
          ignoreRefs: true,
          allowArrowFunctions: false,
          allowFunctions: false,
          allowBind: false,
        },
      ],
      'react/jsx-no-constructed-context-values': 'error',
    },
  },

  // Issue #2079 temporary legacy directive scope.
  // Existing package code still contains inline ESLint directives and is burned
  // down by #2081-#2092. The CI guard added for #2080 blocks new directives in
  // diffs immediately; each cleanup issue removes or narrows this override for
  // its scope before fixing that scope.
  {
    files: legacyDirectiveCleanupScopes,
    linterOptions: {
      reportUnusedDisableDirectives: 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
    },
    rules: {
      'eslint-comments/disable-enable-pair': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-aggregating-enable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-duplicate-disable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-restricted-disable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-unlimited-disable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-unused-disable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-unused-enable': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/no-use': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
      'eslint-comments/require-description': 'off', // eslint-policy-allow-off: #2079 temporary #2081-#2092
    },
  },


  // Completed cleanup scopes stay locked against inline ESLint directives even
  // while remaining files still use temporary legacy directive overrides.
  {
    files: completedDirectiveCleanupScopes,
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'eslint-comments/no-use': 'error',
    },
  },
  // extra settings for scripts that we run directly with node
  // Issue #2079 temporary warning burn-down scopes. These were warning-only
  // before lint:ci started using --max-warnings 0 and are assigned to existing
  // cleanup areas instead of being left as warnings.
  {
    files: ['packages/cli/src/ui/**/*.{ts,tsx}'],
    rules: {
      'react/jsx-no-bind': 'off', // eslint-policy-allow-off: #2079 temporary #2087
    },
  },
  {
    files: [
      'packages/core/src/config/subagentManager.ts',
      'packages/core/src/skills/skillManager.ts',
      'packages/telemetry/src/debug/**/*.ts',
    ],
    rules: {
      'no-console': 'off', // eslint-policy-allow-off: #2079 temporary #2082/#2089
    },
  },
  {
    files: ['./scripts/**/*.js', './scripts/**/*.mjs', 'esbuild.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Debug infrastructure files ARE the logger — they must use console directly
  {
    files: ['packages/core/src/debug/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // CLI extension commands produce user-facing stdout/stderr output
  {
    files: [
      'packages/cli/src/commands/extensions/*.ts',
      'packages/cli/src/config/extension.ts',
    ],
    rules: {
      'no-console': 'off',
    },
  },
  // Vitest test configuration
  {
    // Prevent self-imports in packages
    files: ['packages/core/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@google/gemini-cli-core',
          message: 'Please use relative imports within the @google/gemini-cli-core package.',
        },
      ],
    },
  },
  {
    files: ['packages/cli/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          name: '@google/gemini-cli',
          message: 'Please use relative imports within the @google/gemini-cli package.',
        },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
    plugins: {
      vitest,
    },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-commented-out-tests': 'off',
      'vitest/no-disabled-tests': 'off',
      'vitest/no-standalone-expect': [
        'error',
        {
          additionalTestBlockFunctions: ['itProp'],
        },
      ],

      // Stricter vitest rules (warnings for now)
      // fast-check's `fc.assert` is a real assertion helper; tests using
      // `fc.assert(fc.property(...))` do assert but use no literal `expect`.
      'vitest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'fc.assert'] },
      ],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/max-nested-describe': ['error', { max: 3 }],
      'vitest/require-top-level-describe': 'error',

      // Relax complexity rules for test files
      'max-lines-per-function': 'off',

      // Test files use `typeof import('pkg')` for vi mock typing; it's idiomatic.
      '@typescript-eslint/consistent-type-imports': 'off',

    },
  },
  // ============================================================================
  // Issue #1569: Batch BN4C - no-unnecessary-condition enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: [
      'packages/a2a-server/src/agent/executor.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      '@typescript-eslint/no-unnecessary-condition': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 BN4C
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch BN4D - strict-boolean-expressions enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: [
      'packages/a2a-server/src/config/config.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 BN4D
  // ============================================================================
  // ============================================================================
  // Issue #1569: Batch C5A - max-lines-per-function enforcement
  // ============================================================================
  // Promote this rule from warn to error for the specific batch scope.
  {
    files: ['packages/a2a-server/src/agent/executor.ts'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // ============================================================================
  // End Issue #1569 C5A
  // Issue #1569: Batch S6B - sonarjs/no-ignored-exceptions enforcement
  // ============================================================================
  // Ensure catch blocks handle errors rather than silently ignoring them.
  {
    files: [
      'packages/a2a-server/src/agent/executor.ts',
      'packages/a2a-server/src/agent/task.ts',
    ],
    rules: {
      'sonarjs/no-ignored-exceptions': 'error',
    },
  },
  // ============================================================================
  // End Issue #1569 S6B
  // Issue #1576: Enforce strict line-limit errors on AppContainer module files.
  // These files are being decomposed; error-level rules catch regressions during
  // and after the decomposition. Test files are excluded (they already have
  // max-lines-per-function: 'off' via the vitest block above).
  {
    files: [
      'packages/cli/src/ui/AppContainerRuntime.tsx',
      'packages/cli/src/ui/containers/AppContainer/**/*.ts',
      'packages/cli/src/ui/containers/AppContainer/**/*.tsx',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Settings for eslint-rules directory
  {
    files: ['./eslint-rules/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/vscode-ide-companion/esbuild.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Settings for CommonJS scripts
  {
    files: ['./scripts/**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
  // Examples should have access to standard globals like fetch
  {
    files: ['packages/cli/src/commands/extensions/examples/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        fetch: 'readonly',
      },
    },
  },
  // extra settings for scripts that we run directly with node
  {
    files: ['packages/vscode-ide-companion/scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // extra settings for scripts that we run directly with node
  {
    files: ['packages/agents/scripts/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
  // ============================================================================
  // Issue #1577: text-buffer.ts decomposition - Architecture Enforcement
  // ============================================================================

  // Domain modules must be pure (no React, no side effects)
  {
    files: [
      'packages/cli/src/ui/components/shared/buffer-types.ts',
      'packages/cli/src/ui/components/shared/word-navigation.ts',
      'packages/cli/src/ui/components/shared/buffer-operations.ts',
      'packages/cli/src/ui/components/shared/transformations.ts',
      'packages/cli/src/ui/components/shared/visual-layout.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'Domain modules must be pure. React only allowed in text-buffer.ts',
            },
            {
              name: '@vybestack/llxprt-code-core',
              importNames: ['debugLogger'],
              message:
                'Domain modules must be side-effect free. No logging.',
            },
          ],
          patterns: [
            {
              group: ['node:fs', 'node:child_process', 'node:os'],
              message:
                'Domain modules must be pure. No Node.js I/O modules.',
            },
          ],
        },
      ],
      complexity: ['error', 25],
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // vim-buffer-actions.ts specific restrictions
  {
    files: ['packages/cli/src/ui/components/shared/vim-buffer-actions.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './text-buffer.js',
              message:
                'Import from buffer-types, buffer-operations, or word-navigation directly',
            },
            {
              name: './buffer-reducer.js',
              message:
                'vim-buffer-actions must not import buffer-reducer (creates cycle)',
            },
            {
              name: 'react',
              message: 'vim-buffer-actions must be pure logic. No React.',
            },
          ],
          patterns: [
            {
              group: ['**/shared/text-buffer.js'],
              message: 'Import from specific module, not text-buffer.js',
            },
          ],
        },
      ],
      complexity: ['error', 25],
      'max-lines-per-function': ['error', 80],
    },
  },

  // buffer-reducer.ts specific restrictions
  {
    files: ['packages/cli/src/ui/components/shared/buffer-reducer.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'buffer-reducer must be pure logic. No React.',
            },
          ],
        },
      ],
      complexity: ['error', 25],
      'max-lines-per-function': ['error', 80],
    },
  },

  // text-buffer.ts size limits (React allowed here only)
  // useTextBuffer is a React hook composition root; its size comes from
  // useCallback/useMemo declarations, not from logic complexity.
  {
    files: ['packages/cli/src/ui/components/shared/text-buffer.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // Migration: Warn on utility imports from text-buffer.js in CLI src
  {
    files: ['packages/cli/src/**/*.ts', 'packages/cli/src/**/*.tsx'],
    ignores: [
      'packages/cli/src/ui/components/shared/text-buffer.ts',
      'packages/cli/src/ui/components/shared/text-buffer.test.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [],
          patterns: [
            {
              group: ['**/shared/text-buffer.js'],
              importNames: [
                'offsetToLogicalPos',
                'logicalPosToOffset',
                'textBufferReducer',
                'pushUndo',
                'replaceRangeInternal',
                'findNextWordStartInLine',
                'findPrevWordStartInLine',
                'findWordEndInLine',
                'getPositionFromOffsets',
                'getLineRangeOffsets',
              ],
              message:
                'Import from buffer-operations.js, word-navigation.js, or buffer-types.js directly. See Issue #1577.',
            },
          ],
        },
      ],
    },
  },
  // ============================================================================
  // End Issue #1577
  // ============================================================================

  // ============================================================================
  // Issue #1581: subagent.ts decomposition - Size enforcement
  // ============================================================================
  //
  // Error-level max-lines and max-lines-per-function rules on the four new
  // modules ensure they never grow past their design targets. The coordinator
  // file (subagent.ts) was promoted from 'warn' to 'error' in Phase 5 (Issue
  // #1915) once the file was thin enough to comply. These rules target files
  // that don't exist yet — ESLint silently ignores unmatched globs, so CI
  // stays green during Phase 0.
  {
    files: [
      'packages/core/src/core/subagentTypes.ts',
      'packages/core/src/core/subagentRuntimeSetup.ts',
      'packages/core/src/core/subagentToolProcessing.ts',
      'packages/core/src/core/subagentExecution.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // subagent.ts coordinator: promoted from warn to error in Phase 5 (Issue #1915)
  {
    files: ['packages/core/src/core/subagent.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Enforce execution -> runtimeSetup dependency boundary.
  // subagentExecution.ts must not import from subagentRuntimeSetup.js.
  // All runtime artifacts must be passed as parameters by the coordinator.
  // See project-plans/issue1581/README.md §Dependency Graph.
  {
    files: ['packages/core/src/core/subagentExecution.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './subagentRuntimeSetup.js',
              message:
                'subagentExecution must not import from subagentRuntimeSetup. ' +
                'All runtime artifacts must be passed as parameters by the coordinator (subagent.ts). ' +
                'See project-plans/issue1581/README.md §Dependency Graph.',
            },
          ],
        },
      ],
    },
  },
  // ============================================================================
  // End Issue #1581
  // ============================================================================

  // Issue #2081/#2082: Security credential-detection regex patterns.
  // These are intentionally crafted to scan environment variables for secrets
  // (credentials in URLs, JWT tokens). The sonarjs/regular-expr rule is a
  // generic safety heuristic that cannot distinguish "validating untrusted
  // input" from "scanning for secrets". The patterns are already bounded with
  // explicit quantifiers to prevent ReDoS.
  {
    files: ['packages/core/src/services/environmentSanitization.ts'],
    rules: {
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2081/#2082 security credential-detection regex
    },
  },

  // Prettier config must be last
  prettierConfig,
  // extra settings for scripts that we run directly with node
  {
    files: ['./integration-tests/**/*.js', './test-*.js', './test-*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Custom eslint rules for this repo
  {
    files: ['packages/**/*.{js,jsx,ts,tsx}'],
    plugins: {
      custom: {
        rules: {
          'react-render-safety': reactRenderSafety,
          'no-inline-deps': noInlineDeps,
          'ink-text-color-required': inkTextColorRequired,
        },
      },
    },
    rules: {
      // Custom rules
      // 'custom/react-render-safety': 'error', // TODO: Fix for ESLint 9 API
      'custom/no-inline-deps': 'error',
      'custom/ink-text-color-required': 'error',
    },
  },
  // License header configuration
  {
    files: ['./**/*.{tsx,ts,js}'],
    plugins: {
      headers,
    },
    rules: {
      'headers/header-format': 'off',
    },
  },
  // ============================================================================
  // Issue #1584: Provider test strict-boolean-expressions relaxation
  // ============================================================================
  // Providers test files were moved from packages/core/src/providers/ to
  // packages/providers/src/ as part of the provider extraction. The old
  // test location had strict-boolean-expressions off for test files via the
  // core/providers test exemptions. The new location picks up the full
  // strict rule (allowAny: false), which flags common test patterns like
  // .filter(x => x.someProperty) where the property type includes `any`.
  // Disabling to error level for provider test files preserves the prior
  // behavior without weakening production provider auth anti-pattern rules.
  {
    files: ['packages/providers/src/**/*.{test,spec}.ts'],
    rules: {
      '@typescript-eslint/strict-boolean-expressions': 'off',
    },
  },
  // Provider authentication anti-patterns
  {
    files: ['packages/core/src/providers/**/*.ts'],
    ignores: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/integration/**',
    ],
    rules: {
      // Prevent direct process.env reads for API keys and key storage in provider files
      // Extends base no-restricted-syntax rules (require/throw) with provider-specific rules
      'no-restricted-syntax': [
        'error',
        // Base rules from main config
        {
          selector: 'CallExpression[callee.name="require"]',
          message: 'Avoid using require(). Use ES6 imports instead.',
        },
        {
          selector: 'ThrowStatement > Literal:not([value=/^\\w+Error:/])',
          message:
            'Do not throw string literals or non-Error objects. Throw new Error("...") instead.',
        },
        // Provider-specific rules
        {
          // Only flag auth-related env var reads (API_KEY, API_TOKEN, etc.)
          // Allows legitimate reads of NODE_ENV, user-agent, etc.
          selector:
            'MemberExpression[object.object.name="process"][object.property.name="env"][property.name=/.*((API|AUTH).*KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS).*/i]',
          message:
            'Do not read API keys from process.env directly in providers. Use authResolver.resolveAuthentication() instead.',
        },
        {
          selector: 'PropertyDefinition[key.name=/.*[Kk]ey.*/][value]',
          message:
            'Providers should not store API keys directly. Use authResolver for stateless auth.',
        },
      ],
    },
  },
  // Issue #2088: tools package lint cleanup complete.
  // The blanket #1585 migration suppression was removed after all inline
  // directives and lint violations were resolved. sonarjs/os-command and
  // sonarjs/no-os-command-from-path remain off project-wide (see global rules).

  // Issue #2088: The "todo" subsystem naturally uses the domain word "todo" in
  // comments (todo store, todo tools, ITodoService, etc.). sonarjs/todo-tag
  // matches case-insensitively, producing false positives on legitimate domain
  // vocabulary rather than actual TODO task markers.
  {
    files: [
      'packages/tools/src/interfaces/ITodoService.ts',
      'packages/tools/src/tools/todo-*.ts',
      'packages/tools/src/utils/todo*.ts',
      'packages/tools/src/__tests__/todo-*.ts',
    ],
    rules: {
      'sonarjs/todo-tag': 'off', // eslint-policy-allow-off: #2088 domain vocabulary
    },
  },
  // Issue #2088: EmojiFilter uses inherently complex Unicode emoji range regexes
  // that are safe but exceed SonarJS regex-complexity heuristics, analogous to
  // ANSI/terminal control-character parsing.
  {
    files: ['packages/tools/src/utils/EmojiFilter.ts'],
    rules: {
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2088 emoji Unicode ranges
    },
  },
  // Issue #2088: IToolMessageBus is a cross-package bridge interface consumed
  // by core, mcp, and agents. Its `any` types serve as forward-compatible duck-
  // typing escape hatches for implementations with heterogeneous signatures.
  {
    files: ['packages/tools/src/interfaces/IToolMessageBus.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // eslint-policy-allow-off: #2088 cross-package bridge
    },
  },
  // Issue #2088: schemaValidator uses ajv subpath import (ajv/dist/2020.js)
  // which is the only supported way to load draft-2020-12 per ajv docs.
  // The `any` cast is required for ajv's ESM/CJS interop default resolution.
  {
    files: ['packages/tools/src/utils/schemaValidator.ts'],
    rules: {
      'import/no-internal-modules': 'off', // eslint-policy-allow-off: #2088 ajv subpath
      '@typescript-eslint/no-explicit-any': 'off', // eslint-policy-allow-off: #2088 ajv interop
    },
  },
  {
    files: [
      'packages/tools/src/**/*.{test,spec}.{ts,tsx}',
      'packages/providers/src/__tests__/tools-formatting.test.ts',
    ],
    rules: {
      'vitest/no-conditional-expect': 'off',
      'vitest/no-conditional-in-test': 'off',
      'vitest/prefer-strict-equal': 'off',
    },
  },
  // Issue #2088: tools.ts defines abstract base classes (BaseDeclarativeTool,
  // BaseToolInvocation) whose `any` return/parameter types serve as cross-
  // package compatibility bridges for subclasses in core, mcp, and agents.
  {
    files: ['packages/tools/src/tools/tools.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', // eslint-policy-allow-off: #2088 cross-package bridge
    },
  },
  {
    files: [
      'packages/core/src/tools-adapters/**/*.{ts,tsx}',
      'packages/core/src/config/lspIntegration.ts',
      'packages/core/src/runtime/contracts/boundary-guards.test.ts',
    ],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/strict-boolean-expressions': 'off',
      'default-case': 'off',
      'sonarjs/nested-control-flow': 'off',
      'sonarjs/no-nested-conditional': 'off',
    },
  },
  {
    files: [
      'packages/core/src/agents/executor.ts',
      'packages/core/src/core/TodoContinuationService.test.ts',
    ],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
);
