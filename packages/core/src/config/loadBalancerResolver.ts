/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoadBalancerProfile } from '../types/modelParams.js';

/**
 * @deprecated This interface is part of the old load balancer architecture.
 * Use LoadBalancingProvider.getStats() instead which provides per-request stats.
 * The old architecture did round-robin at profile-load time, the new architecture
 * does it per-request via LoadBalancingProvider.
 */
export interface LoadBalancerStats {
  /** Map of profile name to number of requests */
  profileCounts: Record<string, number>;
  /** Total number of requests */
  totalRequests: number;
  /** The last selected profile */
  lastSelected: string | null;
}

/**
 * @deprecated This class is part of the old load balancer architecture.
 * Use LoadBalancingProvider instead which provides per-request load balancing.
 * The old architecture did round-robin at profile-load time (selecting a profile once),
 * the new architecture does it per-request via LoadBalancingProvider.
 *
 * This class is kept for backward compatibility only and should not be used in new code.
 */
export class LoadBalancerResolver {
  private counters: Map<string, number> = new Map();
  /** Stats per load balancer: lbName -> profileName -> count */
  private stats: Map<string, Map<string, number>> = new Map();
  /** Last selected profile per load balancer */
  private lastSelected: Map<string, string> = new Map();

  resolveProfile(lbProfile: LoadBalancerProfile, profileName: string): string {
    const currentCounter = this.counters.get(profileName) ?? 0;
    const profileIndex = currentCounter % lbProfile.profiles.length;
    const selectedProfile = lbProfile.profiles[profileIndex];

    this.counters.set(profileName, currentCounter + 1);

    // Track stats
    let lbStats = this.stats.get(profileName);
    if (!lbStats) {
      lbStats = new Map();
      this.stats.set(profileName, lbStats);
    }
    const currentCount = lbStats.get(selectedProfile) ?? 0;
    lbStats.set(selectedProfile, currentCount + 1);

    // Track last selected
    this.lastSelected.set(profileName, selectedProfile);

    return selectedProfile;
  }

  resetCounter(profileName: string): void {
    this.counters.set(profileName, 0);
  }

  /**
   * Get stats for a specific load balancer profile
   * @param lbName The name of the load balancer profile
   * @returns Stats for the load balancer, or undefined if not found
   */
  getStats(lbName: string): LoadBalancerStats | undefined {
    const lbStats = this.stats.get(lbName);
    if (!lbStats) {
      return undefined;
    }

    const profileCounts: Record<string, number> = {};
    let totalRequests = 0;
    for (const [profile, count] of lbStats) {
      profileCounts[profile] = count;
      totalRequests += count;
    }

    return {
      profileCounts,
      totalRequests,
      lastSelected: this.lastSelected.get(lbName) ?? null,
    };
  }

  /**
   * Get the last selected profile for a load balancer
   * @param lbName The name of the load balancer profile
   * @returns The last selected profile name, or null if none
   */
  getLastSelected(lbName: string): string | null {
    return this.lastSelected.get(lbName) ?? null;
  }

  /**
   * Get all load balancer stats
   * @returns Map of load balancer name to stats
   */
  getAllStats(): Map<string, LoadBalancerStats> {
    const allStats = new Map<string, LoadBalancerStats>();
    for (const lbName of this.stats.keys()) {
      const stats = this.getStats(lbName);
      if (stats) {
        allStats.set(lbName, stats);
      }
    }
    return allStats;
  }
}
