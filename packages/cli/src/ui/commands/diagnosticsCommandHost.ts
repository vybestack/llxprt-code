/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GetLoadBalancerStatsOperation,
  type GetLoadBalancerTokenAccountingOperation,
  type GetRuntimeDiagnosticsSnapshotOperation,
  type GetSessionTokenUsageOperation,
  type ProviderStatusOperation,
} from '../contexts/RuntimeContext.js';

import { KeychainTokenStorage } from '@vybestack/llxprt-code-mcp';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { LoadedSettings } from '../../config/settings.js';

import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import type { DiagnosticsCommandReads } from './diagnosticsCommand.js';
import { appendOAuthTokens } from './diagnosticsTokens.js';

export function bindDiagnosticsReads(
  config: CliUiRuntime | null,
  settings: LoadedSettings,
  listTools: DiagnosticsCommandReads['listTools'],
  runtimeApiGetLoadBalancerStats: GetLoadBalancerStatsOperation,
  runtimeApiGetLoadBalancerTokenAccounting: GetLoadBalancerTokenAccountingOperation,
  runtimeApiGetRuntimeDiagnosticsSnapshot: GetRuntimeDiagnosticsSnapshotOperation,
  runtimeApiGetSessionTokenUsage: GetSessionTokenUsageOperation,
  runtimeApiProviderStatus: ProviderStatusOperation,
  oauth: OAuthControl,
): DiagnosticsCommandReads {
  return {
    isConfigured: config !== null,
    readSnapshot: () => runtimeApiGetRuntimeDiagnosticsSnapshot(),
    isOAuthAvailable: () => oauth.isAvailable(),
    readSessionBucket: (provider) => oauth.getSessionBucket(provider),
    readFailoverBuckets: () => config?.readFailoverBuckets?.() ?? [],
    readCurrentBucket: () => config?.readCurrentBucket?.(),
    readProviderName: () =>
      runtimeApiProviderStatus().providerName ?? undefined,
    readLoadBalancerStats: () => runtimeApiGetLoadBalancerStats(),
    readTokenAccounting: () => runtimeApiGetLoadBalancerTokenAccounting(),
    readSessionTokens: () => runtimeApiGetSessionTokenUsage(),
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
    listTools,
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
