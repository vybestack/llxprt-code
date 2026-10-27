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
import type {
  CredentialAuthority,
  OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { randomUUID } from 'node:crypto';
import { buildAgentClientFactory } from '../api/agentBootstrap.js';
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

function bindClientTokenization(
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

/**
 * The session the client is acquired for: its config, the bus the client
 * publishes on, the workspace reads it inherits and the image capability it may
 * run.
 */
export interface SessionClientTarget {
  readonly config: Config;
  /** The policy owner's bus, or none when the caller composes no policy yet. */
  readonly messageBus: MessageBus | undefined;
  readonly workspacePaths: WorkspacePathOperations;
  readonly readInstructions: () => string | undefined;
  readonly imageOperation: SessionImageSelection['imageOperation'];
}

/** The settings service a client reads, and the owner that owns it. */
export interface SessionClientSettings {
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
}

/** The owners and factories a client is built from, all created before it. */
export interface SessionClientConstruction {
  readonly contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>;
  readonly tokenizerFactory: RuntimeTokenizerFactory;
  readonly providerFiles: ProviderFileLifecycle;
  readonly mediaStore: LocalMediaStore;
  readonly authority: CredentialAuthority;
  /** Defaults to the production client factory when a caller observes none. */
  readonly clientFactory: AgentClientFactory | undefined;
}

export async function acquireSessionClient(
  target: SessionClientTarget,
  settings: SessionClientSettings,
  providerManager: RuntimeProviderManager,
  oauth: OAuthManager,
  construction: SessionClientConstruction,
): Promise<SessionClientOwner> {
  const { config, messageBus, readInstructions, workspacePaths } = target;
  const client = await SessionClientOwner.create(
    {
      config,
      mediaStore: construction.mediaStore,
      readMcpInstructions: readInstructions,
      workspacePaths,
      settingsOwner: settings.settingsOwner,
    },
    {
      manager: providerManager,
      factory: construction.clientFactory ?? buildAgentClientFactory(),
      contentGeneratorFactory: construction.contentGeneratorFactory,
      tokenizerFactory: construction.tokenizerFactory,
    },
    {
      readTaskSchemaPolicy: assembleTaskSchemaPolicy(settings.settings),
      authority: construction.authority,
      borrowedBus: messageBus,
    },
  );
  try {
    client.bindInteractiveAuthRequests((prompt) =>
      oauth.requestInteractiveAuth(prompt),
    );
    assembleSessionImages(
      client,
      config.getTargetDir(),
      providerManager,
      oauth,
      settings.settings,
      target.imageOperation,
    );
    const mainScope = config.getSessionId();
    client.clients.bindProviderFiles(
      construction.providerFiles,
      (provider) => oauth.composeRetryOperations(provider),
      (scope) =>
        scope === mainScope
          ? Promise.resolve()
          : cleanupProviderScope(construction.providerFiles, scope),
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
