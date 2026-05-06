/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.3
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger, MCPOAuthTokenStorage } from '@vybestack/llxprt-code-core';
import process from 'node:process';
import * as os from 'node:os';

interface LoadBalancerStatsResult {
  lastSelected: string | null;
  totalRequests: number;
  profileCounts: Record<string, number>;
}

interface BucketFailoverDiagnosticsHandler {
  getBuckets: () => string[];
  getCurrentBucket: () => string | undefined;
  isEnabled: () => boolean;
}

function getBucketFailoverDiagnosticsHandler(
  config: unknown,
): BucketFailoverDiagnosticsHandler | undefined {
  if (
    config === null ||
    typeof config !== 'object' ||
    !('getBucketFailoverHandler' in config) ||
    typeof (config as { getBucketFailoverHandler?: unknown })
      .getBucketFailoverHandler !== 'function'
  ) {
    return undefined;
  }

  const handler = (
    config as {
      getBucketFailoverHandler: () => unknown;
    }
  ).getBucketFailoverHandler();
  if (
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    handler === null ||
    typeof handler !== 'object' ||
    typeof (handler as { getBuckets?: unknown }).getBuckets !== 'function' ||
    typeof (handler as { getCurrentBucket?: unknown }).getCurrentBucket !==
      'function' ||
    typeof (handler as { isEnabled?: unknown }).isEnabled !== 'function'
  ) {
    return undefined;
  }

  return handler as BucketFailoverDiagnosticsHandler;
}

function isLoadBalancingProvider(
  provider: unknown,
): provider is { getStats: () => LoadBalancerStatsResult } {
  return (
    provider !== null &&
    typeof provider === 'object' &&
    'getStats' in provider &&
    typeof (provider as { getStats?: unknown }).getStats === 'function'
  );
}

function maskSensitive(value: string): string {
  if (value.length < 8) {
    return '*'.repeat(value.length);
  }
  return (
    value.substring(0, 4) +
    '*'.repeat(value.length - 8) +
    value.substring(value.length - 4)
  );
}

function appendProviderInfo(
  diagnostics: string[],
  context: CommandContext,
  providerName: string | undefined,
): void {
  diagnostics.push('## Provider Information');
  diagnostics.push(`- Active Provider: ${providerName ?? 'none'}`);

  const oauthMgr = context.services.oauthManager;
  if (oauthMgr && providerName) {
    const sessionBucket = oauthMgr.getSessionBucket(providerName);
    diagnostics.push(`- OAuth Bucket: ${sessionBucket ?? 'default'}`);
  }
}

function appendFailoverInfo(
  diagnostics: string[],
  config: NonNullable<CommandContext['services']['config']>,
  providerName: string | undefined,
  oauthMgr: CommandContext['services']['oauthManager'],
): void {
  const failoverHandler = getBucketFailoverDiagnosticsHandler(config);
  if (failoverHandler === undefined) {
    if (oauthMgr && providerName) {
      diagnostics.push(`- Bucket Failover: Not configured`);
    }
    return;
  }
  const buckets = failoverHandler.getBuckets();
  const currentBucket = failoverHandler.getCurrentBucket();
  const isEnabled = failoverHandler.isEnabled();
  diagnostics.push(`- Bucket Failover: ${isEnabled ? 'Enabled' : 'Disabled'}`);
  if (buckets.length === 0) {
    return;
  }
  diagnostics.push(`- Failover Buckets: ${buckets.join(' → ')}`);
  diagnostics.push(`- Current Failover Bucket: ${currentBucket ?? buckets[0]}`);
  if (currentBucket !== undefined && buckets.length > 1) {
    const currentIndex = buckets.indexOf(currentBucket);
    const nextBucket =
      currentIndex >= 0 && currentIndex < buckets.length - 1
        ? buckets[currentIndex + 1]
        : '(none - last bucket)';
    diagnostics.push(`- Next Failover Bucket: ${nextBucket}`);
  }
}

