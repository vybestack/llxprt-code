/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import { registerProvidersOntoManager } from './policyComposition.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { applyRuntimeEphemerals } from './agentConfig.adapter.js';
import type { ParsedAgentConfig } from './config-schema.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  TokenStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';
import {
  createOAuthProfileReads,
  type ProviderContributionRegistry,
} from '@vybestack/llxprt-code-providers/composition.js';
import type {
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import {
  createFileOAuthSettingsProvider,
  type CredentialAuthority,
  type OAuthManager,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  acquireProviderFiles,
  acquireProviderRuntime,
} from './provider-runtime-acquisition.js';

export function acquirePreferredSettings(
  config: Config,
  settings: SettingsService,
  parsed: ParsedAgentConfig,
  release: AcquisitionRelease,
): SessionSettingsOwner {
  const owner = new SessionSettingsOwner(settings);
  release.acquire('settings', () => owner.dispose());
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  owner.initializeProviderSelection(config.getProvider(), config.getModel());
  applyRuntimeEphemerals(
    {
      setEphemeralSetting: (key, value) => owner.writeUserParameter(key, value),
    },
    parsed,
  );
  owner.bindTelemetry(config, undefined);
  return owner;
}

export async function acquirePreferredFiles(
  config: Config,
  runtimeId: string,
  inputs: readonly AgentRetainedProviderFile[],
  release: AcquisitionRelease,
): Promise<ProviderFileLifecycle> {
  const files = acquireProviderFiles(release, {
    proxy: config.getProxy(),
    scopeIds: [runtimeId, config.getSessionId()],
  });
  for (const input of inputs) {
    const retained = await files.retain({ ...input, scopeId: runtimeId });
    await retained.lease.release();
  }
  return files;
}

export function acquirePreferredProviderRuntime<T>(
  release: AcquisitionRelease,
  inputs: {
    readonly config: Config;
    readonly settings: SettingsService;
    readonly settingsOwner: SessionSettingsOwner;
    readonly files: ProviderFileLifecycle;
    readonly runtimeId: string;
    readonly authority: CredentialAuthority;
  },
  oauthSelection: {
    readonly suppliedStore: TokenStore | undefined;
    readonly messageBus: MessageBus;
    readonly profileReads: Pick<ProfileManager, 'loadProfile'> | undefined;
    readonly oauthSettings: IOAuthSettingsProvider | null | undefined;
  },
  complete: (manager: ProviderManager, oauth: OAuthManager) => T,
): T {
  const { config, settings, settingsOwner, files, runtimeId, authority } =
    inputs;
  const { suppliedStore, messageBus, profileReads, oauthSettings } =
    oauthSelection;
  return acquireProviderRuntime(
    release,
    {
      config,
      settings,
      settingsOwner,
      files,
      proxy: config.getProxy(),
      authority,
      context: createProviderRuntimeContext({
        runtimeId,
        runtimeKind: 'agent',
        metadata: { source: 'cli-isolated-runtime-factory' },
      }),
    },
    {
      suppliedStore,
      readSettings: () =>
        oauthSettings === undefined
          ? createFileOAuthSettingsProvider()
          : (oauthSettings ?? undefined),
      messageBus,
      profileReads:
        profileReads ?? createOAuthProfileReads(config.profileDirectory),
      readIdentity: () => ({ runtimeId, runtimeKind: 'agent' }),
      requestInteractiveAuth: undefined,
    },
    complete,
  );
}

export async function preparePreferredProviderCompletion(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  manager: ProviderManager,
  oauth: OAuthManager,
  runtimeId: string,
  tokenizer: RuntimeTokenizerFactory,
  contributions: ProviderContributionRegistry | undefined,
  fakeResponses: string | undefined,
): Promise<void> {
  await settingsOwner.startTelemetry(config);
  manager.setRetryOperationsFactory((name, profileId) =>
    oauth.composeRetryOperations(name, profileId ? { profileId } : undefined),
  );
  manager.setRuntimeContext(
    createProviderRuntimeContext({
      runtimeId,
      runtimeKind: 'agent',
      metadata: { source: 'cli-isolated-runtime-factory' },
    }),
    settingsOwner,
    settings,
    config,
  );
  registerProvidersOntoManager(
    manager,
    settings,
    config,
    oauth,
    contributions,
    fakeResponses,
  );
  manager.setTokenizerFactory(tokenizer);
  manager.setConfig(config);
}
