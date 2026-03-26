/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token refresh and disk-check helpers extracted from TokenAccessCoordinator.
 *
 * These standalone functions coordinate the TOCTOU-safe token refresh path
 * and the pre-auth disk-check path, using only the token store and provider
 * registry as external dependencies.
 */

import {
  DebugLogger,
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from '@vybestack/llxprt-code-core';
import type { OAuthToken, TokenStore } from './types.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ProactiveRenewalManager } from './proactive-renewal-manager.js';

const logger = new DebugLogger('llxprt:oauth:token');

// --------------------------------------------------------------------------
// Refresh-lock-miss handler
// --------------------------------------------------------------------------

/**
 * Handle the case where the refresh lock could not be acquired.
 * Reads disk to check if another process already refreshed.
 */
export async function handleRefreshLockMiss(
  providerName: string,
  bucketToUse: string | undefined,
  thirtySecondsFromNow: number,
  tokenStore: TokenStore,
  proactiveRenewalManager: ProactiveRenewalManager,
): Promise<OAuthToken | null> {
  logger.debug(
    () =>
      `[FLOW] Failed to acquire refresh lock for ${providerName}, checking disk...`,
  );
  const reloadedToken = await tokenStore.getToken(providerName, bucketToUse);
  if (reloadedToken && reloadedToken.expiry > thirtySecondsFromNow) {
    logger.debug(
      () => `[FLOW] Token was refreshed by another process for ${providerName}`,
    );
    proactiveRenewalManager.scheduleProactiveRenewal(
      providerName,
      bucketToUse,
      reloadedToken,
    );
    return reloadedToken;
  }
  return null;
}

// --------------------------------------------------------------------------
// Execute token refresh under lock
// --------------------------------------------------------------------------

/**
 * Attempt the actual token refresh under the held lock.
 * TOCTOU double-check: re-reads the token after acquiring to detect
 * concurrent refreshes by other processes.
 */
export async function executeTokenRefresh(
  providerName: string,
  bucketToUse: string | undefined,
  token: OAuthToken,
  thirtySecondsFromNow: number,
  tokenStore: TokenStore,
  providerRegistry: ProviderRegistry,
  proactiveRenewalManager: ProactiveRenewalManager,
): Promise<OAuthToken | null> {
  try {
    const recheckToken = await tokenStore.getToken(providerName, bucketToUse);
    if (recheckToken && recheckToken.expiry > thirtySecondsFromNow) {
      logger.debug(
        () =>
          `[FLOW] Token was refreshed by another process while waiting for lock for ${providerName}`,
      );
      proactiveRenewalManager.scheduleProactiveRenewal(
        providerName,
        bucketToUse,
        recheckToken,
      );
      return recheckToken;
    }

    // Guard: if the refresh_token on disk differs from what we originally read,
    // another process already consumed the single-use refresh token. Skip refresh
    // to avoid replaying a consumed token (which can trigger revocation).
    if (
      recheckToken &&
      token.refresh_token &&
      recheckToken.refresh_token !== token.refresh_token
    ) {
      logger.debug(
        () =>
          `[FLOW] Refresh token changed for ${providerName} — another process refreshed, skipping`,
      );
      return recheckToken;
    }

    const provider = providerRegistry.getProvider(providerName);
    if (!provider) return null;

    const refreshedToken = await provider.refreshToken(recheckToken || token);
    if (!refreshedToken) {
      logger.debug(
        () => `[FLOW] Token refresh returned null for ${providerName}`,
      );
      return null;
    }

    const mergedToken = mergeRefreshedToken(
      (recheckToken || token) as OAuthTokenWithExtras,
      refreshedToken as OAuthTokenWithExtras,
    );
    logger.debug(
      () => `[FLOW] Token refreshed for ${providerName}, saving to store...`,
    );
    await tokenStore.saveToken(providerName, mergedToken, bucketToUse);
    proactiveRenewalManager.scheduleProactiveRenewal(
      providerName,
      bucketToUse,
      mergedToken,
    );
    return mergedToken;
  } catch (refreshError) {
    logger.debug(
      () =>
        `[FLOW] Token refresh FAILED for ${providerName}: ${refreshError instanceof Error ? refreshError.message : refreshError}`,
    );
    return null;
  }
}

// --------------------------------------------------------------------------
// Disk-check helpers
// --------------------------------------------------------------------------

/**
 * Try to refresh an expired disk token. Returns access_token on success,
 * or undefined when refresh is not possible or fails.
 */
export async function tryRefreshDiskToken(
  providerName: string,
  bucketToCheck: string | undefined,
  diskToken: OAuthToken,
  tokenStore: TokenStore,
  providerRegistry: ProviderRegistry,
): Promise<string | undefined> {
  const provider = providerRegistry.getProvider(providerName);
  if (!provider) return undefined;
  try {
    const refreshedToken = await provider.refreshToken(diskToken);
    if (refreshedToken) {
      const mergedToken = mergeRefreshedToken(
        diskToken as OAuthTokenWithExtras,
        refreshedToken as OAuthTokenWithExtras,
      );
      await tokenStore.saveToken(providerName, mergedToken, bucketToCheck);
      logger.debug(
        () =>
          `[issue1317] Refreshed expired disk token for ${providerName}, skipping OAuth`,
      );
      return mergedToken.access_token;
    }
  } catch (refreshError) {
    logger.debug(
      () =>
        `[issue1317] Disk token refresh failed for ${providerName}: ${refreshError instanceof Error ? refreshError.message : refreshError}`,
    );
  }
  return undefined;
}

/**
 * Perform disk check while holding the refresh lock.
 * Returns access_token if a usable token exists (valid or refreshable),
 * or undefined to continue to full auth.
 */
export async function performDiskCheckUnderLock(
  providerName: string,
  bucketToCheck: string | undefined,
  tokenStore: TokenStore,
  providerRegistry: ProviderRegistry,
): Promise<string | undefined> {
  const diskToken = await tokenStore.getToken(providerName, bucketToCheck);
  const thirtySecondsFromNow = Math.floor(Date.now() / 1000) + 30;

  if (diskToken && diskToken.expiry > thirtySecondsFromNow) {
    logger.debug(
      () =>
        `[issue1262/1195] Found valid token on disk for ${providerName}, skipping OAuth`,
    );
    return diskToken.access_token;
  }

  // @fix issue1317: expired disk token with refresh_token — try refresh
  if (
    diskToken &&
    typeof diskToken.refresh_token === 'string' &&
    diskToken.refresh_token !== ''
  ) {
    const result = await tryRefreshDiskToken(
      providerName,
      bucketToCheck,
      diskToken,
      tokenStore,
      providerRegistry,
    );
    if (result !== undefined) {
      return result;
    }
  }

  return undefined;
}
