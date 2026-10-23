/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile resolution utilities for OAuth bucket extraction.
 * These functions handle loading profiles and extracting OAuth bucket configurations.
 */

/**
 * Type guard to check if a profile is a load balancer configuration.
 */
export function isLoadBalancerProfileLike(
  profile: unknown,
): profile is { type: 'loadbalancer'; profiles: string[] } {
  if (
    profile === null ||
    profile === undefined ||
    typeof profile !== 'object'
  ) {
    return false;
  }
  const p = profile as Record<string, unknown>;
  if (p.type !== 'loadbalancer' || !('profiles' in p)) {
    return false;
  }
  const profiles = p.profiles;
  if (!Array.isArray(profiles)) {
    return false;
  }
  return profiles.every(
    (name) => typeof name === 'string' && name.trim() !== '',
  );
}

/**
 * Extracts OAuth bucket configuration from a profile object.
 * Returns null if the profile doesn't have OAuth auth configuration.
 */
export function getOAuthBucketsFromProfile(
  profile: unknown,
): { providerName: string; buckets: string[] } | null {
  if (
    profile === null ||
    profile === undefined ||
    typeof profile !== 'object'
  ) {
    return null;
  }

  const providerName =
    'provider' in profile && typeof profile.provider === 'string'
      ? profile.provider
      : null;
  if (providerName === null || providerName.trim() === '') {
    return null;
  }

  const auth = 'auth' in profile ? profile.auth : undefined;
  if (auth === null || auth === undefined || typeof auth !== 'object') {
    return null;
  }

  if (!('type' in auth) || auth.type !== 'oauth') {
    return null;
  }

  const buckets = (() => {
    if ('buckets' in auth && Array.isArray(auth.buckets)) {
      const bucketNames = auth.buckets
        .filter((bucket) => typeof bucket === 'string')
        .map((bucket) => bucket.trim())
        .filter((bucket) => bucket !== '');
      if (bucketNames.length > 0) {
        return bucketNames;
      }
    }
    return ['default'];
  })();

  return { providerName: providerName.trim(), buckets };
}
