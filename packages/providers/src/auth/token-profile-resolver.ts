/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Profile bucket resolution helpers extracted from TokenAccessCoordinator.
 *
 * Resolves the current profile name and its associated OAuth buckets from
 * runtime settings and the profile manager.  These are standalone async
 * functions rather than class methods so they can be unit-tested and reused
 * without instantiating the full coordinator.
 */

import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-auth';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { createProfileManager } from './profile-utils.js';

const logger = new DebugLogger('llxprt:oauth:token');

/**
 * Resolve the current profile name from metadata or runtime settings.
 * Returns null if unavailable (not an error unless requestedProfileName is set).
 */
export function resolveCurrentProfileName(
  requestedProfileName: string | null,
  getOwnerProfileName: () => string | null,
): string | null {
  return requestedProfileName ?? getOwnerProfileName();
}

/**
 * Load OAuth buckets for a resolved profile name.
 * Returns [] for unknown or non-OAuth profiles; re-throws on load error
 * only when the profile was explicitly requested.
 */
export async function loadProfileBuckets(
  providerName: string,
  currentProfileName: string,
  requestedProfileName: string | null,
  profiles?: Pick<ProfileManager, 'loadProfile'>,
): Promise<string[]> {
  let profile: Awaited<
    ReturnType<Awaited<ReturnType<typeof createProfileManager>>['loadProfile']>
  >;
  try {
    const profileManager = profiles ?? (await createProfileManager());
    profile = await profileManager.loadProfile(currentProfileName);
  } catch (error) {
    logger.debug(`Could not load profile buckets for ${providerName}:`, error);
    if (requestedProfileName) {
      throw error;
    }
    return [];
  }

  // Issue #1468: Verify the profile's provider matches the requested provider
  const profileProvider =
    'provider' in profile && typeof profile.provider === 'string'
      ? profile.provider
      : null;

  if (profileProvider !== providerName) {
    logger.debug(
      `Profile provider '${profileProvider}' does not match requested provider '${providerName}', returning empty buckets`,
    );
    return [];
  }

  const auth = 'auth' in profile ? profile.auth : undefined;
  if (!auth || typeof auth !== 'object') {
    return [];
  }
  if (!('type' in auth) || auth.type !== 'oauth' || !('buckets' in auth)) {
    return [];
  }
  if (Array.isArray(auth.buckets)) {
    return auth.buckets;
  }

  return [];
}

/**
 * Resolve the profile name from metadata or runtime settings, then load
 * the OAuth buckets for that profile.  Returns [] when no profile is active.
 */
export async function resolveProfileBuckets(
  providerName: string,
  getOwnerProfileName: () => string | null,
  metadata?: OAuthTokenRequestMetadata,
  profiles?: Pick<ProfileManager, 'loadProfile'>,
): Promise<string[]> {
  const requestedProfileName =
    typeof metadata?.profileId === 'string' && metadata.profileId.trim() !== ''
      ? metadata.profileId.trim()
      : null;

  const currentProfileName = resolveCurrentProfileName(
    requestedProfileName,
    getOwnerProfileName,
  );
  if (!currentProfileName) {
    return [];
  }

  return loadProfileBuckets(
    providerName,
    currentProfileName,
    requestedProfileName,
    profiles,
  );
}

/**
 * Resolve current profile session metadata for a provider.
 * Returns undefined if no current profile is active.
 */
export async function resolveCurrentProfileSessionMetadata(
  providerName: string,
  currentProfileName: string | null,
): Promise<OAuthTokenRequestMetadata | undefined> {
  if (!currentProfileName || currentProfileName.trim() === '') {
    return undefined;
  }

  return {
    providerId: providerName,
    profileId: currentProfileName.trim(),
  };
}

export interface CurrentProfileOAuthContext {
  readonly metadata: OAuthTokenRequestMetadata;
  readonly providerMatches: boolean;
  readonly hasExplicitBucketPolicy: boolean;
}

export async function resolveCurrentProfileOAuthContext(
  providerName: string,
  currentProfileName: string | null,
  profiles?: Pick<ProfileManager, 'loadProfile'>,
): Promise<CurrentProfileOAuthContext | undefined> {
  const metadata = await resolveCurrentProfileSessionMetadata(
    providerName,
    currentProfileName,
  );
  if (metadata?.profileId === undefined) {
    return undefined;
  }

  const profileManager = profiles ?? (await createProfileManager());
  const profile = await profileManager.loadProfile(metadata.profileId);
  const profileProvider =
    'provider' in profile && typeof profile.provider === 'string'
      ? profile.provider
      : null;
  const providerMatches = profileProvider === providerName;
  const hasExplicitBucketPolicy = hasNonEmptyOAuthBuckets(profile);

  return { metadata, providerMatches, hasExplicitBucketPolicy };
}

function hasNonEmptyOAuthBuckets(profile: object): boolean {
  const auth = (profile as Record<string, unknown>).auth;
  if (auth === null || auth === undefined || typeof auth !== 'object') {
    return false;
  }
  const authRecord = auth as Record<string, unknown>;
  if (authRecord.type !== 'oauth') {
    return false;
  }
  return Array.isArray(authRecord.buckets) && authRecord.buckets.length > 0;
}
