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
 * Type alias for the ProfileManager constructor.
 * Uses dynamic import to avoid pulling in the core package at module load time.
 */
type ProfileManagerCtor =
  (typeof import('@vybestack/llxprt-code-core'))['ProfileManager'];

/**
 * Cached promise for the ProfileManager constructor.
 * This enables lazy loading of the ProfileManager module.
 */
let profileManagerCtorPromise: Promise<ProfileManagerCtor> | undefined;

/**
 * Gets the ProfileManager constructor via dynamic import.
 * Caches the promise to avoid repeated imports.
 */
async function getProfileManagerCtor(): Promise<ProfileManagerCtor> {
  if (!profileManagerCtorPromise) {
    profileManagerCtorPromise = import('@vybestack/llxprt-code-core')
      .then((mod) => mod.ProfileManager)
      .catch((error) => {
        profileManagerCtorPromise = undefined;
        throw error;
      });
  }
  return profileManagerCtorPromise;
}

/**
 * Creates a new ProfileManager instance.
 */
export async function createProfileManager(): Promise<
  InstanceType<ProfileManagerCtor>
> {
  const ProfileManager = await getProfileManagerCtor();
  return new ProfileManager();
}

/**
 * Type guard to check if a profile is a load balancer configuration.
 */
export function isLoadBalancerProfileLike(
  profile: unknown,
): profile is { type: 'loadbalancer'; profiles: string[] } {
  return (
    !!profile &&
    typeof profile === 'object' &&
    'type' in profile &&
    (profile as { type?: unknown }).type === 'loadbalancer' &&
    'profiles' in profile &&
    Array.isArray((profile as { profiles?: unknown }).profiles) &&
    (profile as { profiles: unknown[] }).profiles.every(
      (name) => typeof name === 'string' && name.trim() !== '',
    )
  );
}

/**
 * Extracts OAuth bucket configuration from a profile object.
 * Returns null if the profile doesn't have OAuth auth configuration.
 */
export function getOAuthBucketsFromProfile(
  profile: unknown,
): { providerName: string; buckets: string[] } | null {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const providerName =
    'provider' in profile && typeof profile.provider === 'string'
      ? profile.provider
      : null;
  if (!providerName || providerName.trim() === '') {
    return null;
  }

  const auth = 'auth' in profile ? profile.auth : undefined;
  if (!auth || typeof auth !== 'object') {
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
