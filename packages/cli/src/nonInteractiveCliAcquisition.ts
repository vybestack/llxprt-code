/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core';
import { createSessionMetrics } from '@vybestack/llxprt-code-telemetry';
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
} from './nonInteractiveBindings.js';
import {
  getActiveProviderNameForApiError,
  getErrorFallbackModel,
} from './utils/apiErrorFormatting.js';
import {
  resolveContentPrefixIdentity,
  createCliModelIdentityRuntime,
} from './ui/utils/modelIdentity.js';
import { reportUnconfiguredProviderError } from './unconfiguredProviderGuard.js';

export function acquireNonInteractiveRun(
  config: Config,
  hasSettings: boolean,
  readEmojiMode: () => unknown,
  flush: () => void | Promise<void>,
  hasActiveProvider: () => boolean,
  isTrustedFolder: (() => boolean) | undefined,
  acquire: () => Promise<Agent>,
) {
  const host = new LocalNonInteractiveHost(
    config,
    hasSettings,
    readEmojiMode,
    flush,
    hasActiveProvider,
    isTrustedFolder,
    acquire,
  );
  return host.run.bind(host);
}
class LocalNonInteractiveHost {
  constructor(
    private readonly config: Config,
    private readonly hasSettings: boolean,
    private readonly readEmojiMode: () => unknown,
    private readonly flush: () => void | Promise<void>,
    private readonly hasActiveProvider: () => boolean,
    private readonly isTrustedFolder: (() => boolean) | undefined,
    private readonly acquire: () => Promise<Agent>,
  ) {}
  private async acquireTurn() {
    const config = this.config;
    const acquired = await this.acquire();
    return createHeadlessTurn(
      createHeadlessInput(
        () => config.getFileFilteringOptions(),
        () => config.getEnableRecursiveFileSearch(),
        (...args) => acquired.workspace.shouldIgnoreFile(...args),
        (...args) => acquired.workspace.shouldGitIgnoreFile(...args),
        (...args) => acquired.workspace.shouldLlxprtIgnoreFile(...args),
        (...args) => acquired.workspace.filterFiles(...args),
        (...args) => acquired.workspace.filterFilesWithReport(...args),
        (...args) => acquired.workspace.getGlobExcludes(...args),
        (...args) => acquired.workspace.getReadManyFilesExcludes(...args),
        () => acquired.workspace.getDirectories(),
        (path) => acquired.workspace.containsPath(path),
        (name) => acquired.tools.get(name),
        (server, uri) => acquired.mcp.readResource(server, uri),
        (identifier) => acquired.mcp.findResource(identifier),
      ),
      (query, options) => acquired.stream(query, options),
      () => config.getMaxSessionTurns(),
      () => config.getQuiet(),
      () => config.getSessionId(),
      () =>
        acquired.getEphemeralSetting('reasoning.includeInResponse') !== false,
      () =>
        resolveContentPrefixIdentity(
          createCliModelIdentityRuntime({
            getProvider: () => acquired.getProvider(),
            getModel: () => acquired.getModel(),
            getCurrentSequenceModel: () => acquired.getCurrentSequenceModel(),
            getActiveProfileName: () => acquired.getActiveProfileName(),
          }),
        ),
      () => acquired.metrics.getMetrics(),
      () => acquired.dispose(),
    );
  }
  async run(
    input: string,
    promptId: string,
    deferTelemetry = false,
  ): Promise<void> {
    const config = this.config;
    const run = createNonInteractiveRun(
      () => this.hasActiveProvider(),
      () => reportUnconfiguredProviderError(config),
      () => config.getOutputFormat(),
      () => config.getDebugMode(),
      () => config.getSessionId(),
      () => config.getModel(),
      createHeadlessFeedback(() => config.getDebugMode()),
      () => this.readEmojiMode(),
      resolveHeadlessSlash(
        this.hasSettings,
        createHeadlessCommandRun(
          createHeadlessCommandLoader(
            () => config.userCommandsDir,
            () => config.projectCommandsDir,
            () => config.getProjectRoot(),
            () => config.getExtensions(),
            () => config.getFolderTrust(),
            () => this.isTrustedFolder,
            () => config.getShellReplacement(),
            () => config.getExcludeTools(),
            () => config.getCoreTools(),
            () => config.getApprovalMode(),
            () => config.getShellExecutionConfig(),
            () => config.getTargetDir(),
            () => config.getShouldUseNodePtyShell(),
          ),
          () => config.getSessionId(),
          () => createSessionMetrics(),
        ),
      ),
      () => this.acquireTurn(),
      createHeadlessErrorReporter(
        () => getActiveProviderNameForApiError(config),
        (provider) => getErrorFallbackModel(config, provider),
      ),
      () => this.flush(),
    );
    return run(input, promptId, deferTelemetry);
  }
}
