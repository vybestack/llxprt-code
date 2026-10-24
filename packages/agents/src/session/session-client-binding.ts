import type {
  ContentGenerator,
  RuntimeContentGeneratorFactory,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { randomUUID } from 'node:crypto';
import {
  AgentBootstrapError,
  buildAgentClientFactory,
} from '../api/agentBootstrap.js';
import {
  assembleSessionImages,
  type SessionImageSelection,
} from '../api/session-image-assembly.js';
import {
  cleanupProviderScope,
  rethrowAfterCleanup,
} from './session-client-cleanup.js';
import { SessionClientOwner } from './session-client-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
} from '@vybestack/llxprt-code-core/config/models.js';
import type {
  AgentClientContract,
  AgentClientFactory,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

export function captureSessionRuntimeState(
  settings: SessionSettingsOwner,
  identity: Pick<AgentRuntimeState, 'runtimeId' | 'sessionId' | 'proxyUrl'>,
): AgentRuntimeState {
  return createAgentRuntimeState({
    ...identity,
    provider: settings.readSelectedProvider() ?? UNCONFIGURED_PROVIDER,
    model: settings.readSelectedModel() ?? PLACEHOLDER_MODEL,
    baseUrl: settings.readSelectedEndpoint(),
  });
}

export function bindClientTokenization(
  client: AgentClientContract,
  tokenizerFactory: RuntimeTokenizerFactory,
): void {
  client.bindTokenization?.(
    (provider, model) => tokenizerFactory.getTokenizer(provider, model),
    Object.freeze({
      estimatePrompt: (request) => tokenizerFactory.estimatePrompt(request),
      claimsModel: (model) => tokenizerFactory.claimsModel?.(model) ?? false,
      getEstimatorFamily: (model) =>
        tokenizerFactory.getEstimatorFamily?.(model),
    }),
  );
}

export function assertClientOwnership(
  client: AgentClientContract,
  config: Config,
  media: LocalMediaStore,
): void {
  client.assertConfig(config);
  if (client.mediaStore !== media)
    throw new Error('Session client must retain its explicit media store');
}

export function bindClientModels(
  client: AgentClientContract,
  manager: RuntimeProviderManager,
  tokenizer: RuntimeTokenizerFactory,
): void {
  bindClientTokenization(client, tokenizer);
  client.bindProviderSelection?.(
    createProviderAdapterFromManager(manager),
    manager,
  );
}

export function bindClientDefinitions(
  client: AgentClientContract,
  profiles:
    | Parameters<
        NonNullable<AgentClientContract['bindWorkspaceDefinitions']>
      >[0]
    | undefined,
  subagents:
    | Parameters<
        NonNullable<AgentClientContract['bindWorkspaceDefinitions']>
      >[1]
    | undefined,
): void {
  if (profiles !== undefined && subagents !== undefined)
    client.bindWorkspaceDefinitions?.(profiles, subagents);
}

export function bindClientSettings(
  client: AgentClientContract,
  config: Config,
  settingsOwner: SessionSettingsOwner,
  runtimeId: string,
  sessionId: string,
  requestFetch: NetworkFetch,
): void {
  client.bindModelNotifications?.((listener) =>
    settingsOwner.subscribeModelChanges(listener),
  );
  client.bindRuntimeSettings(
    () => settingsOwner.readRuntimePolicy(),
    () => settingsOwner.readToolGovernance(config.getExcludeTools() ?? []),
  );
  client.bindProviderInvocation((name, parameters, signal) =>
    settingsOwner.prepareProviderInvocation(
      runtimeId,
      name,
      parameters,
      signal,
      sessionId,
      requestFetch,
    ),
  );
}

export function requireSessionPolicy(
  owner: SessionPolicyOwner | undefined,
): SessionPolicyOwner {
  if (owner === undefined)
    throw new Error('Missing session policy composition');
  return owner;
}

export type SessionClientFactory = (
  ...args: Parameters<AgentClientFactory>
) => AgentClientContract | undefined;

export function captureGenerationState(
  settings: SessionSettingsOwner,
  state: AgentRuntimeState,
): AgentRuntimeState {
  return captureSessionRuntimeState(settings, {
    runtimeId: `${state.sessionId}#generation#${randomUUID()}`,
    sessionId: state.sessionId,
    proxyUrl: state.proxyUrl,
  });
}

export function assertBorrowedSessionClient(
  client: AgentClientContract | undefined,
  config: Config,
  manager: RuntimeProviderManager | undefined,
  hasMcp: boolean,
  preflight: AgentClientContract | undefined,
): void {
  if (client === undefined) return;
  if (!hasMcp)
    throw new AgentBootstrapError(
      'Borrowed session client requires an explicit MCP runtime handoff',
    );
  client.assertConfig(config);
  if (manager === undefined)
    throw new AgentBootstrapError(
      'Initialized Config adoption requires an explicit providerManager owner',
    );
  client.assertProviderManager(manager);
  if (preflight !== undefined && preflight !== client)
    throw new AgentBootstrapError(
      'Borrowed client differs from the preflight session client',
    );
}

export function assertBorrowedClientAcquisition(
  borrowedClient: AgentClientContract | undefined,
  config: Config,
  manager: RuntimeProviderManager,
  mediaStore: LocalMediaStore,
): void {
  if (borrowedClient !== undefined) {
    borrowedClient.assertConfig(config);
    borrowedClient.assertProviderManager(manager);
    if (!borrowedClient.isInitialized())
      throw new Error('Borrowed session client must be initialized');
    if (borrowedClient.mediaStore !== mediaStore)
      throw new Error(
        'Borrowed session client must retain its explicit media store',
      );
  }
}

export async function acquireSessionClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager | undefined,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFileLifecycle: ProviderFileLifecycle,
  mediaStore: LocalMediaStore,
  factory: AgentClientFactory = buildAgentClientFactory(),
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  messageBus?: MessageBus,
  imageOperation?: SessionImageSelection['imageOperation'],
  borrowedClient?: AgentClientContract,
): Promise<SessionClientOwner> {
  const client = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    providerManager,
    factory,
    mediaStore,
    readInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    borrowedClient,
    messageBus,
  );
  try {
    if (oauthManager !== undefined)
      client.bindInteractiveAuthRequests((prompt) =>
        oauthManager.requestInteractiveAuth(prompt),
      );
    assembleSessionImages(
      client,
      config.getTargetDir(),
      providerManager,
      oauthManager,
      settings,
      imageOperation,
    );
    const mainScope = config.getSessionId();
    client.bindProviderFiles(
      providerFileLifecycle,
      (provider) => oauthManager?.composeRetryOperations(provider) ?? {},
      (scope) =>
        scope === mainScope
          ? Promise.resolve()
          : cleanupProviderScope(providerFileLifecycle, scope),
    );
  } catch (error) {
    await rethrowAfterCleanup(
      error,
      () => client.dispose(),
      'Session acquisition cleanup failed',
    );
  }
  return client;
}
