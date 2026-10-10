import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentConfig } from './config-types.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export type MemoryHandoff =
  | { readonly owner: WorkspaceMemoryOwner; readonly ownership?: 'caller' }
  | { readonly owner: WorkspaceMemoryOwner; readonly ownership: 'runtime' };

export function ownsMcpMemory(handoff: MemoryHandoff | undefined): boolean {
  return handoff === undefined || handoff.ownership === 'runtime';
}

export type McpAssemblyOptions = Pick<
  AgentConfig,
  | 'trustPort'
  | 'idePort'
  | 'memoryOwner'
  | 'mcpHost'
  | 'mcpTokenStorage'
  | 'lspOwner'
  | 'lspOwnership'
  | 'definitionOwner'
  | 'definitionOwnership'
  | 'filesystemOwner'
  | 'filesystemOwnership'
>;

export async function assembleMcpRuntime(
  config: Config,
  messageBus: MessageBus | undefined,
  options: McpAssemblyOptions & { readonly trustCleanup?: () => Promise<void> },
  policyOwner?: RuntimePolicyOwner,
  policyOwnership: 'runtime' | 'caller' = 'caller',
  settingsOwner?: SessionSettingsOwner,
): Promise<McpRuntimeOwner> {
  if (options.lspOwnership === 'caller' && options.lspOwner === undefined)
    throw new Error('Caller-owned LSP requires an explicit workspace root');
  if (
    options.filesystemOwnership === 'caller' &&
    options.filesystemOwner === undefined
  )
    throw new Error(
      'Caller-owned filesystem requires an explicit workspace root',
    );
  if (
    options.definitionOwnership === 'caller' &&
    options.definitionOwner === undefined
  )
    throw new Error(
      'Caller-owned definitions require an explicit workspace root',
    );
  const feedback = options.mcpHost?.emitFeedback;
  const ownership =
    options.lspOwnership ??
    (options.lspOwner === undefined ? 'agent' : 'caller');
  const filesystemOwnership =
    options.filesystemOwnership ??
    (options.filesystemOwner === undefined ? 'agent' : 'caller');
  return McpRuntimeOwner.create(
    {
      getAuthProviderFactory: options.mcpHost?.getAuthProviderFactory,
      tokenStorage: new MCPOAuthTokenStorage(
        options.mcpTokenStorage ??
          new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
      ),
      openBrowser: options.mcpHost?.openBrowser ?? openBrowserSecurely,
    },
    config,
    messageBus,
    { emitFeedback: feedback },
    undefined,
    undefined,
    policyOwner,
    policyOwnership,
    options.lspOwner,
    ownership === 'agent' ? 'runtime' : 'caller',
    options.filesystemOwner,
    filesystemOwnership === 'agent' ? 'runtime' : 'caller',
    options.memoryOwner === undefined
      ? undefined
      : {
          owner: options.memoryOwner.owner,
          ownership:
            options.memoryOwner.ownership === 'agent' ? 'runtime' : 'caller',
        },
    options.definitionOwner,
    options.definitionOwnership === 'agent' ||
      options.definitionOwner === undefined
      ? 'runtime'
      : 'caller',
    options.trustPort,
    options.idePort,
    options.trustCleanup,
    undefined,
    settingsOwner?.readMcpSettingsBinding(),
  );
}
