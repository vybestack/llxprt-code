import { AgentBootstrapError } from './agentBootstrap.js';
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
  | 'filesystemService'
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
    options.filesystemService,
  );
}

export function runtimeOwnership(owned: boolean): 'runtime' | 'caller' {
  return owned ? 'runtime' : 'caller';
}
export function selectedOwnership(
  explicit: 'agent' | 'caller' | undefined,
  ownedByDefault: boolean,
): 'runtime' | 'caller' {
  return runtimeOwnership(
    explicit === undefined ? ownedByDefault : explicit === 'agent',
  );
}

export function assertMcpHandoff(
  mcp: McpRuntimeOwner | undefined,
  ownership: 'agent' | 'caller' | undefined,
  host: McpAssemblyOptions['mcpHost'],
  tokens: McpAssemblyOptions['mcpTokenStorage'],
): void {
  if (ownership === 'caller' && mcp === undefined) {
    throw new AgentBootstrapError(
      'Caller-owned MCP requires an explicit runtime handoff',
    );
  }
  if (mcp !== undefined && (host !== undefined || tokens !== undefined)) {
    throw new AgentBootstrapError(
      'MCP runtime handoff must retain its credential and browser capabilities',
    );
  }
}

export function assertAdoptedWorkspaceHandoff(
  hasMcp: boolean,
  lsp: AgentConfig['lspOwner'],
  lspOwnership: AgentConfig['lspOwnership'],
  filesystem: AgentConfig['filesystemOwner'],
  filesystemOwnership: AgentConfig['filesystemOwnership'],
  memory: AgentConfig['memoryOwner'],
): void {
  if (
    hasMcp &&
    [lsp, lspOwnership, filesystem, filesystemOwnership, memory].some(
      (value) => value !== undefined,
    )
  )
    throw new AgentBootstrapError(
      'An existing MCP handoff already owns its LSP lifetime',
    );
  if (lspOwnership === 'caller' && lsp === undefined)
    throw new AgentBootstrapError(
      'Caller-owned LSP requires an explicit workspace root',
    );
}

export function assertAdoptedWorkspaceRoots(
  filesystemOwnership: 'agent' | 'caller' | undefined,
  filesystem: AgentConfig['filesystemOwner'],
  definitionOwnership: 'agent' | 'caller' | undefined,
  definitions: AgentConfig['definitionOwner'],
): void {
  if (filesystemOwnership === 'caller' && filesystem === undefined)
    throw new Error(
      'Caller-owned filesystem requires an explicit workspace root',
    );
  if (definitionOwnership === 'caller' && definitions === undefined)
    throw new Error(
      'Caller-owned definitions require an explicit workspace root',
    );
}
