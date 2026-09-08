/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '../../../test-utils/src/wait-for.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import type { Config } from './test-support/mcpClientTestSupport.js';
import { PromptRegistry } from './test-support/mcpClientTestSupport.js';
import { ResourceRegistry } from './test-support/mcpClientTestSupport.js';
import { WorkspaceContext } from './test-support/mcpClientTestSupport.js';
import {
  ToolRegistry,
  type IToolRegistryHost,
} from '@vybestack/llxprt-code-tools';
import { McpClientManager } from './mcp-client-manager.js';
import {
  getMCPServerStatus,
  MCPServerStatus,
  updateMCPServerStatus,
} from './mcp-client.js';

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
    updateMCPServerStatus(SERVER_NAME, MCPServerStatus.DISCONNECTED);
    updateMCPServerStatus('other-server', MCPServerStatus.DISCONNECTED);
    delete process.env.LLXPRT_FAKE_MCP;
    fs.rmSync(workspacePath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function createManager(
    fixture: unknown,
    serverNames: readonly string[] = [SERVER_NAME],
  ): {
    manager: McpClientManager;
    toolRegistry: ToolRegistry;
  } {
    fs.writeFileSync(fixturePath, JSON.stringify(fixture));
    const promptRegistry = new PromptRegistry();
    const resourceRegistry = new ResourceRegistry();
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () =>
        Object.fromEntries(
          serverNames.map((serverName) => [serverName, { command: 'unused' }]),
        ),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => promptRegistry,
      getResourceRegistry: () => resourceRegistry,
      getDebugMode: () => false,
      getWorkspaceContext: () => new WorkspaceContext(workspacePath),
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
    );
    return {
      manager: new McpClientManager('0.0.1', toolRegistry, config),
      toolRegistry,
    };
  }

  it('does not retain a client when its server is absent from the fixture', async () => {
    const { manager } = createManager({ servers: {} });

    await manager.startConfiguredMcpServers();

    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(manager.getMcpServerCount()).toBe(0);
    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.DISCONNECTED);
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
    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.DISCONNECTED);
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
      expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.CONNECTING),
    );
    const started = Date.now();

    await manager.stop();
    await discovery;

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(manager.getClient(SERVER_NAME)).toBeUndefined();
    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.DISCONNECTED);
  });

  it('publishes disconnected status immediately when fake discovery is revoked', async () => {
    const { manager } = createManager({
      servers: {
        [SERVER_NAME]: { tools: [{ name: 'connected-tool' }] },
      },
    });
    await manager.startConfiguredMcpServers();
    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.CONNECTED);

    await manager.onFolderTrustRevoked();

    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.DISCONNECTED);
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
    expect(getMCPServerStatus(SERVER_NAME)).toBe(MCPServerStatus.DISCONNECTED);
  });
});
