import { LoadBalancingProvider } from '@vybestack/llxprt-code-providers';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProfileDefinitionWrites } from '@vybestack/llxprt-code-core';
import {
  buildRuntimeProfileSnapshot,
  captureProfileModelParams,
  saveProfileSnapshot,
  type ProfileSnapshotData,
} from './profileSnapshot.js';
import type { Agent, ProviderStatus } from './agent.js';
import type { AgentProviderState } from './control/authState.js';
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
  readModel: () => string,
  readProvider: () => string | undefined,
  settings: Pick<
    SettingsService,
    | 'getProviderSettings'
    | 'getCurrentProfileName'
    | 'setCurrentProfileName'
    | 'set'
  >,
  manager: Pick<
    RuntimeProviderManager,
    'getActiveProviderName' | 'getProviderByName'
  >,
  captureParameters: () => Readonly<Record<string, unknown>>,
  profiles: ProfileDefinitionWrites,
): ProfilePersistence {
  const reads = assembleProfilePersistenceReads(
    readModel,
    readProvider,
    settings,
    manager,
    captureParameters,
  );
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
  const captureProfile: Agent['captureProfile'] = () =>
    buildRuntimeProfileSnapshot(reads.capture());
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
      admit(async () => {
        await profiles.deleteProfile(name);
        if (settings.getCurrentProfileName() === name)
          settings.setCurrentProfileName(null);
      }),
    getActiveProfileName: () => settings.getCurrentProfileName(),
    setDefaultProfileName: (name) =>
      settings.set('defaultProfile', name ?? undefined),
    getRuntimeDiagnosticsSnapshot: () => structuredClone(reads.diagnostics()),
  };
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
  client: Pick<AgentClientContract, 'hasChatInitialized' | 'startChat'>,
): Promise<void> {
  // The client already holds its carried history (the live HistoryService a
  // profile adoption rebound, or deferred rows). Starting the chat adopts that
  // service as is: copying it through a source would replace the service the
  // session recording is attached to.
  if (!client.hasChatInitialized()) await client.startChat();
}

function assembleProfilePersistenceReads(
  readModel: () => string,
  readProvider: () => string | undefined,
  settings: Pick<
    SettingsService,
    'getProviderSettings' | 'getCurrentProfileName'
  >,
  manager: Pick<
    RuntimeProviderManager,
    'getActiveProviderName' | 'getProviderByName'
  >,
  captureParameters: () => Readonly<Record<string, unknown>>,
): {
  capture: () => ProfileSnapshotData;
  diagnostics: Agent['getRuntimeDiagnosticsSnapshot'];
} {
  return {
    capture: () => {
      const providerName =
        manager.getActiveProviderName() ?? readProvider() ?? 'openai';
      const provider = manager.getProviderByName(providerName);
      const providerSettings = settings.getProviderSettings(providerName);
      return {
        providerName,
        modelName:
          typeof providerSettings.model === 'string'
            ? providerSettings.model
            : readModel(),
        providerSettings,
        ephemeralSettings: captureParameters(),
        loadBalancerConfig:
          provider instanceof LoadBalancingProvider
            ? provider.getLoadBalancerConfig()
            : undefined,
      };
    },
    diagnostics: () => {
      const providerName = manager.getActiveProviderName() ?? null;
      const storedModel = providerName
        ? settings.getProviderSettings(providerName).model
        : undefined;
      return {
        providerName,
        modelName:
          typeof storedModel === 'string' && storedModel.trim()
            ? storedModel
            : readModel() || null,
        profileName: settings.getCurrentProfileName(),
        modelParams: providerName
          ? captureProfileModelParams(
              settings.getProviderSettings(providerName),
            )
          : {},
        ephemeralSettings: captureParameters(),
      };
    },
  };
}
