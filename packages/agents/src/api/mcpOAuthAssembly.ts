import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { WorkspaceMemoryOwner } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
  McpClientManager,
} from '@vybestack/llxprt-code-mcp';
import { defaultFeedbackSink } from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import { openBrowserSecurely } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentConfig } from './config-types.js';
import type { McpPolicyHandoff } from './mcp-runtime-construction.js';
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
  | 'filesystemService'
  | 'filesystemOwner'
  | 'filesystemOwnership'
>;

export async function assembleMcpRuntime(
  config: Config,
  options: McpAssemblyOptions & { readonly trustCleanup?: () => Promise<void> },
  policy: McpPolicyHandoff | undefined,
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
  const feedback = options.mcpHost?.emitFeedback ?? defaultFeedbackSink;
  const ownership =
    options.lspOwnership ??
    (options.lspOwner === undefined ? 'agent' : 'caller');
  const filesystemOwnership =
    options.filesystemOwnership ??
    (options.filesystemOwner === undefined ? 'agent' : 'caller');
  return McpRuntimeOwner.create(
    {
      oauth: {
        getAuthProviderFactory: options.mcpHost?.getAuthProviderFactory,
        tokenStorage: new MCPOAuthTokenStorage(
          options.mcpTokenStorage ??
            new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
        ),
        openBrowser: options.mcpHost?.openBrowser ?? openBrowserSecurely,
      },
      config,
      managerFactory: McpClientManager,
      extensionLoader: undefined,
      policy,
      lspOwner: options.lspOwner,
      lspOwnership: ownership === 'agent' ? 'runtime' : 'caller',
      filesystemOwner: options.filesystemOwner,
      filesystemOwnership:
        filesystemOwnership === 'agent' ? 'runtime' : 'caller',
      filesystemService: options.filesystemService,
      memoryOwner:
        options.memoryOwner === undefined
          ? undefined
          : {
              owner: options.memoryOwner.owner,
              ownership:
                options.memoryOwner.ownership === 'agent'
                  ? 'runtime'
                  : 'caller',
            },
      definitionOwner: options.definitionOwner,
      definitionOwnership:
        options.definitionOwnership === 'agent' ||
        options.definitionOwner === undefined
          ? 'runtime'
          : 'caller',
      trustPort: options.trustPort,
      trustCleanup: options.trustCleanup,
      idePort: options.idePort,
    },
    {
      emitFeedback: feedback,
      skillOperations: undefined,
      mcpSettings: settingsOwner?.readMcpSettingsBinding(),
    },
  );
}
