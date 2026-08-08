/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { McpClient } from './mcp-client.js';
import { McpClientManager } from './mcp-client-manager.js';
import { wrapFlatConfigAsRuntimeDeps } from './testRuntimeDeps.js';
import {
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
} from './mcp-status.js';

const { mockMcpClient } = vi.hoisted(() => ({
  mockMcpClient: vi.fn(),
}));
vi.mock('./mcp-client.js', () => ({
  McpClient: mockMcpClient,
  MCPDiscoveryState: {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
  },
  populateMcpServerCommand: vi.fn((servers: unknown) => servers),
}));

function createClient(): McpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    invalidateCapabilities: vi.fn(),
    abortDiscovery: vi.fn(),
    getStatus: vi.fn(),
    getServerConfig: vi.fn().mockReturnValue({ extension: undefined }),
  } as unknown as McpClient;
}

function createHarness(): {
  manager: McpClientManager;
  clientA: McpClient;
  clientB: McpClient;
  removeTools: ReturnType<typeof vi.fn>;
} {
  const clientA = createClient();
  const clientB = createClient();
  mockMcpClient.mockReturnValueOnce(clientA).mockReturnValueOnce(clientB);
  const promptRegistry = new PromptRegistry();
  const resourceRegistry = new ResourceRegistry();
  const config = {
    isTrustedFolder: () => true,
    getMcpServers: () => ({ 'server-a': {}, 'server-b': {} }),
    getMcpServerCommand: () => '',
    getPromptRegistry: () => promptRegistry,
    getResourceRegistry: () => resourceRegistry,
    getDebugMode: () => false,
    getWorkspaceContext: () => new WorkspaceContext(''),
    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,
    refreshMcpContext: vi.fn(),
  } as unknown as Config;
  const toolRegistry = new ToolRegistry(config);
  const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
  return {
    manager: new McpClientManager(
      '0.0.1',
      toolRegistry,
      wrapFlatConfigAsRuntimeDeps(config),
    ),
    clientA,
    clientB,
    removeTools,
  };
}

async function withThrowingStatusListener(
  action: () => void | Promise<void>,
): Promise<void> {
  const throwingListener = () => {
    throw new Error('status listener failed');
  };
  addMCPStatusChangeListener(throwingListener);
  try {
    await action();
  } finally {
    removeMCPStatusChangeListener(throwingListener);
  }
}

describe('McpClientManager status listener cleanup failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cleans every server when a status listener throws during quarantine', async () => {
    const { manager, removeTools } = createHarness();
    await manager.startConfiguredMcpServers();
    removeTools.mockClear();

    await withThrowingStatusListener(async () => {
      expect(() => manager.quarantineForTrustRevocation()).toThrow(
        AggregateError,
      );
    });

    expect(removeTools.mock.calls.map(([name]) => name)).toStrictEqual([
      'server-a',
      'server-b',
    ]);
  });

  it('cleans every server when a status listener throws during stop', async () => {
    const { manager, clientA, clientB, removeTools } = createHarness();
    await manager.startConfiguredMcpServers();
    removeTools.mockClear();

    await withThrowingStatusListener(async () => {
      await expect(manager.stop()).rejects.toBeInstanceOf(AggregateError);
    });

    expect(removeTools.mock.calls.map(([name]) => name)).toStrictEqual([
      'server-a',
      'server-b',
    ]);
    expect(clientA.disconnect).toHaveBeenCalledOnce();
    expect(clientB.disconnect).toHaveBeenCalledOnce();
  });
});
