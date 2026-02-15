/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-010, REQ-STATUS-020, REQ-STATUS-025
 */

import {
  SlashCommand,
  CommandContext,
  CommandKind,
  MessageActionReturn,
} from './types.js';
type LspServerConfigLike = {
  id: string;
};

type LspConfigLike = {
  servers?: LspServerConfigLike[];
};

type LspServiceStatusLike = {
  serverId: string;
  healthy?: boolean;
  detail?: string;
  status?: string;
  state?: string;
};

type LspServiceClientLike = {
  isAlive(): boolean;
  status(): Promise<LspServiceStatusLike[]>;
  getUnavailableReason?(): string;
};

type LspConfigAccessor = {
  getLspConfig?(): LspConfigLike | undefined;
  getLspServiceClient?(): LspServiceClientLike | undefined;
};

const BUILTIN_SERVER_IDS = [
  'typescript',
  'eslint',
  'gopls',
  'pyright',
  'rust-analyzer',
] as const;

/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-030
 */
function normalizeStatus(
  rawStatus: string,
): 'active' | 'starting' | 'broken' | 'disabled' | 'unavailable' {
  switch (rawStatus) {
    case 'active':
    case 'starting':
    case 'broken':
    case 'disabled':
    case 'unavailable':
      return rawStatus;
    case 'ok':
    case 'running':
    case 'healthy':
      return 'active';
    case 'failed':
    case 'error':
      return 'broken';
    default:
      return 'unavailable';
  }
}

/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-010, REQ-STATUS-020, REQ-STATUS-025, REQ-STATUS-030,
 * REQ-STATUS-035, REQ-STATUS-040, REQ-STATUS-045, REQ-STATUS-050
 */
async function statusAction(
  context: CommandContext,
  _args: string,
): Promise<MessageActionReturn> {
  const config = context.services.config as unknown as LspConfigAccessor | null;

  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Config not loaded.',
    };
  }

  const lspConfig = config.getLspConfig?.();
  if (!lspConfig) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'LSP disabled by configuration',
    };
  }

  const lspClient = config.getLspServiceClient?.();
  if (!lspClient || !lspClient.isAlive()) {
    const reason =
      lspClient?.getUnavailableReason?.() ?? 'service startup failed';
    return {
      type: 'message',
      messageType: 'info',
      content: `LSP unavailable: ${reason}`,
    };
  }

  const statuses = await lspClient.status();
  const configuredIds = (lspConfig.servers ?? []).map((server) => server.id);
  const statusIds = statuses.map((status) => status.serverId);

  const universe = new Set<string>([
    ...BUILTIN_SERVER_IDS,
    ...configuredIds,
    ...statusIds,
  ]);

  const statusMap = new Map(
    statuses.map((status) => [status.serverId, status]),
  );
  const sortedIds = [...universe].sort((a, b) => a.localeCompare(b));

  const lines = sortedIds.map((serverId: string) => {
    const status = statusMap.get(serverId);
    const rawStatus =
      status?.state ??
      status?.status ??
      (typeof status?.healthy === 'boolean'
        ? status.healthy
          ? 'active'
          : 'broken'
        : 'unavailable');
    const normalized = normalizeStatus(rawStatus);
    return `  ${serverId}: ${normalized}`;
  });

  return {
    type: 'message',
    messageType: 'info',
    content: `LSP server status:\n${lines.join('\n')}`,
  };
}

const statusCommand: SlashCommand = {
  name: 'status',
  description: 'Show LSP service status',
  kind: CommandKind.BUILT_IN,
  action: statusAction,
};

/**
 * @plan PLAN-20250212-LSP.P34
 * @requirement REQ-STATUS-010, REQ-STATUS-020, REQ-STATUS-050
 */
export const lspCommand: SlashCommand = {
  name: 'lsp',
  description: 'Manage Language Server Protocol (LSP) service',
  kind: CommandKind.BUILT_IN,
  subCommands: [statusCommand],
  action: async (context: CommandContext, args: string) =>
    statusCommand.action!(context, args),
};
