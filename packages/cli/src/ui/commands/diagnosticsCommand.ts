/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.3
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import path from 'node:path';
import process from 'node:process';
import { Storage } from '@vybestack/llxprt-code-settings';
import { appendOAuthTokens } from './diagnosticsTokens.js';
import type { TokenAccountingDiagnostics } from '@vybestack/llxprt-code-providers';
interface RuntimeSessionTokenUsage {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
}

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
  if (!isBucketFailoverHandler(handler)) {
    return undefined;
  }

  return handler as BucketFailoverDiagnosticsHandler;
}

function isBucketFailoverHandler(handler: unknown): boolean {
  if (handler === null || typeof handler !== 'object') {
    return false;
  }
  const candidate = handler as {
    getBuckets?: unknown;
    getCurrentBucket?: unknown;
    isEnabled?: unknown;
  };
  return (
    typeof candidate.getBuckets === 'function' &&
    typeof candidate.getCurrentBucket === 'function' &&
    typeof candidate.isEnabled === 'function'
  );
}

function isLoadBalancingProvider(provider: unknown): provider is {
  getStats: () => LoadBalancerStatsResult;
  getTokenAccountingDiagnostics?: () => TokenAccountingDiagnostics;
} {
  return (
    provider !== null &&
    typeof provider === 'object' &&
    'getStats' in provider &&
    typeof (provider as { getStats?: unknown }).getStats === 'function'
  );
}

function supportsTokenAccountingDiagnostics(provider: {
  getTokenAccountingDiagnostics?: () => TokenAccountingDiagnostics;
}): provider is {
  getTokenAccountingDiagnostics: () => TokenAccountingDiagnostics;
} {
  return typeof provider.getTokenAccountingDiagnostics === 'function';
}

interface OptionalDiagnosticField {
  label: string;
  value: string | number | null;
  fallback: string;
}

function appendOptionalDiagnostics(
  diagnostics: string[],
  fields: OptionalDiagnosticField[],
): void {
  for (const { label, value, fallback } of fields) {
    diagnostics.push(`- ${label}: ${value ?? fallback}`);
  }
}

function isSessionTokenUsage(
  value: unknown,
): value is RuntimeSessionTokenUsage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const tokenFields = ['total', 'input', 'output', 'cache', 'tool', 'thought'];
  return tokenFields.every(
    (field) =>
      typeof candidate[field] === 'number' && Number.isFinite(candidate[field]),
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

function appendTokenAccountingDiagnostics(
  diagnostics: string[],
  runtimeApi: ReturnType<typeof getRuntimeApi>,
  lbProvider: {
    getTokenAccountingDiagnostics: () => TokenAccountingDiagnostics;
  },
): void {
  const tokenAccounting = lbProvider.getTokenAccountingDiagnostics();
  const sessionTokens = runtimeApi.getSessionTokenUsage();
  appendOptionalDiagnostics(diagnostics, [
    {
      label: 'Load Balancer Profile',
      value: tokenAccounting.profileName,
      fallback: 'none',
    },
    {
      label: 'Selected Sub-Profile',
      value: tokenAccounting.selectedSubProfile,
      fallback: 'none',
    },
    {
      label: 'Selected Provider',
      value: tokenAccounting.activeProvider,
      fallback: 'none',
    },
    {
      label: 'Selected Model',
      value: tokenAccounting.activeModel,
      fallback: 'none',
    },
    {
      label: 'Accounting Source',
      value: tokenAccounting.accountingSource,
      fallback: 'unknown',
    },
    {
      label: 'Shared Context Limit',
      value: tokenAccounting.sharedContextLimit,
      fallback: 'unbounded',
    },
    {
      label: 'Request-Estimated Tokens',
      value: tokenAccounting.lastEstimatedTokens,
      fallback: 'n/a',
    },
  ]);
  if (isSessionTokenUsage(sessionTokens)) {
    diagnostics.push(
      `- Session Status Tokens: ${sessionTokens.total} total (input ${sessionTokens.input}, output ${sessionTokens.output}, cache ${sessionTokens.cache}, tool ${sessionTokens.tool}, thought ${sessionTokens.thought})`,
    );
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

    if (supportsTokenAccountingDiagnostics(lbProvider)) {
      appendTokenAccountingDiagnostics(diagnostics, runtimeApi, lbProvider);
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
    diagnostics.push(
      `- Dump Directory: ${path.join(Storage.getGlobalCacheDir(), 'dumps')}`,
    );
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
