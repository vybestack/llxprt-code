import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createTestCatalogOwner = installTestCatalogOwners();
import { createTestOAuthBinding } from './test-support/index.js';
import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';
/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config as BaseConfig } from './test-support/mcpClientTestSupport.js';

import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import type { McpClient } from './mcp-client.js';
import { McpClientManager } from './mcp-client-manager.js';

const { mockMcpClient } = {
  mockMcpClient: vi.fn(),
};
void vi.mock('./mcp-client.js', () => ({
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
  const catalog = createTestCatalogOwner();
  const promptRegistry = catalog.promptPublication;
  const resourceRegistry = catalog.resourcePublication;
  const configPrompts = promptRegistry;
  const configResources = resourceRegistry;
  const config = {
    isTrustedFolder: () => true,
    getMcpServers: () => ({ 'server-a': {}, 'server-b': {} }),
    getMcpServerCommand: () => '',

    getDebugMode: () => false,

    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,
    refreshMcpContext: vi.fn(),
  } as unknown as Config;
  const toolRegistry = new ToolRegistry(
    config,
    { requestConfirmation: async () => false },
    () => ({
      hideTaskAsync: false,
      lazyMcp: false,
      eagerServers: [],
      governance: buildToolGovernance({
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
      }),
    }),
  );
  const removeTools = vi.spyOn(toolRegistry, 'removeMcpToolsByServer');
  return {
    manager: new McpClientManager(
      createTestOAuthBinding(),
      unsupportedApprovalPolicy(),
      '0.0.1',
      toolRegistry,
      configPrompts,
      configResources,
      config,
      config.refreshMcpContext,
    ),
    clientA,
    clientB,
    removeTools,
  };
}

async function withThrowingStatusListener(
  manager: McpClientManager,
  action: () => void | Promise<void>,
): Promise<void> {
  const throwingListener = () => {
    throw new Error('status listener failed');
  };
  const release = manager.subscribeStatus(throwingListener);
  try {
    await action();
  } finally {
    release();
  }
}

describe('McpClientManager status listener cleanup failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cleans every server when a status listener throws during quarantine', async () => {
    const { manager, removeTools } = createHarness();
    await manager.startConfiguredMcpServers();
    removeTools.mockClear();

    await withThrowingStatusListener(manager, async () => {
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

    await withThrowingStatusListener(manager, async () => {
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

type Config = BaseConfig & { refreshMcpContext(): Promise<void> };
