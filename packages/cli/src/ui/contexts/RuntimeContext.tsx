/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import {
  clearActiveModelParam,
  deleteProfileByName,
  getActiveModelName,
  getActiveModelParams,
  getActiveProviderMetrics,
  getActiveProviderName,
  getActiveProviderStatus,
  getActiveToolFormatState,
  getCliOAuthManager,
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
  switchActiveProvider,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  getSessionTokenUsage,
  getLoadBalancerStats,
  getLoadBalancerLastSelected,
  getAllLoadBalancerStats,
} from '../../runtime/runtimeSettings.js';
import {
  enterRuntimeScope,
  runWithRuntimeScope,
} from '../../runtime/runtimeContextFactory.js';

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P15
 * @requirement REQ-SP2-003
 * @pseudocode cli-runtime-isolation.md lines 4-10
 * React bridge that binds CLI runtime helpers to the active runtime scope so UI commands remain isolated.
 */

const runtimeFunctions = {
  switchActiveProvider,
  listProviders,
  getActiveProviderName,
  setActiveModel,
  listAvailableModels,
  getActiveModelName,
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
type RuntimeApi = { [K in keyof RuntimeFunctions]: RuntimeFunctions[K] };

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
  return Object.fromEntries(boundEntries) as RuntimeApi;
}

function createBridge(
  runtimeId: string,
  metadata: Record<string, unknown>,
): RuntimeContextBridge {
  const scope = { runtimeId, metadata };
  const api = makeRuntimeApi(runtimeId, metadata);
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

export const RuntimeContextProvider: React.FC<PropsWithChildren<unknown>> = ({
  children,
}) => {
  const runtime = getCliRuntimeContext();
  const runtimeId =
    (typeof runtime.runtimeId === 'string' && runtime.runtimeId.trim() !== ''
      ? runtime.runtimeId
      : 'legacy-singleton') ?? 'legacy-singleton';

  const bridge = useMemo(() => {
    const normalizedMetadata =
      (runtime.metadata as Record<string, unknown> | undefined) ?? {};
    return createBridge(runtimeId, normalizedMetadata);
  }, [runtimeId, runtime]);

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
  const runtimeId =
    (typeof runtime.runtimeId === 'string' && runtime.runtimeId.trim() !== ''
      ? runtime.runtimeId
      : 'legacy-singleton') ?? 'legacy-singleton';
  const metadata =
    (runtime.metadata as Record<string, unknown> | undefined) ?? {};
  const bridge = createBridge(runtimeId, metadata);
  bridge.enterScope();
  latestBridge = bridge;
  return bridge;
}

export function getRuntimeApi(): RuntimeApi {
  return getRuntimeBridge().api;
}
