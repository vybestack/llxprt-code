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

import {
  DebugLogger,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import { createProfileManager } from './profile-utils.js';

const logger = new DebugLogger('llxprt:oauth:token');

/**
 * Resolve the current profile name from metadata or runtime settings.
 * Returns null if unavailable (not an error unless requestedProfileName is set).
 */
export async function resolveCurrentProfileName(
  providerName: string,
  requestedProfileName: string | null,
): Promise<string | null> {
  if (requestedProfileName) {
    return requestedProfileName;
  }
  try {
    const { getCliRuntimeServices } = await import(
      '../runtime/runtimeSettings.js'
    );
    const { settingsService } = getCliRuntimeServices();
    return typeof settingsService.getCurrentProfileName === 'function'
      ? settingsService.getCurrentProfileName()
      : ((settingsService.get('currentProfile') as string | null) ?? null);
  } catch (error) {
    logger.debug(
      `Could not resolve current profile for ${providerName}:`,
      error,
    );
    return null;
  }
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
): Promise<string[]> {
  let profile: Awaited<
    ReturnType<Awaited<ReturnType<typeof createProfileManager>>['loadProfile']>
  >;
  try {
    const profileManager = await createProfileManager();
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

  if (
    'auth' in profile &&
    profile.auth &&
    typeof profile.auth === 'object' &&
    'type' in profile.auth &&
    profile.auth.type === 'oauth' &&
    'buckets' in profile.auth &&
    Array.isArray(profile.auth.buckets)
  ) {
    return profile.auth.buckets;
  }

  return [];
}

/**
 * Resolve the profile name from metadata or runtime settings, then load
 * the OAuth buckets for that profile.  Returns [] when no profile is active.
 */
export async function resolveProfileBuckets(
  providerName: string,
  metadata?: OAuthTokenRequestMetadata,
): Promise<string[]> {
  const requestedProfileName =
    typeof metadata?.profileId === 'string' && metadata.profileId.trim() !== ''
      ? metadata.profileId.trim()
      : null;

  const currentProfileName = await resolveCurrentProfileName(
    providerName,
    requestedProfileName,
  );
  if (!currentProfileName) {
    return [];
  }

  return loadProfileBuckets(
    providerName,
    currentProfileName,
    requestedProfileName,
  );
}

/**
 * Resolve current profile session metadata for a provider.
 * Returns undefined if no current profile is active.
 */
export async function resolveCurrentProfileSessionMetadata(
  providerName: string,
): Promise<OAuthTokenRequestMetadata | undefined> {
  const currentProfileName = await resolveCurrentProfileName(
    providerName,
    null,
  );

  if (!currentProfileName || currentProfileName.trim() === '') {
    return undefined;
  }

  return {
    providerId: providerName,
    profileId: currentProfileName.trim(),
  };
}
