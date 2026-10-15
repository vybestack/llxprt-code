import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import type { AgentConfig } from '../../config-types.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  MCPOAuthTokenStorage,
  type McpOAuthBinding,
  type OAuthCredentials,
} from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
function createTestOAuthBinding(): McpOAuthBinding {
  let credentials = new Map<string, OAuthCredentials>();
  return {
    openBrowser: async () => {
      throw new Error('Browser was not configured for this test');
    },
    tokenStorage: new MCPOAuthTokenStorage({
      getCredentials: async (name) => credentials.get(name) ?? null,
      setCredentials: async (value) => {
        credentials = new Map(credentials).set(value.serverName, value);
      },
      deleteCredentials: async (name) => {
        credentials = new Map(
          [...credentials].filter(([serverName]) => serverName !== name),
        );
      },
      listServers: async () => [...credentials.keys()],
      getAllCredentials: async () => new Map(credentials),
      clearAll: async () => {
        credentials = new Map();
      },
    }),
  };
}
export async function buildTestMcpRuntime(
  config: Config,
  messageBus: MessageBus,
  overrides: Readonly<Partial<AgentConfig>>,
  extensionLoader?: ExtensionLoader,
  policyOwner?: RuntimePolicyOwner,
  skillOperations?: WorkspaceSkillAssemblyOperations,
): Promise<McpRuntimeOwner> {
  const binding = createTestOAuthBinding();
  const lspOwnership =
    overrides.lspOwnership ??
    (overrides.lspOwner === undefined ? 'agent' : 'caller');
  const filesystemOwnership =
    overrides.filesystemOwnership ??
    (overrides.filesystemOwner === undefined ? 'agent' : 'caller');
  return McpRuntimeOwner.create(
    {
      tokenStorage: overrides.mcpTokenStorage
        ? new MCPOAuthTokenStorage(overrides.mcpTokenStorage)
        : binding.tokenStorage,
      openBrowser: overrides.mcpHost?.openBrowser ?? binding.openBrowser,
    },
    config,
    messageBus,
    overrides.mcpHost,
    undefined,
    extensionLoader,
    policyOwner,
    'runtime',
    overrides.lspOwner,
    lspOwnership === 'agent' ? 'runtime' : 'caller',
    overrides.filesystemOwner,
    filesystemOwnership === 'agent' ? 'runtime' : 'caller',
    undefined,
    overrides.definitionOwner,
    overrides.definitionOwnership === 'agent' ||
      overrides.definitionOwner === undefined
      ? 'runtime'
      : 'caller',
    undefined,
    undefined,
    undefined,
    skillOperations,
  );
}
