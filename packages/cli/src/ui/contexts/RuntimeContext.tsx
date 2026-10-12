/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import type { RuntimeProfileAgent } from './runtimeProfileAgent.js';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import type {
  Agent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
} from '@vybestack/llxprt-code-agents';
import type {
  getActiveModelName,
  getActiveProviderMetrics,
  getActiveProviderName,
  getUnallowedParametersForActiveModel,
  listAvailableModels,
  listProviders,
  getSessionTokenUsage,
} from '@vybestack/llxprt-code-providers/runtime/providerReadOperations.js';
import type {
  getEphemeralSetting,
  getEphemeralSettings,
  getSessionSetting,
  setEphemeralSetting,
  setSessionSetting,
  clearSessionSetting,
} from '@vybestack/llxprt-code-providers/runtime/ownerSettingsOperations.js';
import type { getActiveModelParams } from '@vybestack/llxprt-code-providers/runtime/providerModelParameters.js';
import type {
  getActiveToolFormatState,
  setActiveModel,
  setActiveToolFormatOverride,
  updateActiveProviderApiKey,
  BaseUrlUpdateResult,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import type {
  getProfileByName,
  saveLoadBalancerProfile,
} from '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js';
import type { ProviderRuntimeStatus } from '@vybestack/llxprt-code-providers/runtime/providerStatus.js';
import type { createProviderInspection } from '../../runtime/providerInspection.js';
import type { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 4-10
 * React bridge that binds UI runtime operations to its Agent and owner features.
 */
type RuntimeFunctions = ReturnType<typeof createProviderInspection> & {
  listProviders: () => ReturnType<typeof listProviders>;
  getActiveProviderName: () => ReturnType<typeof getActiveProviderName>;
  listAvailableModels: (
    provider?: string,
  ) => ReturnType<typeof listAvailableModels>;
  getActiveModelName: () => ReturnType<typeof getActiveModelName>;
  providerStatus: () => ProviderRuntimeStatus;
  getEphemeralSettings: () => ReturnType<typeof getEphemeralSettings>;
  setEphemeralSetting: (
    key: string,
    value: unknown,
  ) => ReturnType<typeof setEphemeralSetting>;
  getUnallowedParametersForActiveModel: () => ReturnType<
    typeof getUnallowedParametersForActiveModel
  >;
  saveProfileDefinition: (name: string, profile: unknown) => Promise<void>;
  saveLoadBalancerProfile: (
    name: string,
    profile: Parameters<typeof saveLoadBalancerProfile>[1],
  ) => Promise<void>;
  listSavedProfiles: () => Promise<string[]>;
  getProfileByName: (name: string) => ReturnType<typeof getProfileByName>;
  getActiveToolFormatState: () => ReturnType<typeof getActiveToolFormatState>;
  setActiveToolFormatOverride: (
    format: Parameters<typeof setActiveToolFormatOverride>[0],
  ) => ReturnType<typeof setActiveToolFormatOverride>;
  getActiveProviderMetrics: () => ReturnType<typeof getActiveProviderMetrics>;
  getSessionTokenUsage: () => ReturnType<typeof getSessionTokenUsage>;
  getEphemeralSetting: (key: string) => ReturnType<typeof getEphemeralSetting>;
  getSessionSetting: (key: string) => ReturnType<typeof getSessionSetting>;
  setSessionSetting: (
    key: string,
    value: unknown,
  ) => ReturnType<typeof setSessionSetting>;
  clearSessionSetting: (key: string) => ReturnType<typeof clearSessionSetting>;
};

type AgentSetProvider = (
  provider: string,
  model?: string,
  options?: AgentProviderSwitchOptions,
) => Promise<AgentProviderSwitchResult>;

type ProfileRuntimeApi = Pick<
  Agent,
  | 'getActiveProfileName'
  | 'setDefaultProfileName'
  | 'getRuntimeDiagnosticsSnapshot'
  | 'saveProfileSnapshot'
  | 'deleteProfileByName'
>;

export type RuntimeOwnerFeatures = RuntimeFunctions & {
  setActiveModel: (model: string) => ReturnType<typeof setActiveModel>;
  getActiveModelParams: () => ReturnType<typeof getActiveModelParams>;
  setActiveModelParam: (key: string, value: unknown) => void;
  clearActiveModelParam: (key: string) => void;
  updateActiveProviderApiKey: (
    key: string | null,
  ) => ReturnType<typeof updateActiveProviderApiKey>;
  getWorkspaceDirectories: () => readonly string[];
  getDefaultProfileName: () => string | null;
  getOpenAIProviderInfo: () => ReturnType<typeof getOpenAIProviderInfo>;
};

export type RuntimeApi = RuntimeOwnerFeatures &
  ProfileRuntimeApi & {
    setProvider: AgentSetProvider;
    loadProfileByName: (name: string) => ReturnType<Agent['profiles']['load']>;
    updateActiveProviderBaseUrl: (
      url: string | null,
    ) => Promise<BaseUrlUpdateResult>;
  };

interface RuntimeContextBridge {
  runtimeId: string;
  api: RuntimeApi;
}

const RuntimeContext = createContext<RuntimeContextBridge | null>(null);

function makeBaseUrlUpdater(
  agent: RuntimeProfileAgent,
): RuntimeApi['updateActiveProviderBaseUrl'] {
  return async (url) => {
    await agent.auth.setBaseUrl(url);
    const providerName = agent.getProvider();
    const trimmed = url?.trim();
    const baseUrl = trimmed?.toLowerCase() === 'none' ? undefined : trimmed;
    return {
      changed: true,
      providerName,
      baseUrl: baseUrl === '' ? undefined : baseUrl,
      message: baseUrl
        ? `Base URL updated to '${baseUrl}' for provider '${providerName}'.`
        : `Base URL cleared; provider '${providerName}' now uses the default endpoint.`,
    };
  };
}

function makeRuntimeApi(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
): RuntimeApi {
  return {
    ...owner,
    setProvider: (provider, model, options) =>
      agent.setProvider(provider, model, options),
    getActiveProfileName: () => agent.getActiveProfileName(),
    setDefaultProfileName: (name) => agent.setDefaultProfileName(name),
    getRuntimeDiagnosticsSnapshot: () => agent.getRuntimeDiagnosticsSnapshot(),
    saveProfileSnapshot: (name, additional) =>
      agent.saveProfileSnapshot(name, additional),
    deleteProfileByName: (name) => agent.deleteProfileByName(name),
    loadProfileByName: (name) => agent.profiles.load(name),
    updateActiveProviderBaseUrl: makeBaseUrlUpdater(agent),
  };
}

function createBridge(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
): RuntimeContextBridge {
  return { runtimeId: agent.getRuntimeId(), api: makeRuntimeApi(agent, owner) };
}

export interface RuntimeContextProviderProps {
  agent: RuntimeProfileAgent;
  owner: RuntimeOwnerFeatures;
}

export const RuntimeContextProvider: React.FC<
  PropsWithChildren<RuntimeContextProviderProps>
> = ({ children, agent, owner }) => {
  const bridge = useMemo(() => createBridge(agent, owner), [agent, owner]);
  return (
    <RuntimeContext.Provider value={bridge}>{children}</RuntimeContext.Provider>
  );
};

export function useRuntimeBridge(): RuntimeContextBridge {
  const context = useContext(RuntimeContext);
  if (!context) {
    throw new Error(
      'RuntimeContextProvider is missing from the component tree.',
    );
  }
  return context;
}

export function useRuntimeApi(): RuntimeApi {
  return useRuntimeBridge().api;
}

export function createRuntimeApi(
  agent: RuntimeProfileAgent,
  owner: RuntimeOwnerFeatures,
): RuntimeApi {
  return makeRuntimeApi(agent, owner);
}
