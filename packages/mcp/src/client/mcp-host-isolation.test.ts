/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import type { McpHostConfig } from '../host/hostInterfaces.js';
import {
  PromptRegistry,
  ResourceRegistry,
  WorkspaceContext,
} from './test-support/mcpClientTestSupport.js';
import { McpClientManager } from './mcp-client-manager.js';

function createManager(
  serverName: string,
  server: MCPServerConfig,
  notices: string[],
): McpClientManager {
  const config: McpHostConfig = {
    isTrustedFolder: () => true,
    getMcpServers: () => ({ [serverName]: server }),
    getMcpServerCommand: () => undefined,
    getPromptRegistry: () => new PromptRegistry(),
    getResourceRegistry: () => new ResourceRegistry(),
    getDebugMode: () => false,
    getWorkspaceContext: () => new WorkspaceContext(process.cwd()),
    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,
    getExtensions: () => [],
    refreshMcpContext: async () => {},
  };
  const registry = new ToolRegistry(
    { isTrustedFolder: () => true },
    { requestConfirmation: async () => false },
    new SettingsService(),
  );
  return new McpClientManager('0.0.1', registry, config, undefined, 100, {
    emitFeedback: (_severity, message) => notices.push(message),
    openBrowser: async () => {},
  });
}

describe('concurrent MCP hosts with real managers and clients', () => {
  it('keeps failure feedback on B while A is disposed during an open discovery', async () => {
    const noticesA: string[] = [];
    const noticesB: string[] = [];
    const first = createManager(
      'pending-a',
      {
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        timeout: 500,
      },
      noticesA,
    );
    const second = createManager(
      'broken-b',
      {
        command: '/nonexistent-llxprt-mcp-host-b',
      },
      noticesB,
    );

    const discoveryA = first.startConfiguredMcpServers();
    const discoveryB = second.startConfiguredMcpServers();
    await discoveryB;
    expect(second.getDiscoveryFailures().has('broken-b')).toBe(true);
    expect(noticesB).toHaveLength(1);
    expect(noticesB[0]).toContain('broken-b');
    const disposalA = first.stop();
    await Promise.all([discoveryA, disposalA]);
    expect(noticesB).toHaveLength(1);
    expect(noticesA.every((notice) => !notice.includes('broken-b'))).toBe(true);
    await second.stop();
  });
});
