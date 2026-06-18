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

  return {
    profileName,
    totalRequests,
    lastSelected,
    profileCounts,
    backendMetrics: backendMetricsRecord,
    circuitBreakerStates: circuitBreakerSnapshot,
    currentTPM,
  };
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
    snapshot[name] = { ...state };
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
