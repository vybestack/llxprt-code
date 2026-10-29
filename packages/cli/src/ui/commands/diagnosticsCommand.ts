/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.3
 */
import {
  type GetLoadBalancerStatsOperation,
  type GetLoadBalancerTokenAccountingOperation,
  type GetRuntimeDiagnosticsSnapshotOperation,
  type GetSessionTokenUsageOperation,
} from '../contexts/RuntimeContext.js';

import type { SlashCommand, MessageActionReturn } from './types.js';
import { CommandKind } from './types.js';

import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { ToolInfo } from '@vybestack/llxprt-code-agents';
import path from 'node:path';
import process from 'node:process';
import {
  Storage,
  redactSensitiveValues,
} from '@vybestack/llxprt-code-settings';
import type {
  ExtendedLoadBalancerStats,
  TokenAccountingDiagnostics,
} from '@vybestack/llxprt-code-providers';

interface DiagnosticStaticInfo {
  readonly workingDirectory: string;
  readonly debugMode: boolean;
  readonly approvalMode: string;
  readonly theme: string | undefined;
  readonly defaultProfile: string | undefined;
  readonly sandbox: unknown;
  readonly ideMode: boolean;
  readonly ideConnected: boolean;
  readonly mcpServers: readonly string[];
  readonly mcpServerCommand: string | undefined;
  readonly userMemory: unknown;
  readonly memoryFileCount: number;
  readonly usageStatistics: boolean;
}
export interface DiagnosticsCommandReads {
  readonly isConfigured: boolean;
  readonly readSnapshot: GetRuntimeDiagnosticsSnapshotOperation;
  readonly isOAuthAvailable: OAuthControl['isAvailable'];
  readonly readSessionBucket: OAuthControl['getSessionBucket'];
  readonly readFailoverBuckets: () => readonly string[];
  readonly readCurrentBucket: () => string | undefined;
  readonly readProviderName: () => string | undefined;
  readonly readLoadBalancerStats: GetLoadBalancerStatsOperation;
  readonly readTokenAccounting: GetLoadBalancerTokenAccountingOperation;
  readonly readSessionTokens: GetSessionTokenUsageOperation;
  readonly readStaticInfo: () => DiagnosticStaticInfo;
  readonly listTools: () => readonly ToolInfo[];
  readonly appendTokens: (
    lines: string[],
    logger: DebugLogger,
  ) => Promise<void>;
}

