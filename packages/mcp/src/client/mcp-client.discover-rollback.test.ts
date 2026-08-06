/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import * as SdkClientStdioLib from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { McpClient } from './mcp-client.js';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js');
vi.mock('@modelcontextprotocol/sdk/client/index.js');
vi.mock('../auth/oauth-provider.js');
vi.mock('../auth/oauth-token-storage.js');
vi.mock('../auth/oauth-utils.js');
vi.mock('google-auth-library', () => ({ GoogleAuth: vi.fn() }));

vi.mock('@vybestack/llxprt-code-core/utils/events.js', () => ({
  coreEvents: {
    emitFeedback: vi.fn(),
  },
}));

type CleanupName = 'prompts' | 'resources' | 'tools';

async function createRollbackHarness(failingCleanup: CleanupName) {
  const sdkClient = {
    connect: vi.fn(),
    close: vi.fn(),
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    setNotificationHandler: vi.fn(),
    getServerCapabilities: vi
      .fn()
      .mockReturnValue({ prompts: {}, tools: {}, resources: {} }),
    listPrompts: vi.fn().mockResolvedValue({
      prompts: [{ name: 'prompt' }],
    }),
    listTools: vi.fn().mockResolvedValue({
      tools: [{ name: 'tool', inputSchema: { type: 'object' } }],
    }),
    request: vi.fn().mockResolvedValue({ resources: [{ uri: 'file:///r' }] }),
  };
  (
    ClientLib.Client as unknown as Mock<(...args: never[]) => unknown>
  ).mockReturnValue(sdkClient as unknown as Client);
  (
    SdkClientStdioLib.StdioClientTransport as unknown as Mock<
      (...args: never[]) => unknown
    >
  ).mockReturnValue({} as SdkClientStdioLib.StdioClientTransport);

  const createCleanup = (name: CleanupName) =>
    name === failingCleanup
      ? vi.fn(() => {
          throw new Error(`${name} cleanup exploded`);
        })
      : vi.fn();
  const removePrompts = createCleanup('prompts');
  const removeResources = createCleanup('resources');
  const removeTools = createCleanup('tools');
  const promptRegistry = {
    registerPrompt: vi.fn(),
    removePromptsByServer: removePrompts,
  } as unknown as PromptRegistry;
  const setResourcesForServer = vi.fn();
  const resourceRegistry = {
    setResourcesForServer,
    removeResourcesByServer: removeResources,
  } as unknown as ResourceRegistry;
  const toolRegistry = {
    registerTool: vi.fn(),
    sortTools: vi.fn(),
    removeMcpToolsByServer: removeTools,
    getMessageBus: vi.fn(),
  } as unknown as ToolRegistry;
  const config = { isTrustedFolder: () => true } as Config;
  const client = new McpClient(
    'test-server',
    { command: 'test-command' },
    toolRegistry,
    promptRegistry,
    resourceRegistry,
    new WorkspaceContext('/workspace'),
    config,
    false,
    '0.0.1',
  );
  await client.connect();
  let mayPublish = true;
  setResourcesForServer.mockImplementation(() => {
    mayPublish = false;
  });

  return {
    client,
    config,
    mayPublish: () => mayPublish,
    removePrompts,
    removeResources,
    removeTools,
    setResourcesForServer,
  };
}

describe('McpClient discover rollback independence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['prompts', 'resources and tools'],
    ['resources', 'prompts and tools'],
    ['tools', 'prompts and resources'],
  ] as const)(
    'cleans %s independently while still cleaning %s',
    async (failingCleanup) => {
      const harness = await createRollbackHarness(failingCleanup);

      await harness.client.discover(harness.config, harness.mayPublish);

      expect(harness.setResourcesForServer).toHaveBeenCalledOnce();
      expect(harness.mayPublish()).toBe(false);
      expect(harness.removePrompts).toHaveBeenCalledWith('test-server');
      expect(harness.removeResources).toHaveBeenCalledWith('test-server');
      expect(harness.removeTools).toHaveBeenCalledWith('test-server');
    },
  );
});
