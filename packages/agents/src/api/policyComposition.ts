import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  NodeFileSystem,
  type ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';
import { populateProviderManager } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import type {
  RuntimeProviderManager,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { RuntimeSettingsState } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { rethrowAfterCleanup } from '../session/session-client-cleanup.js';
import { AgentBootstrapError } from './agentBootstrap.js';

import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { createIsolatedSessionClient } from './agentRuntimeAssembly.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentConfig } from './config-types.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import type { McpAssemblyOptions } from './mcpOAuthAssembly.js';

export async function assembleOwnedMcpRuntime(
  config: Config,
  bus: MessageBus,
  options: McpAssemblyOptions,
  policy: RuntimePolicyOwner,
  settingsOwner: SessionSettingsOwner,
): Promise<McpRuntimeOwner> {
  return assembleMcpRuntime(
    config,
    bus,
    options,
    policy,
    'runtime',
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
  factory: AgentClientFactory | undefined,
  mcp: McpRuntimeOwner,
  registration: Parameters<SessionClientOwner['bindMcpRuntime']>[1],
  forceConfirmations: boolean,
  imageOperation: AgentConfig['imageOperation'],
): Promise<SessionClientOwner> {
  const client = await createIsolatedSessionClient(
    config,
    settings,
    settingsOwner,
    providerManager,
    oauthManager,
    contentGeneratorFactory,
    tokenizerFactory,
    providerFileLifecycle,
    media,
    factory,
    mcp.readInstructions,
    mcp.workspacePaths,
    mcp.messageBus,
    imageOperation,
  );
  try {
    client.bindMcpRuntime(mcp, registration);
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

export async function createOwnedSessionRoots(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFileLifecycle: ProviderFileLifecycle,
  media: SessionMediaOwner,
  factory: AgentClientFactory | undefined,
  options: McpAssemblyOptions,
  policy: RuntimePolicyOwner,
  registration: Parameters<SessionClientOwner['bindMcpRuntime']>[1],
  forceConfirmations: boolean,
  imageOperation: AgentConfig['imageOperation'],
): Promise<readonly [McpRuntimeOwner, SessionClientOwner]> {
  const mcp = await assembleOwnedMcpRuntime(
    config,
    policy.session.messageBus,
    options,
    policy,
    settingsOwner,
  );
  try {
    return [
      mcp,
      await bindCreatedSessionClient(
        config,
        settings,
        settingsOwner,
        providerManager,
        oauthManager,
        contentGeneratorFactory,
        tokenizerFactory,
        providerFileLifecycle,
        media,
        factory,
        mcp,
        registration,
        forceConfirmations,
        imageOperation,
      ),
    ];
  } catch (error) {
    try {
      await mcp.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Session root creation failed',
      );
    }
    throw error;
  }
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
