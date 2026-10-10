/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type {
  McpPromptRegistry,
  McpResourceRegistry,
} from '../../host/hostInterfaces.js';
import { createTestOAuthBinding } from '../test-support/index.js';
import { unsupportedApprovalPolicy } from '../test-support/approval-policy.js';

import { vi } from 'bun:test';
import type { Mock } from 'bun:test';
import { McpClientManager } from '../mcp-client-manager.js';
import { McpClient } from '../mcp-client.js';
import type { Config as BaseConfig } from '../test-support/mcpClientTestSupport.js';
import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
type Config = BaseConfig & { refreshMcpContext(): Promise<void> };
const createTestCatalogOwner = installTestCatalogOwners();
export const mockedMcpClient = (): Mock<(...args: never[]) => unknown> =>
  McpClient as unknown as Mock<(...args: never[]) => unknown>;

export function createMockMcpClient(): McpClient {
  return {
    connect: vi.fn(),
    discover: vi.fn(),
    disconnect: vi.fn(),
    getStatus: vi.fn(),
    invalidateCapabilities: vi.fn(),
    abortDiscovery: vi.fn(),
    getServerConfig: vi.fn().mockReturnValue({}),
    getInstructions: vi.fn().mockReturnValue(''),
  } as unknown as McpClient;
}

export function createMockConfig(overrides?: Partial<Config>): Config {
  return {
    isTrustedFolder: () => true,
    getMcpServers: () => ({
      'server-a': {},
      'server-b': {},
    }),
    getMcpServerCommand: () => '',

    getDebugMode: () => false,

    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,
    getExtensions: () => [],
    refreshMcpContext: vi.fn(),
    ...overrides,
  } as unknown as Config;
}

export function createToolRegistry(config: Config): ToolRegistry {
  return new ToolRegistry(
    config,
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
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function removeArtifactsWithServerAFailure(
  events: string[],
  serverName: string,
): void {
  events.push(`artifacts-${serverName}`);
  if (serverName === 'server-a') {
    throw new Error('artifact cleanup failed');
  }
}

const CLIENT_VERSION = '0.0.1';

export const createManager = (
  config: Config,
  prompts: McpPromptRegistry,
  resources: McpResourceRegistry,
  tools = createToolRegistry(config),
): McpClientManager =>
  new McpClientManager(
    createTestOAuthBinding(),
    unsupportedApprovalPolicy(),
    CLIENT_VERSION,
    tools,
    prompts,
    resources,
    config,
    config.refreshMcpContext,
  );

export function createOwnedManager(config: Config): {
  manager: McpClientManager;
  catalog: ReturnType<typeof createTestCatalogOwner>;
} {
  const catalog = createTestCatalogOwner();
  return {
    manager: createManager(
      config,
      catalog.promptPublication,
      catalog.resourcePublication,
    ),
    catalog,
  };
}
