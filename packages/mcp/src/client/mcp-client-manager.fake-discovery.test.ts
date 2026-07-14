/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClientManager } from './mcp-client-manager.js';
import { getMCPServerStatus, MCPServerStatus } from './mcp-client.js';

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

  function createManager(fixture: unknown): {
    manager: McpClientManager;
    toolRegistry: ToolRegistry;
  } {
    fs.writeFileSync(fixturePath, JSON.stringify(fixture));
    const promptRegistry = new PromptRegistry();
    const resourceRegistry = new ResourceRegistry();
    const config = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ [SERVER_NAME]: { command: 'unused' } }),
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
    const toolRegistry = new ToolRegistry(config, {
      requestConfirmation: async () => false,
    });
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