interface RuntimeSessionTokenUsage {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
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

function appendProviderInfo(
  diagnostics: string[],
  providerName: string | undefined,
  oauthAvailable: boolean,
  readSessionBucket: OAuthControl['getSessionBucket'],
): void {
  diagnostics.push('## Provider Information');
  diagnostics.push(`- Active Provider: ${providerName ?? 'none'}`);

  if (oauthAvailable && providerName) {
    const sessionBucket = readSessionBucket(providerName);
    diagnostics.push(`- OAuth Bucket: ${sessionBucket ?? 'default'}`);
  }
}

function appendFailoverInfo(
  diagnostics: string[],
  reads: Pick<
    DiagnosticsCommandReads,
    'readFailoverBuckets' | 'readCurrentBucket'
  >,
  providerName: string | undefined,
  oauthAvailable: boolean,
): void {
  const buckets = reads.readFailoverBuckets();
  if (buckets.length === 0) {
    if (oauthAvailable && providerName) {
      diagnostics.push(`- Bucket Failover: Not configured`);
    }
    return;
  }
  const currentBucket = reads.readCurrentBucket();
  const isEnabled = buckets.length > 1;
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

function appendProfileDistribution(
  diagnostics: string[],
  lbStats: ExtendedLoadBalancerStats,
): void {
  diagnostics.push('- Profile Distribution:');
  for (const [profile, count] of Object.entries(lbStats.profileCounts)) {
    const percentage =
      lbStats.totalRequests > 0
        ? ((count / lbStats.totalRequests) * 100).toFixed(1)
        : '0';
    diagnostics.push(`  - ${profile}: ${count} requests (${percentage}%)`);
  }
}

function appendTokenAccountingDiagnostics(
  diagnostics: string[],
  readSessionTokens: DiagnosticsCommandReads['readSessionTokens'],
  tokenAccounting: TokenAccountingDiagnostics,
): void {
  const sessionTokens = readSessionTokens();
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
  reads: Pick<
    DiagnosticsCommandReads,
    | 'readProviderName'
    | 'readLoadBalancerStats'
    | 'readTokenAccounting'
    | 'readSessionTokens'
  >,
): void {
  if (reads.readProviderName() !== 'load-balancer') {
    return;
  }
  try {
    const lbStats = reads.readLoadBalancerStats();
    if (lbStats === undefined) return;
    diagnostics.push('\n## Load Balancer Stats');
    diagnostics.push(
      '_Note: "Current Profile" above is runtime profile state (the profile loaded by the CLI); "Load Balancer Profile" below is provider stats/config state (reported by the load-balancer provider). They commonly share the same value._',
    );
    diagnostics.push(`- Load Balancer Profile: ${lbStats.profileName}`);
    diagnostics.push(
      `- Member Sub-Profiles: ${
        lbStats.members.length > 0 ? lbStats.members.join(', ') : 'none'
      }`,
    );
    diagnostics.push(`- Active Sub-Profile: ${lbStats.lastSelected ?? 'none'}`);
    diagnostics.push(`- Active Model: ${lbStats.lastSelectedModel ?? 'none'}`);
    diagnostics.push(`- Total Requests: ${lbStats.totalRequests}`);
    appendProfileDistribution(diagnostics, lbStats);

    const accounting = reads.readTokenAccounting();
    if (accounting !== undefined) {
      appendTokenAccountingDiagnostics(
        diagnostics,
        reads.readSessionTokens,
        accounting,
      );
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
  const redactedSettings = redactSensitiveValues(ephemeralSettings);
  diagnostics.push('\n## Ephemeral Settings');
  logger.debug(
    () =>
      `[diagnostics] ephemeral settings ${JSON.stringify(redactedSettings)}`,
  );
  if (Object.keys(redactedSettings).length === 0) {
    diagnostics.push('- No ephemeral settings configured');
    return;
  }

  const formatSettingValue = (value: unknown): string =>
    typeof value === 'object' ? JSON.stringify(value) : String(value);

  const authSettings: Array<[string, unknown]> = [];
  const toolSettings: Array<[string, unknown]> = [];
  const compressionSettings: Array<[string, unknown]> = [];
  const otherSettings: Array<[string, unknown]> = [];

  for (const [key, value] of Object.entries(redactedSettings)) {
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
      diagnostics.push(`  - ${key}: ${formatSettingValue(value)}`);
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
      diagnostics.push(`  - ${key}: ${formatSettingValue(value)}`);
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
  info: DiagnosticStaticInfo,
  ephemeralSettings: Record<string, unknown>,
): void {
  diagnostics.push('\n## System Information');
  diagnostics.push(`- Platform: ${process.platform}`);
  diagnostics.push(`- Node Version: ${process.version}`);
  diagnostics.push(`- Working Directory: ${info.workingDirectory}`);
  diagnostics.push(`- Debug Mode: ${info.debugMode ? 'Enabled' : 'Disabled'}`);
  diagnostics.push(`- Approval Mode: ${info.approvalMode}`);

  diagnostics.push('\n## Compression');
  const compressionThreshold =
    ephemeralSettings['compression-threshold'] ?? 'default';
  diagnostics.push(`- Threshold: ${compressionThreshold}`);
  const contextLimit = ephemeralSettings['context-limit'];
  diagnostics.push(
    `- Context Limit: ${contextLimit !== undefined ? contextLimit : 'provider default'}`,
  );

  diagnostics.push('\n## Settings');
  diagnostics.push(`- Theme: ${info.theme ?? 'default'}`);
  diagnostics.push(`- Default Profile: ${info.defaultProfile ?? 'none'}`);
  diagnostics.push(`- Sandbox: ${info.sandbox ?? 'disabled'}`);

  diagnostics.push('\n## IDE Integration');
  diagnostics.push(`- IDE Mode: ${info.ideMode ? 'Enabled' : 'Disabled'}`);
  const ideClient = info.ideConnected;
  diagnostics.push(`- IDE Client: ${ideClient ? 'Connected' : 'Offline'}`);

  diagnostics.push('\n## MCP (Model Context Protocol)');
  const mcpServers = info.mcpServers;
  if (mcpServers.length > 0) {
    diagnostics.push(`- MCP Servers: ${mcpServers.join(', ')}`);
  } else {
    diagnostics.push('- MCP Servers: None configured');
  }
  const mcpServerCommand = info.mcpServerCommand;
  diagnostics.push(`- MCP Server Command: ${mcpServerCommand ?? 'not set'}`);

  diagnostics.push('\n## Memory/Context');
  const userMemory = info.userMemory;
  const userMemoryText =
    typeof userMemory === 'string' && userMemory.length > 0
      ? `${userMemory.length} characters`
      : 'Not loaded';
  diagnostics.push(`- User Memory: ${userMemoryText}`);
  diagnostics.push(`- Context Files: ${info.memoryFileCount} files`);
}

function appendToolsAndTelemetry(
  diagnostics: string[],
  listTools: () => readonly ToolInfo[],
  usageStatistics: boolean,
): void {
  diagnostics.push('\n## Tools');
  try {
    const tools = listTools();
    diagnostics.push(`- Available Tools: ${tools.length}`);
    const toolNames = tools.map((t) => t.name).slice(0, 10);
    if (toolNames.length > 0) {
      diagnostics.push(`- First 10 Tools: ${toolNames.join(', ')}`);
    }
  } catch {
    diagnostics.push('- Agent tools: Not initialized');
  }

  diagnostics.push('\n## Telemetry');
  diagnostics.push(
    `- Usage Statistics: ${usageStatistics ? 'Enabled' : 'Disabled'}`,
  );
}

function appendModelParameters(
  diagnostics: string[],
  modelParams: Readonly<Record<string, unknown>>,
): void {
  diagnostics.push('\n## Model Parameters');
  if (Object.keys(modelParams).length === 0) {
    diagnostics.push('- No custom model parameters set');
  } else {
    for (const [key, value] of Object.entries(modelParams)) {
      diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
    }
  }
}

export function createDiagnosticsCommand(
  reads: DiagnosticsCommandReads,
): SlashCommand {
  return {
    name: 'diagnostics',
    description: 'show current configuration and diagnostic information',
    kind: CommandKind.BUILT_IN,
    action: async (): Promise<MessageActionReturn> => {
      try {
        const logger = new DebugLogger('llxprt:ui:diagnostics');

        if (!reads.isConfigured) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Configuration not available',
          };
        }

        const snapshot = reads.readSnapshot();
        let oauthAvailable = false;
        try {
          oauthAvailable = reads.isOAuthAvailable();
        } catch (oauthError) {
          logger.debug(
            () =>
              `[diagnostics] Failed to retrieve OAuth manager: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`,
          );
        }
        logger.debug(
          () =>
            `[diagnostics] snapshot provider=${snapshot.providerName ?? 'unknown'}`,
        );
        const diagnostics: string[] = ['# LLxprt Diagnostics\n'];

        appendProviderInfo(
          diagnostics,
          snapshot.providerName ?? undefined,
          oauthAvailable,
          reads.readSessionBucket,
        );
        diagnostics.push(`- Current Model: ${snapshot.modelName ?? 'unknown'}`);
        diagnostics.push(
          `- Current Profile: ${snapshot.profileName ?? 'none'}`,
        );
        diagnostics.push(`- API Key: unavailable via runtime helpers`);

        appendFailoverInfo(
          diagnostics,
          reads,
          snapshot.providerName ?? undefined,
          oauthAvailable,
        );
        appendLoadBalancerStats(diagnostics, logger, reads);

        appendModelParameters(diagnostics, snapshot.modelParams);

        const ephemeralSettings = snapshot.ephemeralSettings;
        appendEphemeralSettings(diagnostics, ephemeralSettings, logger);
        appendDumpContextInfo(diagnostics, ephemeralSettings);
        const info = reads.readStaticInfo();
        appendStaticSections(diagnostics, info, ephemeralSettings);
        appendToolsAndTelemetry(
          diagnostics,
          reads.listTools,
          info.usageStatistics,
        );
        await reads.appendTokens(diagnostics, logger);

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
}
