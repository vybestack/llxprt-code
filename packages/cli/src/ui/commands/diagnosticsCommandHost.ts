/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { KeychainTokenStorage } from '@vybestack/llxprt-code-mcp';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { RuntimeApi } from '../contexts/RuntimeContext.js';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import type { DiagnosticsCommandReads } from './diagnosticsCommand.js';
import { appendOAuthTokens } from './diagnosticsTokens.js';

export function bindDiagnosticsReads(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  agent: Agent | null,
  runtimeApi: RuntimeApi,
  oauth: OAuthControl,
): DiagnosticsCommandReads {
  return {
    isConfigured: config !== null,
    readSnapshot: () => runtimeApi.getRuntimeDiagnosticsSnapshot(),
    isOAuthAvailable: () => oauth.isAvailable(),
    readSessionBucket: (provider) => oauth.getSessionBucket(provider),
    readFailoverBuckets: () => config?.readFailoverBuckets?.() ?? [],
    readCurrentBucket: () => config?.readCurrentBucket?.(),
    readProviderName: () =>
      runtimeApi.providerStatus().providerName ?? undefined,
    readLoadBalancerStats: () => runtimeApi.getLoadBalancerStats(),
    readTokenAccounting: () => runtimeApi.getLoadBalancerTokenAccounting(),
    readSessionTokens: () => runtimeApi.getSessionTokenUsage(),
    readStaticInfo: () => {
      if (!config) throw new Error('Configuration not available');
      const { merged } = settings;
      return {
        workingDirectory: config.getWorkingDir(),
        debugMode: config.getDebugMode(),
        approvalMode: config.getApprovalMode(),
        theme: merged.ui.theme,
        defaultProfile: merged.defaultProfile,
        sandbox: merged.sandbox,
        ideMode: config.getIdeMode(),
        ideConnected: !!config.getIdeClient(),
        mcpServers: Object.keys(config.getMcpServers() ?? {}),
        mcpServerCommand: config.getMcpServerCommand(),
        userMemory: config.getUserMemory(),
        memoryFileCount: config.getLlxprtMdFileCount(),
        usageStatistics: merged.ui.usageStatisticsEnabled === true,
      };
    },
    listTools: () => {
      if (!agent) throw new Error('agent not available');
      return agent.tools.list();
    },
    appendTokens: (lines, logger) =>
      appendOAuthTokens(
        () =>
          new KeychainTokenStorage('llxprt-cli-mcp-oauth').getAllCredentials(),
        lines,
        logger,
        oauth,
      ),
  };
}
