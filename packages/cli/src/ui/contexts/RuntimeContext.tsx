/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import type {
  Agent,
  AgentProviderSwitchOptions,
  AgentProviderSwitchResult,
} from '@vybestack/llxprt-code-agents';
import {
  clearActiveModelParam,
  deleteProfileByName,
  getActiveModelName,
  getActiveModelParams,
  getActiveProfileName,
  getActiveProviderMetrics,
  getActiveProviderName,
  getActiveProviderStatus,
  getActiveToolFormatState,
  getCliOAuthManager,
  maybeGetCliOAuthManager,
  getCliProviderManager,
  getCliRuntimeContext,
  getCliRuntimeServices,
  getEphemeralSetting,
  getEphemeralSettings,
  getProfileByName,
  getRuntimeDiagnosticsSnapshot,
  listAvailableModels,
  listProviders,
  listSavedProfiles,
  loadProfileByName,
  registerCliProviderInfrastructure,
  saveProfileSnapshot,
  saveLoadBalancerProfile,
  setActiveModel,
  setActiveModelParam,
  setActiveToolFormatOverride,
  setDefaultProfileName,
  setEphemeralSetting,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  getSessionTokenUsage,
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
  enterRuntimeScope,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 4-10
 * React bridge that binds CLI runtime helpers to the active runtime scope so UI commands remain isolated.
 */

const runtimeFunctions = {
  listProviders,
  getActiveProviderName,
  setActiveModel,
  listAvailableModels,
  getActiveModelName,
  getActiveProfileName,
  getActiveProviderStatus,
  getActiveModelParams,
  getEphemeralSettings,
  setEphemeralSetting,
  setActiveModelParam,
  clearActiveModelParam,
  saveProfileSnapshot,
  saveLoadBalancerProfile,
  loadProfileByName,
  deleteProfileByName,
  listSavedProfiles,
  getProfileByName,
  setDefaultProfileName,
  updateActiveProviderBaseUrl,
  updateActiveProviderApiKey,
  getCliProviderManager,
  getCliOAuthManager,
  maybeGetCliOAuthManager,
  registerCliProviderInfrastructure,
  getRuntimeDiagnosticsSnapshot,
  getActiveToolFormatState,
  setActiveToolFormatOverride,
  getActiveProviderMetrics,
  getSessionTokenUsage,
  getCliRuntimeServices,
  getEphemeralSetting,
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
} as const;

type RuntimeFunctions = typeof runtimeFunctions;

/**
 * Provider-switch wrapper that delegates to the Agent facade's setProvider
 * method. The agent reference is stored when the RuntimeContextProvider
 * mounts and updated on re-renders, so UI hooks can call setProvider
 * without importing the raw provider-switch primitive (#2374).
 */
type AgentSetProvider = (
  provider: string,
  model?: string,
  options?: AgentProviderSwitchOptions,
) => Promise<AgentProviderSwitchResult>;

export type RuntimeApi = {
  [K in keyof RuntimeFunctions]: RuntimeFunctions[K];
} & {
  setProvider: AgentSetProvider;
};

interface RuntimeContextBridge {
  runtimeId: string;
  metadata: Record<string, unknown>;
  api: RuntimeApi;
  runWithScope<T>(callback: () => T): T;
  enterScope(): void;
}

const RuntimeContext = createContext<RuntimeContextBridge | null>(null);

function makeRuntimeApi(
  runtimeId: string,
  metadata: Record<string, unknown>,
  agentRef: { current: Agent | null },
): RuntimeApi {
  const scope = { runtimeId, metadata };
  const boundEntries = Object.entries(runtimeFunctions).map(([key, fn]) => {
    if (typeof fn !== 'function') {
      return [key, fn];
    }
    const wrapped = (...args: unknown[]) =>
      runWithRuntimeScope(scope, () =>
        (fn as (...inner: unknown[]) => unknown)(...args),
      );
    return [key, wrapped];
  });
  const base = Object.fromEntries(boundEntries) as {
    [K in keyof RuntimeFunctions]: RuntimeFunctions[K];
  };
  const setProvider: AgentSetProvider = (provider, model, options) => {
    const agent = agentRef.current;
    if (!agent) {
      return Promise.reject(
        new Error('Agent facade is not available for provider switch.'),
      );
    }
    return agent.setProvider(provider, model, options);
  };
  return { ...base, setProvider };
}

function createBridge(
  runtimeId: string,
  metadata: Record<string, unknown>,
  agentRef: { current: Agent | null },
): RuntimeContextBridge {
  const scope = { runtimeId, metadata };
  const api = makeRuntimeApi(runtimeId, metadata, agentRef);
  return {
    runtimeId,
    metadata,
    api,
    runWithScope: <T,>(callback: () => T): T =>
      runWithRuntimeScope(scope, callback),
    enterScope: () => enterRuntimeScope(scope),
  };
}

let latestBridge: RuntimeContextBridge | null = null;

type CliRuntimeContext = ReturnType<typeof getCliRuntimeContext>;

function resolveRuntimeId(runtime: CliRuntimeContext): string {
  if (
    typeof runtime.runtimeId === 'string' &&
    runtime.runtimeId.trim() !== ''
  ) {
    return runtime.runtimeId;
  }
  // getCliRuntimeContext() guarantees a valid non-empty runtimeId on success;
  // this guard exists only to fail fast if that invariant is broken.
  throw new Error(
    'Runtime context has no valid runtimeId. Ensure setCliRuntimeContext() was called with an explicit runtimeId before the UI bridge is constructed.',
  );
}

export interface RuntimeContextProviderProps {
  agent: Agent;
}

export const RuntimeContextProvider: React.FC<
  PropsWithChildren<RuntimeContextProviderProps>
> = ({ children, agent }) => {
  const agentRef = useRef<Agent | null>(agent);
  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  const runtime = getCliRuntimeContext();
  // Invariant: CLI bootstrap calls setCliRuntimeContext() with an explicit
  // runtimeId before the UI bridge mounts; violating that contract is fatal.
  const runtimeId = resolveRuntimeId(runtime);

  const bridge = useMemo(() => {
    const normalizedMetadata = runtime.metadata ?? {};
    return createBridge(runtimeId, normalizedMetadata, agentRef);
  }, [runtimeId, runtime, agentRef]);

  useEffect(() => {
    bridge.enterScope();
    latestBridge = bridge;
    return () => {
      if (latestBridge?.runtimeId === bridge.runtimeId) {
        latestBridge = null;
      }
    };
  }, [bridge]);

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

export function getRuntimeBridge(): RuntimeContextBridge {
  if (latestBridge) {
    return latestBridge;
  }

  const runtime = getCliRuntimeContext();
  const runtimeId = resolveRuntimeId(runtime);
  const metadata = runtime.metadata ?? {};
  const bridge = createBridge(runtimeId, metadata, { current: null });
  bridge.enterScope();
  latestBridge = bridge;
  return bridge;
}

export function getRuntimeApi(): RuntimeApi {
  return getRuntimeBridge().api;
}
