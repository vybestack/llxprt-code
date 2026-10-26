import { acquireSessionClient } from '../session/session-client-binding.js';
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import type { RuntimeSettingsState } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  NodeFileSystem,
  type ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';
import { populateProviderManager } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { rethrowAfterCleanup } from '../session/session-client-cleanup.js';
import { AgentBootstrapError } from './agentBootstrap.js';

import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentConfig } from './config-types.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import type {
  McpAssemblyOptions,
  McpTransferHandoff,
} from './mcpOAuthAssembly.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { CreatedSessionMcpPort } from './mcpRuntimePorts.js';

export async function assembleOwnedMcpRuntime(
  config: Config,
  options: McpAssemblyOptions & McpTransferHandoff,
  policy: RuntimePolicyOwner,
  settingsOwner: SessionSettingsOwner,
): Promise<McpRuntimeOwner> {
  return assembleMcpRuntime(
    config,
    options,
    { kind: 'supplied', owner: policy, ownership: 'runtime' },
    settingsOwner,
  );
}

export async function bindCreatedSessionClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFileLifecycle: ProviderFileLifecycle,
  media: SessionMediaOwner,
  mcp: CreatedSessionMcpPort,
  forceConfirmations: boolean,
  imageOperation: AgentConfig['imageOperation'],
  authority: CredentialAuthority,
): Promise<SessionClientOwner> {
  const client = await acquireSessionClient(
    config,
    settings,
    settingsOwner,
    providerManager,
    oauthManager,
    contentGeneratorFactory,
    tokenizerFactory,
    providerFileLifecycle,
    media.store,
    undefined,
    mcp.readInstructions,
    mcp.workspacePaths,
    authority,
    mcp.messageBus,
    imageOperation,
  );
  try {
    client.bindMcpRuntime(mcp);
    client.bindHooks();
    if (forceConfirmations)
      injectConfirmationForcingPolicy({
        addRule: (rule) => client.addSessionPolicyRule(rule),
      });
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      () => client.dispose(),
      'Session policy binding cleanup failed',
    );
  }
  return client;
}

export function registerProvidersOntoManager(
  isolatedManager: RuntimeProviderManager,
  settingsService: RuntimeSettingsState,
  config: Config,
  oauthManager: OAuthManager | undefined,
  contributions: ProviderContributionRegistry | undefined,
): void {
  if (!(isolatedManager instanceof ProviderManager))
    throw new AgentBootstrapError(
      'Owned provider registration requires its concrete manager',
    );
  if (oauthManager === undefined)
    throw new AgentBootstrapError(
      'Owned provider registration requires its OAuth manager',
    );
  populateProviderManager(
    isolatedManager,
    oauthManager,
    oauthManager.getTokenStore(),
    settingsService,
    new NodeFileSystem(),
    config,
    contributions,
    undefined,
    false,
    false,
    process.env.LLXPRT_FAKE_RESPONSES,
  );
}
