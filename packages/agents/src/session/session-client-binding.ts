import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionPolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AgentClientFactory,
  AgentClientContract,
} from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import {
  PLACEHOLDER_MODEL,
  UNCONFIGURED_PROVIDER,
} from '@vybestack/llxprt-code-core/config/models.js';

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
  requestFetch?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
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