function appendLoadBalancerStats(
  diagnostics: string[],
  logger: DebugLogger,
): void {
  const runtimeApi = getRuntimeApi();
  const providerStatus = runtimeApi.getActiveProviderStatus();
  if (providerStatus.providerName !== 'load-balancer') {
    return;
  }
  try {
    const providerManager = runtimeApi.getCliProviderManager();
    const lbProvider = providerManager.getProviderByName('load-balancer');
    if (!isLoadBalancingProvider(lbProvider)) {
      return;
    }
    const lbStats = lbProvider.getStats();
    diagnostics.push('\n## Load Balancer Stats');
    diagnostics.push(`- Active Sub-Profile: ${lbStats.lastSelected ?? 'none'}`);
    diagnostics.push(`- Total Requests: ${lbStats.totalRequests}`);
    diagnostics.push('- Profile Distribution:');
    for (const [profile, count] of Object.entries(lbStats.profileCounts)) {
      const percentage =
        lbStats.totalRequests > 0
          ? ((count / lbStats.totalRequests) * 100).toFixed(1)
          : '0';
      diagnostics.push(`  - ${profile}: ${count} requests (${percentage}%)`);
    }
  } catch (error) {
    logger.debug(
      () =>
        `[diagnostics] Failed to fetch load balancer stats: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function appendEphemeralSettings(
  diagnostics: string[],
  ephemeralSettings: Record<string, unknown>,
  logger: DebugLogger,
): void {
  diagnostics.push('\n## Ephemeral Settings');
  logger.debug(
    () =>
      `[diagnostics] ephemeral settings ${JSON.stringify(ephemeralSettings)}`,
  );
  if (Object.keys(ephemeralSettings).length === 0) {
    diagnostics.push('- No ephemeral settings configured');
    return;
  }

  const sensitiveKeys = new Set(['auth-key', 'apiKey', 'api-key']);

  const formatSettingValue = (key: string, value: unknown): string => {
    if (typeof value === 'string' && sensitiveKeys.has(key)) {
      return maskSensitive(value);
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  const authSettings: Array<[string, unknown]> = [];
  const toolSettings: Array<[string, unknown]> = [];
  const compressionSettings: Array<[string, unknown]> = [];
  const otherSettings: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(ephemeralSettings)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (key.startsWith('auth-') || key === 'apiKey' || key === 'api-key') {
      authSettings.push([key, value]);
    } else if (key.startsWith('tool-output-') || key === 'max-prompt-tokens') {
      toolSettings.push([key, value]);
    } else if (key.startsWith('compression-') || key === 'context-limit') {
      compressionSettings.push([key, value]);
    } else {
      otherSettings.push([key, value]);
    }
  }

  if (authSettings.length > 0) {
    diagnostics.push('- Authentication:');
    for (const [key, value] of authSettings) {
      diagnostics.push(`  - ${key}: ${formatSettingValue(key, value)}`);
    }
  }

  if (toolSettings.length > 0) {
    diagnostics.push('- Tool Output & Limits:');
    for (const [key, value] of toolSettings) {
      diagnostics.push(`  - ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (compressionSettings.length > 0) {
    diagnostics.push('- Compression & Context:');
    for (const [key, value] of compressionSettings) {
      diagnostics.push(`  - ${key}: ${value}`);
    }
  }

  if (otherSettings.length > 0) {
    diagnostics.push('- Other Settings:');
    for (const [key, value] of otherSettings) {
      diagnostics.push(`  - ${key}: ${formatSettingValue(key, value)}`);
    }
  }
}

function appendDumpContextInfo(
  diagnostics: string[],
  ephemeralSettings: Record<string, unknown>,
): void {
  const dumpcontextSetting = ephemeralSettings['dumpcontext'];
  const dumpcontextFallback =
    ephemeralSettings['dumponerror'] === 'enabled' ? 'error' : 'off';
  const dumpcontextMode =
    typeof dumpcontextSetting === 'string' && dumpcontextSetting.length > 0
      ? dumpcontextSetting
      : dumpcontextFallback;
  if (dumpcontextMode !== 'off') {
    diagnostics.push(`\n## Context Dumping`);
    diagnostics.push(`- Mode: ${dumpcontextMode}`);
    diagnostics.push(`- Dump Directory: ${os.homedir()}/.llxprt/dumps/`);
  }
}

function appendStaticSections(
  diagnostics: string[],
  config: NonNullable<CommandContext['services']['config']>,
  settings: CommandContext['services']['settings'],
  ephemeralSettings: Record<string, unknown>,
): void {
  diagnostics.push('\n## System Information');
  diagnostics.push(`- Platform: ${process.platform}`);
  diagnostics.push(`- Node Version: ${process.version}`);
  diagnostics.push(`- Working Directory: ${process.cwd()}`);
  diagnostics.push(
    `- Debug Mode: ${config.getDebugMode() ? 'Enabled' : 'Disabled'}`,
  );
  diagnostics.push(`- Approval Mode: ${config.getApprovalMode()}`);

  diagnostics.push('\n## Compression');
  const compressionThreshold =
    ephemeralSettings['compression-threshold'] ?? 'default';
  diagnostics.push(`- Threshold: ${compressionThreshold}`);
  const contextLimit = ephemeralSettings['context-limit'];
  diagnostics.push(
    `- Context Limit: ${contextLimit !== undefined ? contextLimit : 'provider default'}`,
  );

  diagnostics.push('\n## Settings');
  const { merged } = settings;
  diagnostics.push(`- Theme: ${merged.ui.theme ?? 'default'}`);
  diagnostics.push(`- Default Profile: ${merged.defaultProfile ?? 'none'}`);
  diagnostics.push(`- Sandbox: ${merged.sandbox ?? 'disabled'}`);

  diagnostics.push('\n## IDE Integration');
  diagnostics.push(
    `- IDE Mode: ${config.getIdeMode() ? 'Enabled' : 'Disabled'}`,
  );
  const ideClient = config.getIdeClient();
  diagnostics.push(`- IDE Client: ${ideClient ? 'Connected' : 'Offline'}`);

  diagnostics.push('\n## MCP (Model Context Protocol)');
  const mcpServers = config.getMcpServers();
  if (mcpServers && Object.keys(mcpServers).length > 0) {
    diagnostics.push(`- MCP Servers: ${Object.keys(mcpServers).join(', ')}`);
  } else {
    diagnostics.push('- MCP Servers: None configured');
  }
  const mcpServerCommand = config.getMcpServerCommand();
  diagnostics.push(`- MCP Server Command: ${mcpServerCommand ?? 'not set'}`);

  diagnostics.push('\n## Memory/Context');
  const userMemory = config.getUserMemory();
  const userMemoryText =
    typeof userMemory === 'string' && userMemory.length > 0
      ? `${userMemory.length} characters`
      : 'Not loaded';
  diagnostics.push(`- User Memory: ${userMemoryText}`);
  diagnostics.push(`- Context Files: ${config.getLlxprtMdFileCount()} files`);
}

function appendToolsAndTelemetry(
  diagnostics: string[],
  config: NonNullable<CommandContext['services']['config']>,
  settings: CommandContext['services']['settings'],
): void {
  diagnostics.push('\n## Tools');
  try {
    const toolRegistry = config.getToolRegistry();
    const tools = toolRegistry.getAllTools();
    diagnostics.push(`- Available Tools: ${tools.length}`);
    const toolNames = tools.map((t: { name: string }) => t.name).slice(0, 10);
    if (toolNames.length > 0) {
      diagnostics.push(`- First 10 Tools: ${toolNames.join(', ')}`);
    }
  } catch {
    diagnostics.push('- Tool Registry: Not initialized');
  }

  diagnostics.push('\n## Telemetry');
  diagnostics.push(
    `- Usage Statistics: ${settings.merged.ui.usageStatisticsEnabled === true ? 'Enabled' : 'Disabled'}`,
  );
}

async function appendProviderTokens(
  diagnostics: string[],
  logger: DebugLogger,
): Promise<void> {
  const runtimeApi = getRuntimeApi();
  const oauthManager = runtimeApi.getCliOAuthManager();
  if (!oauthManager) {
    return;
  }

  const supportedProviders = oauthManager.getSupportedProviders();
  if (supportedProviders.length === 0) {
    return;
  }

  const tokenStore = oauthManager.getTokenStore();

  for (const provider of supportedProviders) {
    let buckets: string[] = [];

    try {
      buckets = await tokenStore.listBuckets(provider);
    } catch (error) {
      logger.debug(
        () => `[diagnostics] Failed to list buckets for ${provider}: ${error}`,
      );
    }

    if (buckets.length === 0) {
      continue;
    }

    diagnostics.push('### Provider Tokens');
    diagnostics.push(`- ${provider}:`);
    diagnostics.push(`  - Buckets: ${buckets.length}`);

    for (const bucket of buckets) {
      const token = await tokenStore.getToken(provider, bucket);

      if (token && typeof token.expiry === 'number') {
        const expiryDate = new Date(token.expiry * 1000);
        const timeUntilExpiry = Math.max(0, token.expiry - Date.now() / 1000);
        const hours = Math.floor(timeUntilExpiry / 3600);
        const minutes = Math.floor((timeUntilExpiry % 3600) / 60);
        const isExpired = token.expiry < Date.now() / 1000;

        diagnostics.push(`  - ${bucket}:`);
        diagnostics.push(
          `    - Status: ${isExpired ? 'Expired' : 'Authenticated'}`,
        );
        diagnostics.push(`    - Expires: ${expiryDate.toISOString()}`);
        diagnostics.push(`    - Time Remaining: ${hours}h ${minutes}m`);
        diagnostics.push(
          `    - Refresh Token: ${token.refresh_token ? 'Available' : 'None'}`,
        );
      }
    }
  }
}

function appendMcpServerTokenExpiry(
  diagnostics: string[],
  expiresAt: number,
): void {
  if (expiresAt === 0 || Number.isNaN(expiresAt)) {
    return;
  }
  const expiryDate = new Date(expiresAt);
  const timeUntilExpiry = Math.max(0, (expiresAt - Date.now()) / 1000);
  const hours = Math.floor(timeUntilExpiry / 3600);
  const minutes = Math.floor((timeUntilExpiry % 3600) / 60);

  diagnostics.push(`  - Expires: ${expiryDate.toISOString()}`);
  diagnostics.push(`  - Time Remaining: ${hours}h ${minutes}m`);
}

function formatMcpServerToken(
  diagnostics: string[],
  serverName: string,
  token: {
    expiresAt?: number;
    refreshToken?: string;
    tokenType: string;
    scope?: string;
  },
): void {
  const isExpired = MCPOAuthTokenStorage.isTokenExpired(token as never);

  diagnostics.push(`- ${serverName}:`);
  diagnostics.push(`  - Status: ${isExpired ? 'Expired' : 'Valid'}`);

  if (
    token.expiresAt != null &&
    token.expiresAt !== 0 &&
    !Number.isNaN(token.expiresAt)
  ) {
    appendMcpServerTokenExpiry(diagnostics, token.expiresAt);
  }

  diagnostics.push(
    `  - Refresh Token: ${token.refreshToken ? 'Available' : 'None'}`,
  );

  if (token.tokenType) {
    diagnostics.push(`  - Token Type: ${token.tokenType}`);
  }

  if (token.scope) {
    diagnostics.push(`  - Scopes: ${token.scope}`);
  }
}

async function appendMcpTokens(
  diagnostics: string[],
  logger: DebugLogger,
): Promise<boolean> {
  try {
    const mcpTokenStorage = new MCPOAuthTokenStorage();
    const mcpTokens = await mcpTokenStorage.getAllCredentials();

    if (mcpTokens.size > 0) {
      diagnostics.push('\n### MCP Server Tokens');

      for (const [serverName, credentials] of mcpTokens) {
        formatMcpServerToken(diagnostics, serverName, credentials.token);
      }
      return true;
    }
  } catch (error) {
    logger.debug(() => `[diagnostics] Failed to retrieve MCP tokens: ${error}`);
  }
  return false;
}

async function appendOAuthTokens(
  diagnostics: string[],
  logger: DebugLogger,
): Promise<void> {
  diagnostics.push('\n## OAuth Tokens');

  try {
    const runtimeApi = getRuntimeApi();
    const oauthManager = runtimeApi.getCliOAuthManager();

    if (!oauthManager) {
      diagnostics.push('- No OAuth tokens configured');
      return;
    }

    let hasProviderTokens = false;

    // Capture diagnostics length before provider tokens are added
    const beforeLength = diagnostics.length;
    await appendProviderTokens(diagnostics, logger);
    hasProviderTokens = diagnostics.length > beforeLength;

    const hasMCPTokens = await appendMcpTokens(diagnostics, logger);

    if (!hasProviderTokens && !hasMCPTokens) {
      diagnostics.push('- No OAuth tokens configured');
    }
  } catch (error) {
    logger.debug(
      () => `[diagnostics] Failed to retrieve OAuth tokens: ${error}`,
    );
    diagnostics.push('- Unable to retrieve OAuth token information');
  }
}

export const diagnosticsCommand: SlashCommand = {
  name: 'diagnostics',
  description: 'show current configuration and diagnostic information',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<MessageActionReturn> => {
    try {
      const config = context.services.config;
      const settings = context.services.settings;
      const logger = new DebugLogger('llxprt:ui:diagnostics');

      if (!config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not available',
        };
      }

      const snapshot = getRuntimeApi().getRuntimeDiagnosticsSnapshot();
      logger.debug(
        () =>
          `[diagnostics] snapshot provider=${snapshot.providerName ?? 'unknown'}`,
      );
      const diagnostics: string[] = ['# LLxprt Diagnostics\n'];

      appendProviderInfo(
        diagnostics,
        context,
        snapshot.providerName ?? undefined,
      );
      diagnostics.push(`- Current Model: ${snapshot.modelName ?? 'unknown'}`);
      diagnostics.push(`- Current Profile: ${snapshot.profileName ?? 'none'}`);
      diagnostics.push(`- API Key: unavailable via runtime helpers`);

      appendFailoverInfo(
        diagnostics,
        config,
        snapshot.providerName ?? undefined,
        context.services.oauthManager,
      );
      appendLoadBalancerStats(diagnostics, logger);

      diagnostics.push('\n## Model Parameters');
      const modelParams = snapshot.modelParams;
      if (Object.keys(modelParams).length === 0) {
        diagnostics.push('- No custom model parameters set');
      } else {
        for (const [key, value] of Object.entries(modelParams)) {
          diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
        }
      }

      const ephemeralSettings = snapshot.ephemeralSettings;
      appendEphemeralSettings(diagnostics, ephemeralSettings, logger);
      appendDumpContextInfo(diagnostics, ephemeralSettings);
      appendStaticSections(diagnostics, config, settings, ephemeralSettings);
      appendToolsAndTelemetry(diagnostics, config, settings);
      await appendOAuthTokens(diagnostics, logger);

      return {
        type: 'message',
        messageType: 'info',
        content: diagnostics.join('\n'),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to generate diagnostics: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
