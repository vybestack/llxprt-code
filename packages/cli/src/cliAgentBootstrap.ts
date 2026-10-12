import { cliSkillOperations } from './config/configBuilder.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createGitHubBrokerClient } from './config/githubBrokerClient.js';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

import {
  type SessionSettingsOwner,
  type RuntimePolicyOwner,
  type LlxprtExtension,
  type WorkspaceSkillOperations,
  type RuntimeProviderManager,
  type Config,
  PLACEHOLDER_MODEL,
  coreEvents,
  openBrowserSecurely,
} from '@vybestack/llxprt-code-core';

import {
  MCPOAuthTokenStorage,
  KeychainTokenStorage,
} from '@vybestack/llxprt-code-mcp';
import type { McpAuthProviderFactory } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';

import { McpRuntimeOwner } from '@vybestack/llxprt-code-agents';

import {
  fromConfig,
  type Agent,
  type ProviderActivationIntent,
  type ActivationPreflight,
} from '@vybestack/llxprt-code-agents';

import { createRuntimeActivationBindings } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { registerCleanup } from './utils/cleanup.js';
import {
  hasProfileAuthEphemerals,
  snapshotProfileAuthEphemerals,
} from './config/profileAuthEphemerals.js';

export interface ForegroundAgentOptions {
  readonly githubBrokerClient?: GitHubBrokerClient;
  readonly oauthManager?: OAuthManager;
  readonly providerFileLifecycle?: ProviderFileLifecycle;
  readonly settingsService: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policyOwner?: RuntimePolicyOwner;
  readonly onExtensionRestart?: (
    restart: (extension: LlxprtExtension) => Promise<void>,
  ) => void;
  readonly onSkills?: (
    skills: Pick<
      WorkspaceSkillOperations,
      'list' | 'find' | 'reload' | 'isAdminEnabled'
    >,
  ) => void;
  readonly providerManager: RuntimeProviderManager;
  config: Config;
  getMcpAuthProviderFactory?: (
    type: string,
  ) => McpAuthProviderFactory | undefined;
  activationPreflight?: ActivationPreflight;
  activationPreflightIntent?: ProviderActivationIntent;
}

/**
 * Single creation point for the interactive CLI Agent.
 *
 * Adopts the already-built {@link Config} through the public {@link fromConfig}
 * entrypoint. Per #2378 Phase A the Agent now OWNS the single session
 * {@link MessageBus} and {@link Config.initialize}: `createForegroundAgent`
 * does NOT construct or thread a session bus — `fromConfig` builds exactly one
 * bus from the Config's policy engine and exposes it via
 * `agent.getMessageBus()`. No second ProviderManager/MessageBus is constructed.
 * `fromConfig` keeps `configOwnership` caller-owned (its default), which means
 * the returned Agent's `dispose()` deliberately SKIPS `config.dispose()` —
 * recording/Config teardown remains owned by the existing bootstrap.
 *
 * #2374: Provider activation + auth is now declarative — the activation
 * intent is passed to fromConfig instead of imperatively calling the provider
 * switch primitive after construction. The intent reproduces the exact
 * precedence the old restoreActiveProvider followed: profile auth ephemerals
 * are snapshotted so the executor can preserve them across the switch; the
 * provider is derived from config (or the agent fallback); the model is
 * reasserted when it is not the placeholder sentinel.
 */
export async function createForegroundAgent({
  githubBrokerClient,
  oauthManager,
  providerFileLifecycle,
  config,
  settingsService,
  settingsOwner,
  onSkills,
  onExtensionRestart,
  policyOwner,
  providerManager,
  getMcpAuthProviderFactory,
  activationPreflight,
  activationPreflightIntent,
}: ForegroundAgentOptions): Promise<Agent> {
  const activation = foregroundActivationIntent(config, settingsOwner);

  const feedback = (
    ...args: Parameters<typeof coreEvents.emitFeedback>
  ): void => coreEvents.emitFeedback(...args);
  const mcpRuntime = await McpRuntimeOwner.create(
    {
      getAuthProviderFactory: getMcpAuthProviderFactory,
      tokenStorage: new MCPOAuthTokenStorage(
        new KeychainTokenStorage('llxprt-cli-mcp-oauth', feedback),
      ),
      openBrowser: openBrowserSecurely,
    },
    config,
    policyOwner?.session.messageBus,
    { emitFeedback: feedback },
    undefined,
    undefined,
    policyOwner,
    policyOwner === undefined ? 'runtime' : 'caller',
    undefined,
    'runtime',
    activationPreflight?.operation.workspaceFilesystem,
    'runtime',
    activationPreflight === undefined
      ? undefined
      : {
          owner: activationPreflight.operation.workspaceMemory,
          ownership: 'runtime',
        },
    undefined,
    undefined,
    activationPreflight?.operation.workspaceTrust,
    undefined,
    activationPreflight?.operation.trustCleanup,
    cliSkillOperations(config),
  );
  const agent = await fromConfig({
    githubBrokerClient: githubBrokerClient ?? createGitHubBrokerClient(),
    oauthManager,
    providerFileLifecycle,
    settingsService,
    settingsOwner,
    config,
    providerManager,
    runtimeActivationBindings: createRuntimeActivationBindings(),
    sessionId: config.getSessionId(),
    sessionIdentityOwnership: 'config',
    mcpRuntime,
    mcpOwnership: 'agent',
    activation: activationPreflightIntent ?? activation,
    ...(activationPreflight !== undefined ? { activationPreflight } : {}),
  });

  onExtensionRestart?.((extension) =>
    mcpRuntime.extensionOperations.restart(extension),
  );
  const skills = mcpRuntime.workspaceSkills.operations;
  onSkills?.({
    list: (all) => skills.list(all),
    find: (name) => skills.find(name),
    reload: () => skills.reload(),
    isAdminEnabled: () => skills.isAdminEnabled(),
  });

  // Wire the session policy engine to UPDATE_POLICY bus messages ("Allow for
  // this session/for all future sessions") against the exact Config engine
  // and Agent bus the scheduler uses.

  registerCleanup(() => agent.dispose());

  return agent;
}

function foregroundActivationIntent(
  config: Config,
  settingsOwner: SessionSettingsOwner,
): ProviderActivationIntent {
  const provider = settingsOwner.readSelectedProvider();
  const model = settingsOwner.readSelectedModel() ?? config.getModel();
  const profileAuthEphemerals = snapshotProfileAuthEphemerals(settingsOwner);

  // Build the activation intent mirroring the old restoreActiveProvider logic:
  // - authMode 'auto' (auth initialization with provider auth + fallback)
  // - provider from config
  // - model reasserted when not the placeholder sentinel
  // - profile auth ephemerals snapshotted so the executor preserves them
  return {
    provider: provider ?? undefined,
    authMode: 'auto',
    ...(model && model !== PLACEHOLDER_MODEL ? { model } : {}),
    ...(hasProfileAuthEphemerals(profileAuthEphemerals)
      ? { cliOverrides: { keyName: undefined } }
      : {}),
  };
}
