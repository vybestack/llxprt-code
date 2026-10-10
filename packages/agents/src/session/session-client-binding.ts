/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  RuntimeProviderManager,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { bindTelemetry } from '../api/agentBootstrap.js';

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

export function bindClientSettings(
  client: AgentClientContract,
  config: Config,
  settingsOwner: SessionSettingsOwner,
  runtimeId: string,
): void {
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
    ),
  );
}

type DefinitionReaders = Parameters<
  NonNullable<AgentClientContract['bindWorkspaceDefinitions']>
>;

/** What a factory-created client is bound to; owned by the session client owner. */
export interface FactoryClientBindings {
  readonly config: Config;
  readonly mediaStore: LocalMediaStore;
  readonly settingsOwner: SessionSettingsOwner;
  readonly manager: RuntimeProviderManager;
  readonly tokenizerFactory: RuntimeTokenizerFactory;
  readonly runtimeId: string;
  readonly toolSelection: Parameters<
    AgentClientContract['bindToolSelection']
  >[0];
  readonly definitions:
    | {
        readonly profiles: DefinitionReaders[0];
        readonly subagents: DefinitionReaders[1];
      }
    | undefined;
  readonly readIdeContext: Parameters<
    NonNullable<AgentClientContract['bindIdeContext']>
  >[0];
  readonly isIdeEnabled: () => boolean;
  readonly providerFiles:
    | {
        readonly lifecycle: object;
        readonly composeRetryOperations: (
          provider: string,
        ) => ProviderRetryOperations;
      }
    | undefined;
}

export function bindFactoryClient(
  client: AgentClientContract,
  bindings: FactoryClientBindings,
): void {
  client.assertConfig(bindings.config);
  if (client.mediaStore !== bindings.mediaStore)
    throw new Error('Session client must retain its explicit media store');
  if (bindings.definitions !== undefined)
    client.bindWorkspaceDefinitions?.(
      bindings.definitions.profiles,
      bindings.definitions.subagents,
    );
  client.bindIdeContext?.(bindings.readIdeContext, bindings.isIdeEnabled);
  client.bindToolSelection(bindings.toolSelection);
  bindTelemetry(
    client,
    bindings.config,
    bindings.settingsOwner,
    bindings.manager,
  );
  bindClientSettings(
    client,
    bindings.config,
    bindings.settingsOwner,
    bindings.runtimeId,
  );
  if (bindings.providerFiles !== undefined)
    client.bindProviderFiles?.(
      bindings.providerFiles.lifecycle,
      bindings.providerFiles.composeRetryOperations,
    );
  bindClientTokenization(client, bindings.tokenizerFactory);
  client.bindProviderSelection?.(
    createProviderAdapterFromManager(bindings.manager),
    bindings.manager,
  );
}
