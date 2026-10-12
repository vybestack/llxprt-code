/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 *
 * AgentLspControl implementation. Reads the explicit workspace inspection operation without exposing a service client.
 */

import type { WorkspaceLspInspection } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
import type {
  LspServerConfig,
  ServerStatus,
} from '@vybestack/llxprt-code-ide-integration';
import type {
  AgentLspControl,
  LspServerStatus,
  LspStatusSnapshot,
} from '../agent.js';
import { formatError } from './errorUtils.js';

/**
 * Inspection port supplied by the retained workspace runtime.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 */
export interface LspControlDeps {
  readonly inspection: WorkspaceLspInspection;
}

function unavailableServerStatus(
  server: LspServerConfig,
  reason?: string,
): LspServerStatus {
  const detail = reason ?? 'LSP service unavailable';
  return {
    serverId: server.id,
    healthy: false,
    detail,
    status: detail,
    state: 'broken',
  };
}

function projectStatus(status: ServerStatus): LspServerStatus {
  return {
    serverId: status.serverId,
    healthy: status.healthy,
    ...(status.detail !== undefined ? { detail: status.detail } : {}),
    ...(status.state !== undefined ? { state: status.state } : {}),
    ...(status.status !== undefined ? { status: status.status } : {}),
  };
}

function buildStatusByConfiguredId(
  rawStatuses: readonly ServerStatus[],
): ReadonlyMap<string, ServerStatus> {
  const byId = new Map<string, ServerStatus>();
  for (const status of rawStatuses) {
    if (status.serverId !== '') {
      byId.set(status.serverId, status);
    }
  }
  return byId;
}

function projectConfiguredStatuses(
  configuredServers: readonly LspServerConfig[],
  rawStatuses: readonly ServerStatus[],
): readonly LspServerStatus[] {
  const byId = buildStatusByConfiguredId(rawStatuses);
  return configuredServers.map((server) => {
    const status = byId.get(server.id);
    if (status === undefined) {
      return unavailableServerStatus(server, 'LSP status unavailable');
    }
    return projectStatus(status);
  });
}

export class LspControl implements AgentLspControl {
  constructor(private readonly deps: LspControlDeps) {}

  async status(): Promise<LspStatusSnapshot> {
    try {
      return await this.readStatus();
    } catch (err) {
      return {
        disabled: true,
        servers: [],
        unavailableReason: formatError(err),
      };
    }
  }

  private async readStatus(): Promise<LspStatusSnapshot> {
    const health = await this.deps.inspection.read();
    const lspConfig = health.configured;

    if (lspConfig === undefined) {
      return {
        disabled: true,
        servers: [],
        unavailableReason: 'LSP not configured',
      };
    }

    if (!health.alive) {
      const reason = health.reason;
      return {
        disabled: true,
        servers: lspConfig.servers.map((server) =>
          unavailableServerStatus(server, reason),
        ),
        unavailableReason: reason ?? 'LSP service unavailable',
      };
    }

    try {
      const rawStatuses = health.statuses;
      return {
        disabled: false,
        servers: projectConfiguredStatuses(lspConfig.servers, rawStatuses),
      };
    } catch (err) {
      const reason = formatError(err);
      return {
        disabled: true,
        servers: lspConfig.servers.map((server) =>
          unavailableServerStatus(server, reason),
        ),
        unavailableReason: reason,
      };
    }
  }
}
