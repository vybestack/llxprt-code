/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 *
 * AgentLspControl implementation. Delegates to the bound Config's LSP surface
 * (getLspConfig/getLspServiceClient) so clients inspect LSP status without a
 * Config escape hatch. Avoids leaking the raw LspServiceClient.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
 * Deps bundle injected by AgentImpl so LspControl can read the live Config
 * LSP surface.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 */
export interface LspControlDeps {
  readonly config: Config;
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
    const config = this.deps.config;
    const lspConfig = config.getLspConfig();
    const client = config.getLspServiceClient();

    if (lspConfig === undefined) {
      return {
        disabled: true,
        servers: [],
        unavailableReason: 'LSP not configured',
      };
    }

    if (client === undefined) {
      return {
        disabled: true,
        servers: lspConfig.servers.map((server) =>
          unavailableServerStatus(server),
        ),
        unavailableReason: 'LSP service unavailable',
      };
    }

    if (!client.isAlive()) {
      const reason = client.getUnavailableReason();
      return {
        disabled: true,
        servers: lspConfig.servers.map((server) =>
          unavailableServerStatus(server, reason),
        ),
        unavailableReason: reason ?? 'LSP service unavailable',
      };
    }

    try {
      const rawStatuses = await client.status();
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
