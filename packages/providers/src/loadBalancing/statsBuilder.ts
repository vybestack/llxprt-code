/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489
 * Extended load-balancer statistics assembly. Extracted from
 * LoadBalancingProvider.getStats to keep the main file under the lint budget.
 */

import type {
  BackendMetrics,
  CircuitBreakerState,
  ExtendedLoadBalancerStats,
  ResolvedSubProfile,
  LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';

/**
 * Build the extended stats snapshot from the component maps.
 */
export function buildExtendedStats(
  profileName: string,
  totalRequests: number,
  lastSelected: string | null,
  stats: Map<string, number>,
  circuitBreakerStates: Map<string, CircuitBreakerState>,
  backendMetrics: Map<string, BackendMetrics>,
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[],
  calculateTPM: (profileName: string) => number,
): ExtendedLoadBalancerStats {
  const profileCounts = collectProfileCounts(stats);
  const circuitBreakerSnapshot =
    collectCircuitBreakerStates(circuitBreakerStates);
  const currentTPM = collectCurrentTPM(subProfiles, calculateTPM);
  const backendMetricsRecord = collectBackendMetrics(backendMetrics);
  const members = collectMembers(subProfiles);
  const lastSelectedModel = resolveSubProfileModel(subProfiles, lastSelected);

  return {
    profileName,
    members,
    totalRequests,
    lastSelected,
    lastSelectedModel,
    profileCounts,
    backendMetrics: backendMetricsRecord,
    circuitBreakerStates: circuitBreakerSnapshot,
    currentTPM,
  };
}

function collectMembers(
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[],
): string[] {
  return subProfiles.map((subProfile) => subProfile.name);
}

function subProfileModel(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
): string | null {
  if ('model' in subProfile) {
    return subProfile.model;
  }
  return subProfile.modelId ?? null;
}

function resolveSubProfileModel(
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[],
  lastSelected: string | null,
): string | null {
  if (lastSelected === null) {
    return null;
  }
  const match = subProfiles.find(
    (subProfile) => subProfile.name === lastSelected,
  );
  return match ? subProfileModel(match) : null;
}

function collectProfileCounts(
  stats: Map<string, number>,
): Record<string, number> {
  const profileCounts: Record<string, number> = {};
  for (const [name, count] of stats) {
    profileCounts[name] = count;
  }
  return profileCounts;
}

function collectCircuitBreakerStates(
  circuitBreakerStates: Map<string, CircuitBreakerState>,
): Record<string, CircuitBreakerState> {
  const snapshot: Record<string, CircuitBreakerState> = {};
  for (const [name, state] of circuitBreakerStates) {
    snapshot[name] = {
      ...state,
      failures: state.failures.map((failure) => ({ ...failure })),
    };
  }
  return snapshot;
}

function collectCurrentTPM(
  subProfiles: ResolvedSubProfile[] | LoadBalancerSubProfile[],
  calculateTPM: (profileName: string) => number,
): Record<string, number> {
  const currentTPM: Record<string, number> = {};
  for (const subProfile of subProfiles) {
    currentTPM[subProfile.name] = calculateTPM(subProfile.name);
  }
  return currentTPM;
}

function collectBackendMetrics(
  backendMetrics: Map<string, BackendMetrics>,
): Record<string, BackendMetrics> {
  const record: Record<string, BackendMetrics> = {};
  for (const [name, metrics] of backendMetrics) {
    record[name] = { ...metrics };
  }
  return record;
}
