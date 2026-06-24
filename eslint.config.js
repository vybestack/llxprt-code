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
  // #2083 completed files are locked in completedDirectiveCleanupScopes below.
  // #2116: provider module entries removed after directive cleanup.
  // packages/agents/src is locked in completedDirectiveCleanupScopes (#2117).
  'packages/cli/src/**/*.{ts,tsx}', // #2086/#2091 (#2087 files locked in completedDirectiveCleanupScopes)
  'packages/policy/src/**/*.{ts,tsx}', // #2089 not yet decomposed
  'packages/storage/src/**/*.{ts,tsx}', // #2092
  // #2089 scope: the five target packages (settings/telemetry/
  // ide-integration/a2a-server) still contain other files with legacy
  // inline lint directives. Those packages are kept in legacy scope so
  // existing directives do not break lint. The target files and extracted
  // modules are locked in completedDirectiveCleanupScopes below, which
  // overrides this block for those specific files.
  // packages/auth/src is locked in completedDirectiveCleanupScopes (#2121).
  'packages/settings/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/telemetry/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/ide-integration/src/**/*.{ts,tsx}', // #2089 (non-target files)
  'packages/a2a-server/src/**/*.{ts,tsx}', // #2089 (non-target files)
];

const completedDirectiveCleanupScopes = [
  'packages/tools/src/**/*.{ts,tsx}', // #2088
  // #2116: provider module entries removed; the global package source rule
  // enforces eslint-comments/no-use and unused-disable reporting.
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
  // #2116: #2084 provider entries removed — covered by global rule block.
  // #2118 scope — all remaining mcp source/test files are fully compliant:
  // zero inline lint directives. Locked to error so any new directive fails
  // immediately. The broad mcp legacy entry has been removed entirely.
  'packages/mcp/src/**/*.{ts,tsx}', // #2118
  // #2087 scope — packages/cli UI hooks, components, utils, state, themes,
  // and Zed integration are fully compliant: zero inline lint directives.
  // Locked to error so any new directive fails immediately.
  'packages/cli/src/ui/components/shared/text-buffer.ts', // #2087
  'packages/cli/src/ui/hooks/atCommandProcessor.ts', // #2087
  'packages/cli/src/ui/hooks/keyToAnsi.ts', // #2087
  'packages/cli/src/ui/hooks/useProfileManagement.ts', // #2087
  'packages/cli/src/ui/hooks/usePromptCompletion.ts', // #2087
  'packages/cli/src/ui/hooks/vim.ts', // #2087
  'packages/cli/src/ui/state/extensions.ts', // #2087
  'packages/cli/src/ui/themes/theme.ts', // #2087
  'packages/cli/src/ui/utils/responsive.ts', // #2087
  'packages/cli/src/ui/utils/secureInputHandler.ts', // #2087
  'packages/cli/src/ui/utils/terminalSetup.ts', // #2087
  'packages/cli/src/utils/formatRelativeTime.ts', // #2087
  'packages/cli/src/utils/privacy/ConversationDataRedactor.ts', // #2087
  'packages/cli/src/utils/sandbox.ts', // #2087
  'packages/cli/src/zed-integration/zedIntegration.ts', // #2087
  // #2086 scope — ten target files and their extracted modules are fully
  // compliant: zero inline lint directives. Locked to error so any new
  // directive fails immediately. The broad 'packages/cli/src/**' entry in
  // legacyDirectiveCleanupScopes is retained for #2087/#2091; this block
  // overrides it for the completed #2086 files so directives are rejected.
  'packages/cli/src/config/profileRuntimeApplication.ts', // #2086
  'packages/cli/src/services/McpPromptLoader.ts', // #2086
  'packages/cli/src/services/mcpPromptArgParser.ts', // #2086
  'packages/cli/src/ui/commands/diagnosticsCommand.ts', // #2086
  'packages/cli/src/ui/commands/diagnosticsTokens.ts', // #2086
  'packages/cli/src/ui/commands/mcpCommand.ts', // #2086
  'packages/cli/src/ui/commands/mcpDisplay.ts', // #2086
  'packages/cli/src/ui/commands/mcpAuth.ts', // #2086
  'packages/cli/src/ui/commands/memoryCommand.ts', // #2086
  'packages/cli/src/ui/commands/profileCommand.ts', // #2086
  'packages/cli/src/ui/commands/profileLoadBalancer.ts', // #2086
  'packages/cli/src/ui/commands/profileLoad.ts', // #2086
  'packages/cli/src/ui/commands/profileSchemas.ts', // #2086
  'packages/cli/src/ui/commands/schema/index.ts', // #2086
  'packages/cli/src/ui/commands/schema/schemaHelpers.ts', // #2086
  'packages/cli/src/ui/commands/setCommand.ts', // #2086
  'packages/cli/src/ui/commands/setCommandSchema.ts', // #2086
  'packages/cli/src/ui/commands/statsCommand.ts', // #2086
  'packages/cli/src/ui/commands/statsQuota.ts', // #2086
  'packages/cli/src/ui/commands/todoCommand.ts', // #2086
  'packages/cli/src/ui/commands/todoOperations.ts', // #2086
  'packages/cli/src/ui/commands/todoFormatters.ts', // #2086
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
  // #2117 — all packages/agents/src files are now fully compliant: zero inline
  // lint directives. The broad glob below supersedes the individual #2090
  // entries above. Locked to error so any new directive fails immediately.
  'packages/agents/src/**/*.{ts,tsx}', // #2117
  // #2121 — all packages/auth/src files are now fully compliant: zero inline
  // lint directives. Locked to error so any new directive fails immediately.
  'packages/auth/src/**/*.{ts,tsx}', // #2121
  // #2091 packages/cli test cleanup — target files (and extracted helpers)
  // are fully compliant: zero inline lint directives. Locked to error so any
  // new directive fails immediately while the rest of packages/cli remains in
  // legacy cleanup scope for #2086/#2087.
  'packages/cli/src/config/__tests__/profileBootstrap.test.ts', // #2091
  'packages/cli/src/config/__tests__/profileBootstrap.part2.test.ts', // #2091
  'packages/cli/src/config/__tests__/profileBootstrap.part3.test.ts', // #2091
  'packages/cli/src/config/__tests__/profileBootstrap.part4.test.ts', // #2091
  'packages/cli/src/config/config.test.ts', // #2091
  'packages/cli/src/config/config.part2.test.ts', // #2091
  'packages/cli/src/config/config.part3.test.ts', // #2091
  'packages/cli/src/config/config.part4.test.ts', // #2091
  'packages/cli/src/config/extension.test.ts', // #2091
  'packages/cli/src/config/extension.part2.test.ts', // #2091
  'packages/cli/src/config/extension.part3.test.ts', // #2091
  'packages/cli/src/config/extension.part4.test.ts', // #2091
  'packages/cli/src/config/settings.test.ts', // #2091
  'packages/cli/src/config/settings.part2.test.ts', // #2091
  'packages/cli/src/config/settings.part3.test.ts', // #2091
  'packages/cli/src/config/settings.part4.test.ts', // #2091
  'packages/cli/src/config/settings.part5.test.ts', // #2091
  'packages/cli/src/config/settings.part6.test.ts', // #2091
  'packages/cli/src/config/settings.part7.test.ts', // #2091
  'packages/cli/src/integration-tests/cli-args.integration.test.ts', // #2091
  'packages/cli/src/integration-tests/cli-args.profile-flag.integration.test.ts', // #2091
  'packages/cli/src/integration-tests/cli-args-test-helpers.ts', // #2091
  'packages/cli/src/services/__tests__/performResume.spec.ts', // #2091
  'packages/cli/src/services/__tests__/performResume.property.spec.ts', // #2091
  'packages/cli/src/services/__tests__/performResume.swap.spec.ts', // #2091
  'packages/cli/src/services/__tests__/performResume-test-helpers.ts', // #2091
  'packages/cli/src/services/FileCommandLoader.test.ts', // #2091
  'packages/cli/src/services/FileCommandLoader.processors.test.ts', // #2091
  'packages/cli/src/ui/commands/diagnosticsCommand.spec.ts', // #2091
  'packages/cli/src/ui/commands/diagnosticsCommand.edges.spec.ts', // #2091
  'packages/cli/src/ui/commands/diagnosticsCommand-test-helpers.ts', // #2091
  'packages/cli/src/ui/commands/mcpCommand.test.ts', // #2091
  'packages/cli/src/ui/commands/mcpCommand.schema-edge.test.ts', // #2091
  'packages/cli/src/ui/commands/mcpCommand.auth-refresh.test.ts', // #2091
  'packages/cli/src/ui/commands/todoCommand.test.ts', // #2091
  'packages/cli/src/ui/commands/todoCommand.disk-set.test.ts', // #2091
  'packages/cli/src/ui/commands/todoCommand.list-parse-property.test.ts', // #2091
  'packages/cli/src/ui/components/shared/golden-snapshot.test.ts', // #2091
  'packages/cli/src/ui/components/shared/text-buffer.test.ts', // #2091
  'packages/cli/src/ui/components/shared/text-buffer.part2.test.ts', // #2091
  'packages/cli/src/ui/components/shared/text-buffer.part3.test.ts', // #2091
  'packages/cli/src/ui/components/shared/text-buffer.part4.test.ts', // #2091
  'packages/cli/src/ui/components/shared/text-buffer.part5.test.ts', // #2091
  'packages/cli/src/ui/components/shared/vim-buffer-actions.test.ts', // #2091
  'packages/cli/src/ui/components/shared/vim-buffer-actions.insert-change.test.ts', // #2091
  'packages/cli/src/ui/components/shared/vim-buffer-actions-test-helpers.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.spec.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.part2.spec.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.part3.spec.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.part4.spec.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.part5.spec.ts', // #2091
  'packages/cli/src/ui/hooks/__tests__/useSessionBrowser.part6.spec.ts', // #2091
  'packages/cli/src/ui/hooks/atCommandProcessor.test.ts', // #2091
  'packages/cli/src/ui/hooks/atCommandProcessor.filtering.test.ts', // #2091
  'packages/cli/src/ui/hooks/atCommandProcessor.punctuation.test.ts', // #2091
  'packages/cli/src/ui/hooks/atCommandProcessor-test-helpers.ts', // #2091
  'packages/cli/src/ui/hooks/useAtCompletion.test.ts', // #2091
  'packages/cli/src/ui/hooks/useAtCompletion.subagent.test.ts', // #2091
  'packages/cli/src/ui/hooks/useAtCompletion-test-helpers.ts', // #2091
  'packages/cli/src/ui/hooks/useSlashCompletion.test.ts', // #2091
  'packages/cli/src/ui/hooks/useSlashCompletion.part2.test.ts', // #2091
  'packages/cli/src/ui/hooks/useSlashCompletion.part3.test.ts', // #2091
  'packages/cli/src/ui/hooks/useSlashCompletion.part4.test.ts', // #2091
  'packages/cli/src/ui/hooks/useToolScheduler.test.ts', // #2091
  'packages/cli/src/ui/hooks/useToolScheduler.part2.test.ts', // #2091
  'packages/cli/src/ui/hooks/useToolScheduler.part3.test.ts', // #2091
  'packages/cli/src/ui/hooks/useToolScheduler.part4.test.ts', // #2091
  'packages/cli/src/ui/hooks/useToolScheduler.part5.test.ts', // #2091
  'packages/cli/src/utils/sessionCleanup.test.ts', // #2091
  'packages/cli/src/utils/sessionCleanup.config.test.ts', // #2091
  'packages/cli/src/utils/sessionCleanup-test-helpers.ts', // #2091
  'packages/agents/src/agents/executor.ts', // #2085
  'packages/agents/src/compression/HighDensityStrategy.ts', // #2085
  'packages/agents/src/core/bucketFailoverIntegration.ts', // #2085
  'packages/agents/src/core/chatSession.ts', // #2085
  'packages/agents/src/core/clientHelpers.ts', // #2085
  'packages/agents/src/core/DirectMessageProcessor.ts', // #2085
  'packages/agents/src/core/MessageConverter.ts', // #2085
  'packages/agents/src/core/StreamProcessor.ts', // #2085
  'packages/agents/src/core/subagent.ts', // #2085
  'packages/agents/src/core/subagentOrchestrator.ts', // #2085
  'packages/agents/src/core/subagentToolProcessing.ts', // #2085
  'packages/agents/src/core/TurnProcessor.ts', // #2085
  'packages/agents/src/tools/task.ts', // #2085
  // #2085 decomposition helpers extracted from the files above; keep locked so
  // no inline disables can be reintroduced in the new modules.
  'packages/agents/src/agents/executor-stream-processor.ts', // #2085
  'packages/agents/src/agents/executor-tool-dispatch.ts', // #2085
  'packages/agents/src/agents/recovery.ts', // #2085
  'packages/agents/src/core/CompressionLoadBalancingProvider.ts', // #2085
  'packages/agents/src/core/CompressionProfileResolver.ts', // #2085
  'packages/agents/src/core/streamRequestHelpers.ts', // #2085
  'packages/agents/src/core/streamResponseHelpers.ts', // #2085
  'packages/agents/src/core/subagentNonInteractive.ts', // #2085
  'packages/agents/src/tools/taskAbortHelpers.ts', // #2085
  'packages/agents/src/tools/taskAsyncExecution.ts', // #2085
  'packages/agents/src/tools/taskResultHelpers.ts', // #2085
  'packages/agents/src/tools/taskToolGovernance.ts', // #2085
  'packages/mcp/src/auth/oauthProviderTestSetup.ts', // #2092
  'packages/mcp/src/auth/oauth-provider.authenticate.test.ts', // #2092
  'packages/mcp/src/auth/oauth-provider.token.test.ts', // #2092
  'packages/mcp/src/client/mcpClientTestHelpers.ts', // #2092
  'packages/mcp/src/client/mcp-client.discovery.test.ts', // #2092
  'packages/mcp/src/client/mcp-client.lifecycle.test.ts', // #2092
  'packages/mcp/src/client/mcp-client.tools.test.ts', // #2092
  'packages/mcp/src/client/mcp-client.transport.test.ts', // #2092
  'packages/mcp/src/client/mcp-client.oauth.test.ts', // #2092
  'packages/mcp/src/client/mcp-tool.execute.test.ts', // #2092
  'packages/mcp/src/client/mcp-tool.confirm.test.ts', // #2092
  'packages/storage/src/secure-store/secure-store.basic.test.ts', // #2092
  'packages/storage/src/secure-store/secure-store.fallback2.test.ts', // #2092
  'packages/storage/src/secure-store/secure-store.fallback.test.ts', // #2092
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
      '.worktrees/**',
      '.integration-tests/**',
      'eslint.config.js',
      'packages/**/dist/**',
      'bundle/**',
      'packages/cli/src/test-*.ts',
      'packages/cli/src/test-*.tsx',
      'packages/cli/src/debug-*.ts',
      'packages/cli/src/debug-*.tsx',
      'packages/cli/src/generated/**',
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
            'ajv/dist/2020.js',
            '**/generated/**',
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
      // Issue #2113: sonarjs/regular-expr is a deprecated, non-recommended
      // blanket review heuristic for ordinary regex usage. Keep targeted regex
      // correctness and ReDoS rules enabled where they provide actionable
      // signal rather than source-level suppression comments.
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2113 deprecated blanket regex heuristic
      'sonarjs/slow-regex': 'error',
      'sonarjs/no-invalid-regexp': 'error',
      'sonarjs/stateful-regex': 'error',
      'sonarjs/unicode-aware-regex': 'error',
      'sonarjs/no-regex-spaces': 'error',
      'no-control-regex': 'error',
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
    files: ['packages/telemetry/src/debug/**/*.ts'],
    rules: {
      'no-console': 'off', // eslint-policy-allow-off: #2079 temporary #2089
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
      // @fast-check/vitest exports both `it` and `test`, each augmented with
      // `.prop`. All four variants are real test-block functions. `itProp` is
      // the common alias for fast-check's `it` (used across many test files);
      // `itProp.prop` is the corresponding property variant.
      'vitest/no-standalone-expect': [
        'error',
        {
          additionalTestBlockFunctions: [
            'it',
            'itProp',
            'itProp.prop',
            'it.prop',
            'testProp',
            'test.prop',
          ],
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


  // Issue #2087: Static, reviewed regex patterns that parse terminal/command
  // input at trusted boundaries. The inputs are bounded (single CLI command
  // lines or local config values, not untrusted network data) and the patterns
  // are anchored with explicit quantifiers. sonarjs/regular-expr and
  // sonarjs/slow-regex are generic heuristics that cannot distinguish these
  // bounded parsing cases from ReDoS-vulnerable network input validation.
  {
    files: [
      'packages/cli/src/ui/utils/secureInputHandler.ts',
      'packages/cli/src/ui/utils/terminalSetup.ts',
      'packages/cli/src/utils/privacy/ConversationDataRedactor.ts',
      'packages/cli/src/utils/sandbox-env.ts',
      'packages/cli/src/zed-integration/zed-path-resolver.ts',
    ],
    rules: {
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2087 trusted-boundary input parsing
      'sonarjs/slow-regex': 'off', // eslint-policy-allow-off: #2087 trusted-boundary input parsing
    },
  },

  // Issue #2086: MCP prompt argument parsing regexes. These patterns parse
  // double-quoted strings with escape sequences (\.) for CLI prompt
  // arguments. The sonarjs regular-expr/slow-regex heuristics flag the
  // alternation-with-backreference structure, but the patterns operate on
  // bounded single-line user input with explicit non-overlapping alternation
  // branches that prevent catastrophic backtracking.
  {
    files: ['packages/cli/src/services/mcpPromptArgParser.ts'],
    rules: {
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2086 quoted-string arg parsing
      'sonarjs/slow-regex': 'off', // eslint-policy-allow-off: #2086 quoted-string arg parsing
    },
  },
  // Issue #2086: position/range argument parsing regexes in todoOperations.
  // These parse user-supplied positional numbers (e.g. "1", "1.2", "2-5")
  // and are anchored with ^...$; inputs are bounded single-line tokens.
  {
    files: ['packages/cli/src/ui/commands/todoOperations.ts'],
    rules: {
      'sonarjs/regular-expr': 'off', // eslint-policy-allow-off: #2086 position arg parsing
      'sonarjs/slow-regex': 'off', // eslint-policy-allow-off: #2086 position arg parsing
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
  // ============================================================================
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
);
