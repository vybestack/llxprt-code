/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
const createTestCatalogOwner = installTestCatalogOwners();

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { unsupportedApprovalPolicy } from '../client/test-support/approval-policy.js';

import { describe, expect, it, spyOn } from 'bun:test';
import { McpClientManager } from '../client/mcp-client-manager.js';
import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import {} from '../client/test-support/mcpClientTestSupport.js';
import type { HostFeedbackSink } from './hostServices.js';
import { MCPOAuthTokenStorage } from '../auth/index.js';

const createFilesystem = installTestWorkspaceFilesystem();

function manager(
  feedback: HostFeedbackSink,
  tokenStorage: MCPOAuthTokenStorage,
): McpClientManager {
  const trust = { isTrustedFolder: () => true };
  const tools = new ToolRegistry(
    trust,
    {
      requestConfirmation: async (): Promise<never> => {
        throw new Error('Unexpected confirmation');
      },
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
  const catalog = createTestCatalogOwner();
  const prompts = catalog.promptPublication;
  const resources = catalog.resourcePublication;
  const workspace = createFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return new McpClientManager(
    {
      tokenStorage,
      openBrowser: async () => {
        throw new Error('Automatic browser must not open on 401');
      },
    },
    unsupportedApprovalPolicy(),
    '1.0',
    tools,
    prompts,
    resources,
    {
      ...trust,

      getAllowedMcpServers: () => undefined,
      getBlockedMcpServers: () => undefined,
      getMcpServers: () => ({}),
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
    feedback,
  );
}

describe('manager feedback ownership', () => {
  it('a real manager and client keep their unauthorized notice after another owner is constructed', async () => {
    let enter = (): void => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = new MCPOAuthTokenStorage({
      getCredentials: async () => null,
      setCredentials: async () => {},
      deleteCredentials: async () => {},
      listServers: async () => [],
      getAllCredentials: async () => new Map(),
      clearAll: async () => {},
    });
    const external: {
      fetch: (
        input: string | URL | Request,
        init?: RequestInit,
      ) => Promise<Response>;
    } = globalThis;
    const network = spyOn(external, 'fetch').mockImplementation(async () => {
      enter();
      await gate;
      return new Response(null, { status: 401 });
    });
    const noticesA: Array<Parameters<HostFeedbackSink>> = [];
    const noticesB: Array<Parameters<HostFeedbackSink>> = [];
    const a = manager((...args) => {
      noticesA.push(args);
    }, storage);
    let b: McpClientManager | undefined;
    const work = a.maybeDiscoverMcpServer('same', {
      httpUrl: 'https://same.test/mcp',
    });
    try {
      await entered;
      b = manager((...args) => {
        noticesB.push(args);
      }, storage);
      release();
      await work;
      expect(noticesA).toStrictEqual([
        [
          'error',
          "Server 'same' requires OAuth authentication. Please authenticate using: /mcp auth same",
        ],
      ]);
      expect(noticesB).toStrictEqual([]);
      expect(a.getMcpServerCount()).toBe(0);
    } finally {
      release();
      await work;
      await Promise.all([a.stop(), b?.stop()]);
      network.mockRestore();
    }
  }, 30000);
});
