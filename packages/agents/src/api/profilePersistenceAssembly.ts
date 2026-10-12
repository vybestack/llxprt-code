import {
  setActiveModel,
  assembleModelSelection,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProfileDefinitionWrites } from '@vybestack/llxprt-code-core';
import { LoadBalancingProvider } from '@vybestack/llxprt-code-providers';
import {
  buildRuntimeProfileSnapshot,
  deleteProfileByName,
  saveProfileSnapshot,
} from '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js';
import { getActiveModelParams } from '@vybestack/llxprt-code-providers/runtime/providerModelParameters.js';
import type { Agent, ProviderStatus } from './agent.js';
import type { AgentProviderState } from './agentImpl.js';
import type { AuthWinner } from './control/authState.js';
import { UNCONFIGURED_PROVIDER } from './constants.js';

type ProfilePersistence = Pick<
  Agent,
  | 'captureProfile'
  | 'saveProfileSnapshot'
  | 'deleteProfileByName'
  | 'getActiveProfileName'
  | 'setDefaultProfileName'
  | 'getRuntimeDiagnosticsSnapshot'
> & {
  closeAdmission(): void;
  join(): Promise<void>;
};

export function assembleProfilePersistence(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  captureParameters: () => Readonly<Record<string, unknown>>,
  profiles: ProfileDefinitionWrites,
): ProfilePersistence {
  let closed = false;
  const pending = new Set<Promise<unknown>>();
  const admit = <T>(operation: () => Promise<T>): Promise<T> => {
    if (closed)
      return Promise.reject(new Error('Profile persistence facade is closed'));
    const accepted = operation();
    pending.add(accepted);
    void accepted.then(
      () => pending.delete(accepted),
      () => pending.delete(accepted),
    );
    return accepted;
  };
  const captureProfile: Agent['captureProfile'] = () => {
    const providerName =
      manager.getActiveProviderName() ?? config.getProvider() ?? 'openai';
    const provider = manager.getProviderByName(providerName);
    const providerSettings = settings.getProviderSettings(providerName);
    return buildRuntimeProfileSnapshot({
      providerName,
      modelName:
        typeof providerSettings.model === 'string'
          ? providerSettings.model
          : config.getModel(),
      providerSettings,
      ephemeralSettings: captureParameters(),
      loadBalancerConfig:
        provider instanceof LoadBalancingProvider
          ? provider.getLoadBalancerConfig()
          : undefined,
    });
  };
  return {
    closeAdmission: () => {
      closed = true;
    },
    join: async () => {
      const results = await Promise.allSettled([...pending]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Profile persistence cleanup failed',
        );
    },
    captureProfile,
    saveProfileSnapshot: (name, additionalConfig) =>
      admit(() =>
        saveProfileSnapshot(name, captureProfile(), additionalConfig, profiles),
      ),
    deleteProfileByName: (name) =>
      admit(() => deleteProfileByName(name, settings, profiles)),
    getActiveProfileName: () => settings.getCurrentProfileName(),
    setDefaultProfileName: (name) =>
      settings.set('defaultProfile', name ?? undefined),
    getRuntimeDiagnosticsSnapshot: () =>
      captureProfileDiagnostics(config, settings, manager, captureParameters),
  };
}

function captureProfileDiagnostics(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  captureParameters: () => Readonly<Record<string, unknown>>,
): ReturnType<Agent['getRuntimeDiagnosticsSnapshot']> {
  const providerName = manager.getActiveProviderName() ?? null;
  const storedModel = providerName
    ? settings.getProviderSettings(providerName).model
    : undefined;
  return structuredClone({
    providerName,
    modelName:
      typeof storedModel === 'string' && storedModel.trim()
        ? storedModel
        : config.getModel() || null,
    profileName: settings.getCurrentProfileName(),
    modelParams: getActiveModelParams(settings, providerName ?? undefined),
    ephemeralSettings: captureParameters(),
  });
}

export function buildProfileProviderStatus(
  s: AgentProviderState,
  winner: AuthWinner,
  keyFile: string | undefined,
): ProviderStatus {
  const keyNamePart =
    winner === 'keyName' && s.keyName !== undefined
      ? { keyName: s.keyName }
      : {};
  const keyFilePart =
    winner === 'keyfile' && keyFile !== undefined ? { keyFile } : {};
  const baseUrlPart = s.baseUrl !== undefined ? { baseUrl: s.baseUrl } : {};
  return {
    provider: s.provider === UNCONFIGURED_PROVIDER ? '' : s.provider,
    model: s.model,
    authStatus: winner !== 'none' ? 'authenticated' : 'unauthenticated',
    ...baseUrlPart,
    ...keyNamePart,
    ...keyFilePart,
  };
}

export function snapshotModelParams(
  params: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.assign(Object.create(null) as Record<string, unknown>, params),
  );
}

export async function restoreAgentChatVisibility(
  client: Pick<
    AgentClientContract,
    'hasChatInitialized' | 'getHistory' | 'startChat'
  >,
): Promise<void> {
  if (!client.hasChatInitialized()) {
    const carriedHistory = await client.getHistory();
    await client.startChat(
      carriedHistory.length > 0 ? carriedHistory : undefined,
    );
  }
}

export function setAgentSelectedModel(
  model: string,
  roots: {
    readonly settingsOwner: SessionSettingsOwner;
    readonly settingsService: SettingsService;
    readonly providerManager: RuntimeProviderManager;
  },
): ReturnType<typeof setActiveModel> {
  return setActiveModel(
    model,
    assembleModelSelection(roots.settingsOwner),
    roots.settingsService,
    roots.providerManager.getActiveProvider(),
  );
}
