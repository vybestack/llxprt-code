import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
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
  AgentProfileDefinitions,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
  SessionProviderReads,
} from '@vybestack/llxprt-code-agents';
import type {
  setActiveModel,
  updateActiveProviderApiKey,
  BaseUrlUpdateResult,
} from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import type { createProviderInspection } from '../../runtime/providerInspection.js';
import type { getOpenAIProviderInfo } from '@vybestack/llxprt-code-providers';

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 4-10
 * React bridge that binds UI runtime operations to its Agent and owner features.
 */
type RuntimeFunctions = ReturnType<typeof createProviderInspection> &
  AgentProfileDefinitions &
  Pick<
    SessionProviderReads,
    | 'listProviders'
    | 'getActiveProviderName'
    | 'listAvailableModels'
    | 'getActiveModelName'
    | 'providerStatus'
    | 'getUnallowedParametersForActiveModel'
    | 'getActiveProviderMetrics'
    | 'getSessionTokenUsage'
  > & {
    getEphemeralSettings: () => Readonly<Record<string, unknown>>;
    setEphemeralSetting: (key: string, value: unknown) => void;
    getActiveToolFormatState: () => ReturnType<Agent['toolFormat']['getState']>;
    setActiveToolFormatOverride: (
      format: Parameters<Agent['toolFormat']['setOverride']>[0],
    ) => ReturnType<Agent['toolFormat']['setOverride']>;
    getEphemeralSetting: (key: string) => unknown;
    getSessionSetting: (key: string) => unknown;
    setSessionSetting: (key: string, value: unknown) => void;
    clearSessionSetting: (key: string) => void;
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
  getActiveModelParams: () => ReturnType<
    SessionProviderReads['getActiveModelParams']
  >;
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
    fetch: NetworkFetch;
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
  requestFetch: NetworkFetch,
): RuntimeApi {
  return {
    ...owner,
    fetch: requestFetch,
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
  requestFetch: NetworkFetch,
): RuntimeContextBridge {
  return {
    runtimeId: agent.getRuntimeId(),
    api: makeRuntimeApi(agent, owner, requestFetch),
  };
}

export interface RuntimeContextProviderProps {
  agent: RuntimeProfileAgent;
  owner: RuntimeOwnerFeatures;
  requestFetch: NetworkFetch;
}

export const RuntimeContextProvider: React.FC<
  PropsWithChildren<RuntimeContextProviderProps>
> = ({ children, agent, owner, requestFetch }) => {
  const bridge = useMemo(
    () => createBridge(agent, owner, requestFetch),
    [agent, owner, requestFetch],
  );
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
  requestFetch: NetworkFetch,
): RuntimeApi {
  return makeRuntimeApi(agent, owner, requestFetch);
}
