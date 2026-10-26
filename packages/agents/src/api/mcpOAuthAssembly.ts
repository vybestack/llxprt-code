/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  SessionMcpSettingsReads,
  SessionSettingsOwner,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
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
import type {
  McpCapability,
  McpOwnerHandoff,
  McpPolicyHandoff,
  McpTrustHandoff,
} from './mcp-runtime-construction.js';
import { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export type MemoryHandoff =
  | { readonly owner: WorkspaceMemoryOwner; readonly ownership?: 'caller' }
  | { readonly owner: WorkspaceMemoryOwner; readonly ownership: 'runtime' };

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

export interface McpTransferHandoff {
  /**
   * Called once MCP construction has taken responsibility for every supplied
   * owner handed over with runtime ownership.
   */
  readonly onTransferAccepted?: () => void;
}

/**
 * The host's explicit choice of who releases an owner it hands over. A key the
 * host set to `agent` means MCP owns it; an omitted key keeps the handover
 * caller-owned, which is what the option meant before it had a name.
 */
function handoffOf<Owner>(
  owner: Owner | undefined,
  ownership: 'agent' | 'runtime' | 'caller' | undefined,
): McpOwnerHandoff<Owner> {
  if (owner === undefined) return { kind: 'none' };
  return {
    kind: 'supplied',
    owner,
    ownership:
      ownership === 'agent' || ownership === 'runtime' ? 'runtime' : 'caller',
  };
}

export async function assembleMcpRuntime(
  config: Config,
  options: McpAssemblyOptions &
    McpTransferHandoff & { readonly trustCleanup?: () => Promise<void> },
  policy: McpPolicyHandoff,
  settingsOwner?: SessionSettingsOwner,
): Promise<McpRuntimeOwner> {
  const feedback = options.mcpHost?.emitFeedback ?? defaultFeedbackSink;
  const trust: McpTrustHandoff =
    options.trustPort === undefined
      ? { kind: 'none' }
      : {
          kind: 'supplied',
          owner: options.trustPort,
          cleanup: options.trustCleanup,
        };
  const settingsReads = settingsOwner?.readMcpSettingsBinding();
  const mcpSettings: McpCapability<SessionMcpSettingsReads> =
    settingsReads === undefined
      ? { kind: 'none' }
      : { kind: 'supplied', capability: settingsReads };
  // create() retains the supplied owners synchronously, before its first
  // await, so the handoff below never leaves a window without an authority.
  const runtime = McpRuntimeOwner.create(
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
      extensionLoader: { kind: 'none' },
      policy,
      lsp: handoffOf(options.lspOwner, options.lspOwnership),
      filesystem: handoffOf(
        options.filesystemOwner,
        options.filesystemOwnership,
      ),
      filesystemService:
        options.filesystemService === undefined
          ? { kind: 'none' }
          : {
              kind: 'supplied',
              owner: options.filesystemService,
              ownership: 'caller',
            },
      memory:
        options.memoryOwner === undefined
          ? { kind: 'none' }
          : {
              kind: 'supplied',
              owner: options.memoryOwner.owner,
              ownership:
                options.memoryOwner.ownership === 'agent' ||
                options.memoryOwner.ownership === undefined
                  ? 'runtime'
                  : options.memoryOwner.ownership,
            },
      definitions: handoffOf(
        options.definitionOwner,
        options.definitionOwnership,
      ),
      trust,
      ide: handoffOf(options.idePort, 'caller'),
    },
    {
      emitFeedback: feedback,
      skillOperations: { kind: 'none' },
      mcpSettings,
    },
  );
  options.onTransferAccepted?.();
  return runtime;
}
