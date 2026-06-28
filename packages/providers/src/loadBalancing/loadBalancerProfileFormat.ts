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
  if (candidate.version !== 1 || candidate.type !== 'loadbalancer') {
    return false;
  }
  if (!isLoadBalancerPolicy(candidate.policy)) {
    return false;
  }
  if (!isStringArray(candidate.profiles)) {
    return false;
  }
  return hasRequiredProfileFields(candidate);
}

function isLoadBalancerPolicy(value: unknown): boolean {
  return value === 'roundrobin' || value === 'failover';
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function hasRequiredProfileFields(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.provider === 'string' &&
    typeof candidate.model === 'string' &&
    isPlainRecord(candidate.modelParams) &&
    isPlainRecord(candidate.ephemeralSettings)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
