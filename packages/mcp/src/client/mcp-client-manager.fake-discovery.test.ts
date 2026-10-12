/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createTestCatalogOwner = installTestCatalogOwners();

import { createTestOAuthBinding } from './test-support/index.js';

import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';

import { waitFor } from '../../../test-utils/src/wait-for.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config as BaseConfig } from './test-support/mcpClientTestSupport.js';

import {
  buildToolGovernance,
  ToolRegistry,
  type IToolRegistryHost,
} from '@vybestack/llxprt-code-tools';
import type { MCPServerConfig } from '../config/index.js';
import { McpClientManager } from './mcp-client-manager.js';
import { MCPServerStatus } from './mcp-client.js';

const SERVER_NAME = 'fixture-server';

describe('McpClientManager fake discovery lifecycle', () => {
  let fixturePath: string;
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-fake-mcp-'));
    fixturePath = path.join(workspacePath, 'fixture.json');
    process.env.LLXPRT_FAKE_MCP = fixturePath;
  });

  afterEach(() => {
    delete process.env.LLXPRT_FAKE_MCP;
    fs.rmSync(workspacePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createManager(
    fixture: unknown,
    serverNames: readonly string[] = [SERVER_NAME],
    serverConfig: MCPServerConfig = { command: 'unused' },
  ): {
    manager: McpClientManager;
    toolRegistry: ToolRegistry;
  } {
    fs.writeFileSync(fixturePath, JSON.stringify(fixture));
    const catalog = createTestCatalogOwner();
    const promptRegistry = catalog.promptPublication;
    const resourceRegistry = catalog.resourcePublication;
    const configPrompts = promptRegistry;
    const configResources = resourceRegistry;
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () =>
        Object.fromEntries(
          serverNames.map((serverName) => [serverName, serverConfig]),
        ),
      getMcpServerCommand: () => undefined,

      getDebugMode: () => false,

      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getExtensions: () => [],
      refreshMcpContext: async () => {},
    } as unknown as Config;
    const toolRegistry = new ToolRegistry(
      config as unknown as IToolRegistryHost,
      {
        requestConfirmation: async () => false,
      },
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
      toolRegistry,
    };
  }

  it('isolates same-name same-URL status and subscriptions through shipped fake discovery', async () => {
    const fixture = {
      servers: { [SERVER_NAME]: { tools: [{ name: 'shared' }] } },
    };
    const url = 'http://same.invalid/mcp';
    const { manager: a } = createManager(fixture, [SERVER_NAME], {
      url,
      oauth: { enabled: true },
    });
    const { manager: b } = createManager(fixture, [SERVER_NAME], {
      url,
      oauth: { enabled: false },
    });
    const bEvents: MCPServerStatus[] = [];
    const release = b.subscribeStatus((_name, status) => {
      bEvents.push(status);
    });
    try {
      await a.startConfiguredMcpServers();
      expect(bEvents).toStrictEqual([]);
      await b.startConfiguredMcpServers();
      expect(bEvents).toContain(MCPServerStatus.CONNECTING);
      expect(bEvents).toContain(MCPServerStatus.CONNECTED);
      const baseline = [...bEvents];
      await a.stop();
      expect(bEvents).toStrictEqual(baseline);
      expect(b.getServerStatus(SERVER_NAME)).toBe(MCPServerStatus.CONNECTED);
      expect(b.getServerStates().get(SERVER_NAME)?.requiresOAuth).toBe(false);
      expect(a.getServerStates().get(SERVER_NAME)?.requiresOAuth).toBe(true);
      release();
      await b.stop();
      expect(bEvents).toStrictEqual(baseline);
    } finally {
      release();
      await Promise.all([a.stop(), b.stop()]);
    }
  });

  it('does not retain a client when its server is absent from the fixture', async () => {
    const { manager } = createManager({ servers: {} });

    await manager.startConfiguredMcpServers();

    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(manager.getMcpServerCount()).toBe(0);
    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('does not retain a client when the fixture declares discovery failure', async () => {
    const { manager } = createManager({
      servers: { [SERVER_NAME]: { failure: 'fixture discovery failed' } },
    });

    await manager.startConfiguredMcpServers();

    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(manager.getDiscoveryFailures().get(SERVER_NAME)).toBe(
      'fixture discovery failed',
    );
    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('rejects malformed fixture data without retaining a partially created client', async () => {
    const { manager } = createManager({
      servers: { [SERVER_NAME]: null },
    });

    await manager.startConfiguredMcpServers();

    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(manager.getMcpServerCount()).toBe(0);
    expect(manager.getDiscoveryFailures().get(SERVER_NAME)).toContain(
      'Invalid fake MCP fixture',
    );
    expect(manager.getDiscoveryFailures().get(SERVER_NAME)).toContain(
      fixturePath,
    );
  });

  it('publishes canonical MCP names and avoids collisions between servers', async () => {
    const { manager, toolRegistry } = createManager(
      {
        servers: {
          [SERVER_NAME]: { tools: [{ name: 'shared-tool' }] },
          'other-server': { tools: [{ name: 'shared-tool' }] },
        },
      },
      [SERVER_NAME, 'other-server'],
    );

    await manager.startConfiguredMcpServers();

    expect(
      toolRegistry.getTool('mcp__fixture-server__shared-tool'),
    ).toBeDefined();
    expect(
      toolRegistry.getTool('mcp__other-server__shared-tool'),
    ).toBeDefined();
    expect(toolRegistry.getTool('shared-tool')).toBeUndefined();
    expect(manager.getClient(SERVER_NAME)?.getStatus()).toBe(
      MCPServerStatus.CONNECTED,
    );
  });

  it('aborts and drains long-latency fake discovery during stop', async () => {
    const { manager } = createManager({
      servers: {
        [SERVER_NAME]: {
          latencyMs: 60_000,
          tools: [{ name: 'slow-tool' }],
        },
      },
    });
    const discovery = manager.startConfiguredMcpServers();
    await waitFor(() =>
      expect(manager.getServerStatus(SERVER_NAME)).toBe(
        MCPServerStatus.CONNECTING,
      ),
    );
    const started = Date.now();

    await manager.stop();
    await discovery;

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('publishes disconnected status immediately when fake discovery is revoked', async () => {
    const { manager } = createManager({
      servers: {
        [SERVER_NAME]: { tools: [{ name: 'connected-tool' }] },
      },
    });
    await manager.startConfiguredMcpServers();
    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.CONNECTED,
    );

    await manager.onFolderTrustRevoked();

    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.DISCONNECTED,
    );
  });

  it('removes a client and partial artifacts when fake publication throws', async () => {
    const { manager, toolRegistry } = createManager({
      servers: {
        [SERVER_NAME]: { tools: [{ name: 'published-before-throw' }] },
      },
    });
    const originalRegisterTool = toolRegistry.registerTool.bind(toolRegistry);
    vi.spyOn(toolRegistry, 'registerTool').mockImplementation((tool) => {
      originalRegisterTool(tool);
      throw new Error('registry publication failed');
    });

    await manager.startConfiguredMcpServers();

    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(toolRegistry.getTool('published-before-throw')).toBeUndefined();
    expect(manager.getDiscoveryFailures().get(SERVER_NAME)).toContain(
      'registry publication failed',
    );
    expect(manager.getServerStatus(SERVER_NAME)).toBe(
      MCPServerStatus.DISCONNECTED,
    );
  });
});

type Config = BaseConfig & { refreshMcpContext(): Promise<void> };
