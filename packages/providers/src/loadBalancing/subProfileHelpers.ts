/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadBalancerSubProfile,
  LoadBalancingProviderConfig,
  ResolvedSubProfile,
} from './loadBalancerTypes.js';
import { isResolvedSubProfile } from './loadBalancerTypes.js';

export function getMinMemberContextWindow(
  subProfiles: ReadonlyArray<ResolvedSubProfile | LoadBalancerSubProfile>,
): number | undefined {
  const windows = subProfiles
    .filter(isResolvedSubProfile)
    .map((subProfile) => subProfile.contextWindow)
    .filter(
      (contextWindow): contextWindow is number =>
        typeof contextWindow === 'number' && contextWindow > 0,
    );
  return windows.length === 0 ? undefined : Math.min(...windows);
}

/**
 * Effective shared context limit for a load balancer: the profile's
 * explicit positive contextLimit when set, otherwise the smallest member
 * context window.
 */
export function getEffectiveLoadBalancerContextLimit(
  config: LoadBalancingProviderConfig,
): number | undefined {
  if (config.contextLimit !== undefined && config.contextLimit > 0) {
    return config.contextLimit;
  }
  return getMinMemberContextWindow(config.subProfiles);
}

export function resolveSubProfileModel(
  subProfile: ResolvedSubProfile | LoadBalancerSubProfile,
): string {
  return isResolvedSubProfile(subProfile)
    ? subProfile.model
    : (subProfile.modelId ?? '');
}
