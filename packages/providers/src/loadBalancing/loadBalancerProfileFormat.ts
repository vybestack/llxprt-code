/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoadBalancerProfile } from '@vybestack/llxprt-code-settings';

/**
 * Format guard only. Empty profile lists are accepted here so the dedicated
 * profile validation path can produce the existing user-facing error.
 */
export function isLoadBalancerProfileFormat(
  profile: unknown,
): profile is LoadBalancerProfile {
  if (typeof profile !== 'object' || profile === null) {
    return false;
  }
  const candidate = profile as Record<string, unknown>;
  return (
    candidate.type === 'loadbalancer' &&
    Array.isArray(candidate.profiles) &&
    candidate.profiles.every((entry) => typeof entry === 'string')
  );
}
