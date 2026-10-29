/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  createNonInteractiveRun,
  createHeadlessTurn,
  createHeadlessInput,
  createHeadlessCommandRun,
  createHeadlessCommandLoader,
  resolveHeadlessSlash,
  createHeadlessFeedback,
  createHeadlessErrorReporter,
} from '../nonInteractiveBindings.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from '../utils/apiErrorFormatting.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from '../ui/utils/modelIdentity.js';
import { reportUnconfiguredProviderError } from '../unconfiguredProviderGuard.js';

export function captureNonInteractiveRun(
  config: Config,
  agent: Agent,
  hasSettings: boolean,
  flush: () => void | Promise<void>,
) {
  return createNonInteractiveRun(
    agent.hasActiveProvider,
    () => reportUnconfiguredProviderError(config),
    () => config.getOutputFormat(),
    () => config.getDebugMode(),
    () => config.getSessionId(),
    () => config.getModel(),
    createHeadlessFeedback(() => config.getDebugMode()),
    () => agent.getEphemeralSetting('emojifilter'),
    resolveHeadlessSlash(
      hasSettings,
      createHeadlessCommandRun(
        createHeadlessCommandLoader(
          () => config.userCommandsDir,
          () => config.projectCommandsDir,
          () => config.getProjectRoot(),
          () => config.getExtensions(),
          () => config.getFolderTrust(),
          () => agent.ide.isTrustedFolder.bind(agent.ide),
          () => config.getShellReplacement(),
          () => config.getExcludeTools(),
          () => config.getCoreTools(),
          () => config.getApprovalMode(),
          () => config.getShellExecutionConfig(),
          () => config.getTargetDir(),
          () => config.getShouldUseNodePtyShell(),
        ),
        () => config.getSessionId(),
        () => agent.metrics.getMetrics(),
      ),
    ),
    async () =>
      createHeadlessTurn(
        createHeadlessInput(
          () => config.getFileFilteringOptions(),
          () => config.getEnableRecursiveFileSearch(),
          (...args) => agent.workspace.shouldIgnoreFile(...args),
          (...args) => agent.workspace.shouldGitIgnoreFile(...args),
          (...args) => agent.workspace.shouldLlxprtIgnoreFile(...args),
          (...args) => agent.workspace.filterFiles(...args),
          (...args) => agent.workspace.filterFilesWithReport(...args),
          (...args) => agent.workspace.getGlobExcludes(...args),
          (...args) => agent.workspace.getReadManyFilesExcludes(...args),
          () => agent.workspace.getDirectories(),
          (path) => agent.workspace.containsPath(path),
          (name) => agent.tools.get(name),
          (server, uri) => agent.mcp.readResource(server, uri),
          (identifier) => agent.mcp.findResource(identifier),
        ),
        (query, options) => agent.stream(query, options),
        () => config.getMaxSessionTurns(),
        () => config.getQuiet(),
        () => config.getSessionId(),
        () =>
          agent.getEphemeralSetting('reasoning.includeInResponse') !== false,
        () =>
          resolveContentPrefixIdentity(
            createCliModelIdentityRuntime({
              getProvider: () => agent.getProvider(),
              getModel: () => agent.getModel(),
              getCurrentSequenceModel: () => agent.getCurrentSequenceModel(),
              getActiveProfileName: () => agent.getActiveProfileName(),
            }),
          ),
        () => agent.metrics.getMetrics(),
        async () => {},
      ),
    createHeadlessErrorReporter(
      () => getActiveProviderNameForApiError(config),
      (provider) => getErrorFallbackModel(config, provider),
    ),
    flush,
  );
}
