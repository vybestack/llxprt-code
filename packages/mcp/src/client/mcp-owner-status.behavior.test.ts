/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createTestCatalogOwner = installTestCatalogOwners();

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createTestOAuthBinding } from './test-support/index.js';

import { describe, expect, it } from 'bun:test';
import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { McpClientManager } from './mcp-client-manager.js';
import { MCPServerStatus } from './mcp-status.js';
import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';
import {} from './test-support/mcpClientTestSupport.js';
import type { MCPServerConfig } from '../config/index.js';

const createFilesystem = installTestWorkspaceFilesystem();

function createManager(
  config: MCPServerConfig,
  readServers: () => Record<string, MCPServerConfig> = () => ({ same: config }),
): McpClientManager {
  const catalog = createTestCatalogOwner();
  const prompts = catalog.promptPublication;
  const resources = catalog.resourcePublication;
  const workspace = createFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return new McpClientManager(
    createTestOAuthBinding(),
    unsupportedApprovalPolicy(),
    'test',
    new ToolRegistry({}, { requestConfirmation: async () => false }, () => ({
      hideTaskAsync: false,
      lazyMcp: false,
      eagerServers: [],
      governance: buildToolGovernance({
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
      }),
    })),
    prompts,
    resources,
    {
      isTrustedFolder: () => true,
      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getMcpServers: readServers,
      getMcpServerCommand: () => undefined,

      getWorkspaceDirectories: () => workspace.paths.directories(),
      onWorkspaceDirectoriesChanged: (listener) =>
        workspace.subscribeDirectories(listener),
      getDebugMode: () => false,
      getExtensions: () => [],
    },
    async () => {},
    undefined,
    undefined,
    () => {},
  );
}

describe('MCP owner status observations', () => {
  it('publishes real pending and failed discovery and releases subscriptions on stop', async () => {
    const manager = createManager({
      command: '/nonexistent-llxprt-status-fixture',
    });
    const events: Array<{ status: MCPServerStatus; failed: boolean }> = [];
    manager.subscribeStatus((name, status) => {
      events.push({ status, failed: manager.getDiscoveryFailures().has(name) });
    });
    try {
      const work = manager.startConfiguredMcpServers();
      expect(manager.getServerStatus('same')).toBe(MCPServerStatus.CONNECTING);
      expect(manager.getStatusServers()).toHaveProperty('same');
      await work;
      await manager.whenDiscoverySettled();
      expect(events).toContainEqual({
        status: MCPServerStatus.CONNECTING,
        failed: false,
      });
      expect(events).toContainEqual({
        status: MCPServerStatus.DISCONNECTED,
        failed: true,
      });
      expect(manager.getServerStates().get('same')?.requiresOAuth).toBe(false);
      await manager.stop();
      const stoppedEvents = [...events];
      await manager.stop();
      expect(events).toStrictEqual(stoppedEvents);
      expect(() => manager.subscribeStatus(() => {})).toThrow('stopped');
    } finally {
      await manager.stop();
    }
  });

  it('removes a failed server status when its configuration is removed', async () => {
    const config = { command: '/nonexistent-llxprt-status-fixture' };
    let servers: Record<string, MCPServerConfig> = { same: config };
    const manager = createManager(config, () => servers);
    try {
      await manager.startConfiguredMcpServers();
      expect(manager.getStatusServers()).toHaveProperty('same');
      servers = {};
      await manager.reconcileConfiguredMcpServers();
      expect(manager.getStatusServers()).toStrictEqual({});
      expect(manager.getServerStates().size).toBe(0);
    } finally {
      await manager.stop();
    }
  });

  it('cancels a real pending stdio handshake without late status updates', async () => {
    const manager = createManager({
      command: process.execPath,
      args: ['-e', 'await new Promise(() => {});'],
      timeout: 30000,
    });
    const events: MCPServerStatus[] = [];
    const release = manager.subscribeStatus((_name, status) => {
      events.push(status);
    });
    const work = manager.startConfiguredMcpServers();
    expect(events).toContain(MCPServerStatus.CONNECTING);
    await manager.stop();
    expect(events).toContain(MCPServerStatus.DISCONNECTING);
    const stoppedEvents = [...events];
    await work;
    expect(events).toStrictEqual(stoppedEvents);
    expect(manager.getServerStatus('same')).toBe(MCPServerStatus.DISCONNECTED);
    release();
  });
});
