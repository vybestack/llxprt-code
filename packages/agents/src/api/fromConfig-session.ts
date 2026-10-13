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
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionClientOwner } from '../session/session-client-owner.js';
import {
  AgentBootstrapError,
  buildAgentClientFactory,
} from './agentBootstrap.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import {
  AgentActivationBootstrap,
  type ActivationPreflight,
} from './activationPreflightState.js';
import type { ProviderActivationIntent } from './config-types.js';
import {
  assembleModelSelection,
  type ModelSelectionOperations,
} from './model-selection.js';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import { assembleSessionImages } from './session-image-assembly.js';
import type { SessionImageSelection } from './session-image-assembly.js';

export async function activateAdoptedSession(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  readRuntimeKind: () => RuntimeKind,
  client: SessionClientOwner,
  activation: ProviderActivationIntent | undefined,
  preflight: ActivationPreflight | undefined,
): Promise<void> {
  await resolveActivation(
    config,
    activation,
    preflight,
    assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      readRuntimeKind,
      () => client.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    () => client.getAgentClient(),
    (method) => client.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
}

export async function initializeAdoptedClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  oauth: OAuthManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFiles: ProviderFileLifecycle,
  mediaOwner: SessionMediaOwner | undefined,
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  activation: ProviderActivationIntent | undefined,
  preflight: ActivationPreflight | undefined,
  clientFactory: AgentClientFactory | undefined,
  borrowedClient: AgentClientContract | undefined,
  messageBus: MessageBus | undefined,
  imageOperation: SessionImageSelection['imageOperation'],
): Promise<SessionClientOwner> {
  settingsOwner.initializeProviderSelection(
    activation?.provider ?? config.getProvider(),
    activation?.model ?? config.getModel(),
  );
  const client = await adoptSessionClient(
    config,
    settings,
    settingsOwner,
    manager,
    contentGeneratorFactory,
    tokenizerFactory,
    providerFiles,
    (provider) => oauth.composeRetryOperations(provider),
    mediaOwner,
    readInstructions,
    workspacePaths,
    preflight,
    clientFactory,
    borrowedClient,
    messageBus,
  );
  client.bindInteractiveAuthRequests((prompt) =>
    oauth.requestInteractiveAuth(prompt),
  );
  assembleSessionImages(
    client,
    config.getTargetDir(),
    manager,
    oauth,
    settings,
    imageOperation,
  );
  const mainScope = config.getSessionId();
  client.bindProviderFiles(
    providerFiles,
    (provider) => oauth.composeRetryOperations(provider),
    (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : SessionClientOwner.cleanupProviderScope(providerFiles, scope),
  );
  return client;
}

function adoptSessionClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: RuntimeProviderManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFiles: ProviderFileLifecycle,
  composeRetryOperations: Parameters<
    SessionClientOwner['bindProviderFiles']
  >[1],
  mediaOwner: SessionMediaOwner | undefined,
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  preflight: ActivationPreflight | undefined,
  clientFactory: AgentClientFactory | undefined,
  borrowedClient: AgentClientContract | undefined,
  messageBus: MessageBus | undefined,
): Promise<SessionClientOwner> {
  if (preflight !== undefined) {
    const operation = preflight.operation;
    if (
      operation.tokenizerFactory !== tokenizerFactory ||
      operation.contentGeneratorFactory !== contentGeneratorFactory
    )
      throw new AgentBootstrapError(
        'Preflight factories cannot be replaced during adoption',
      );
    const client = operation.takeSessionClient(config);
    client.bindProviderFiles(providerFiles, composeRetryOperations);
    return Promise.resolve(client);
  }
  return SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    clientFactory ?? buildAgentClientFactory(),
    requireAdoptedStore(borrowedClient, mediaOwner),
    readInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    borrowedClient,
    messageBus,
  );
}

function requireAdoptedStore(
  borrowedClient: AgentClientContract | undefined,
  owner: SessionMediaOwner | undefined,
): LocalMediaStore {
  const store = borrowedClient?.mediaStore ?? owner?.store;
  if (store === undefined)
    throw new AgentBootstrapError(
      'Missing explicit session client media store',
    );
  return store;
}

async function resolveActivation(
  config: Config,
  activation: ProviderActivationIntent | undefined,
  preflight: ActivationPreflight | undefined,
  switchProvider: ProviderSwitcher,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  readClient: () => AgentClientContract,
  refreshAuth: (method?: string) => Promise<void>,
  selection: ModelSelectionOperations,
): Promise<void> {
  if (activation !== undefined) {
    const activationResult =
      preflight !== undefined
        ? AgentActivationBootstrap.consume(
            preflight,
            config,
            activation,
            manager,
          )
        : await executeProviderActivation(
            config,
            activation,
            switchProvider,
            settings,
            manager,
            refreshAuth,
            selection,
          );
    if (activationResult.authFailed) {
      const underlying = activationResult.authError;
      throw new AgentBootstrapError(
        `fromConfig activation failed: ${underlying instanceof Error ? underlying.message : String(underlying)}`,
        { cause: underlying },
      );
    }
  } else if (!readClient().isInitialized()) {
    await refreshAuth(undefined);
  }
}
