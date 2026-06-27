/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LoadBalancerProfile,
  Profile,
} from '@vybestack/llxprt-code-settings';

/**
 * Format guard only. Empty profile lists are accepted here so the dedicated
 * profile validation path can produce the existing user-facing error.
 */
export function isLoadBalancerProfileFormat(
  profile: Profile,
): profile is LoadBalancerProfile {
  const hasLoadBalancerType =
    'type' in profile && profile.type === 'loadbalancer';
  const profiles = 'profiles' in profile ? profile.profiles : undefined;
  return (
    hasLoadBalancerType &&
    Array.isArray(profiles) &&
    profiles.every((entry) => typeof entry === 'string')
  );
}
