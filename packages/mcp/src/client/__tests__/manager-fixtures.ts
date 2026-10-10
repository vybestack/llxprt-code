/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { installTestCatalogOwners } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createTestOAuthBinding } from '../test-support/index.js';
import { unsupportedApprovalPolicy } from '../test-support/approval-policy.js';

import { vi, type Mock } from 'bun:test';
import { McpClientManager } from '../mcp-client-manager.js';
import { McpClient } from '../mcp-client.js';

import type { Config as BaseConfig } from '../test-support/mcpClientTestSupport.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type {
  McpPromptRegistry,
  McpResourceRegistry,
} from '../../host/hostInterfaces.js';
import type { PromptRegistry } from '../test-support/mcpClientTestSupport.js';
import type { ResourceRegistry } from '../test-support/mcpClientTestSupport.js';

type Config = BaseConfig & { refreshMcpContext(): Promise<void> };
const createTestCatalogOwner = installTestCatalogOwners();
export const createExtensionManager = (
  mockedMcpClient?: Record<string, ReturnType<typeof vi.fn>>,
  servers: Record<string, unknown> = {},
) => {
  if (mockedMcpClient !== undefined) {
    (
      McpClient as unknown as Mock<(...args: never[]) => unknown>
    ).mockReturnValue(mockedMcpClient as unknown as McpClient);
  }
  const promptRegistry = {
    removePromptsByServer: vi.fn(),
  } as unknown as PromptRegistry;
  const resourceRegistry = {
    removeResourcesByServer: vi.fn(),
  } as unknown as ResourceRegistry;
  const toolRegistry = {
    removeMcpToolsByServer: vi.fn(),
  } as unknown as ToolRegistry;
  const mockConfigCatalog = createTestCatalogOwner();
  const mockConfigPrompts = {
    ...mockConfigCatalog.promptPublication,
    ...promptRegistry,
  };
  const mockConfigResources = {
    ...mockConfigCatalog.resourcePublication,
    ...resourceRegistry,
  };
  const mockConfig = {
    isTrustedFolder: () => true,
    getMcpServers: () => servers,
    getMcpServerCommand: () => '',

    getDebugMode: () => false,

    getEnableExtensionReloading: () => false,
    getAllowedMcpServers: () => undefined,
    getBlockedMcpServers: () => undefined,

    refreshMcpContext: vi.fn(),
  } as unknown as Config;
  const manager = createManagerWithContext(
    toolRegistry,
    mockConfig,
    mockConfigPrompts,
    mockConfigResources,
  );
  return {
    manager,
    mockConfig,
    promptRegistry,
    resourceRegistry,
    toolRegistry,
  };
};

export function createManagerWithContext(
  registry: ToolRegistry,
  config: Config,
  prompts: McpPromptRegistry,
  resources: McpResourceRegistry,
): McpClientManager {
  return new McpClientManager(
    createTestOAuthBinding(),
    unsupportedApprovalPolicy(),
    '0.0.1',
    registry,
    prompts,
    resources,
    config,
    config.refreshMcpContext,
  );
}
