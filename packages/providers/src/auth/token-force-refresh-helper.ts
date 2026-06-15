/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Force-refresh helpers extracted from TokenAccessCoordinator.
 *
 * These standalone functions coordinate the TOCTOU-safe force-refresh path that
 * runs when a token is known to be revoked (401/403). They depend only on the
 * token store, provider registry, and proactive renewal manager.
 *
 * @fix issue1861 - Token revocation handling
 * @fix issue2035 - Refresh on empty failed token (OAuth resolved below retry layer)
 */

import {
  DebugLogger,
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from '@vybestack/llxprt-code-core';
import { invalidateProviderRuntimeCache } from '@vybestack/llxprt-code-auth';
import type { OAuthToken, TokenStore } from './types.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { ProactiveRenewalManager } from './proactive-renewal-manager.js';

const logger = new DebugLogger('llxprt:oauth:token');

/**
 * Resolve the access token to use as the TOCTOU baseline for a force refresh.
 *
 * Callers that resolve OAuth tokens *below* the retry layer (e.g. the provider
 * wrappers used by the agent runtime) cannot supply the concrete failed access
 * token, so they pass an empty string. In that case we read the currently
 * stored access token and treat it as the baseline. Capturing it here — before
 * the refresh lock is acquired — preserves the TOCTOU de-duplication: if another
 * process refreshes the token while we wait for the lock, the post-lock
 * comparison will detect the change and skip a redundant refresh, while a
 * genuine 401 still triggers a real refresh instead of being misread as
 * "already refreshed by another process".
 *
 * @fix issue2035
 */
export async function resolveForceRefreshBaseline(
  providerName: string,
  failedAccessToken: string,
  bucket: string | undefined,
  tokenStore: TokenStore,
): Promise<string> {
  if (failedAccessToken !== '') {
    return failedAccessToken;
  }

  try {
    const storedToken = await tokenStore.getToken(providerName, bucket);
    const baseline = storedToken?.access_token ?? '';
    logger.debug(
      () =>
        `[issue2035] forceRefreshToken called without a failed token for ${providerName}; using current stored token as refresh baseline (present=${baseline !== ''})`,
    );
    return baseline;
  } catch (error) {
    logger.debug(
      () =>
        `[issue2035] Failed to read stored token for ${providerName} while resolving force-refresh baseline: ${error instanceof Error ? error.message : error}`,
    );
    return '';
  }
}

/**
 * Load the stored token for a force refresh and classify it relative to the
 * failed (baseline) access token.
 *
 * Returns:
 *  - null       → nothing to do (no token, or no refresh token available)
 *  - a token whose access_token !== failedAccessToken → another process already
 *    refreshed; caller should invalidate caches and return it
 *  - a token whose access_token === failedAccessToken → caller should refresh
 */
export async function loadTokenForForceRefresh(
  providerName: string,
  failedAccessToken: string,
  bucket: string | undefined,
  tokenStore: TokenStore,
): Promise<OAuthToken | null> {
  const storedToken = await tokenStore.getToken(providerName, bucket);

  if (!storedToken) {
    logger.debug(
      () =>
        `[FLOW] No stored token found for forceRefreshToken() on ${providerName}`,
    );
    return null;
  }

  if (storedToken.access_token !== failedAccessToken) {
    logger.debug(
      () =>
        `[FLOW] Token already refreshed by another process for ${providerName}`,
    );
    return storedToken;
  }

  if (
    !storedToken.refresh_token ||
    typeof storedToken.refresh_token !== 'string' ||
    storedToken.refresh_token === ''
  ) {
    logger.debug(
      () =>
        `[FLOW] No refresh token available for forceRefreshToken() on ${providerName}`,
    );
    return null;
  }

  return storedToken;
}

/**
 * Execute the provider's refresh against a stored token and persist the result.
 */
export async function refreshStoredToken(
  providerName: string,
  storedToken: OAuthToken,
  bucket: string | undefined,
  tokenStore: TokenStore,
  providerRegistry: ProviderRegistry,
  proactiveRenewalManager: ProactiveRenewalManager,
): Promise<OAuthToken | null> {
  const provider = providerRegistry.getProvider(providerName);
  if (!provider) {
    return null;
  }

  logger.debug(
    () =>
      `[FLOW] Executing force refresh for ${providerName} (token matches failed token)`,
  );

  const refreshedToken = await provider.refreshToken(storedToken);

  if (!refreshedToken) {
    logger.debug(
      () => `[FLOW] Force refresh returned null for ${providerName}`,
    );
    return null;
  }

  const mergedToken = mergeRefreshedToken(
    storedToken as OAuthTokenWithExtras,
    refreshedToken as Partial<OAuthTokenWithExtras>,
  );

  logger.debug(
    () =>
      `[FLOW] Force refresh successful for ${providerName}, saving token...`,
  );

  await tokenStore.saveToken(providerName, mergedToken, bucket);
  proactiveRenewalManager.scheduleProactiveRenewal(
    providerName,
    bucket,
    mergedToken,
  );

  return mergedToken;
}

/**
 * Invalidate in-memory runtime-scoped auth caches after a successful token
 * refresh, so retries (and other agents/runtimes) resolve the fresh disk token
 * instead of the revoked one. Best-effort: never throws, because the token has
 * already been refreshed on disk.
 *
 * Scope note: the runtimeScopedStates cache is keyed by
 * runtimeId::providerId::profileId and has no bucket dimension, so the coarsest
 * meaningful granularity is provider-wide. We intentionally invalidate the whole
 * provider (rather than a single bucket/profile): a 401 means the revoked access
 * token must not be served anywhere, and any collateral re-resolution for other
 * profiles simply re-reads the correct token from disk — a cheap, safe recovery
 * rather than a correctness risk.
 *
 * @fix issue2035
 */
export function invalidateRuntimeCacheAfterRefresh(providerName: string): void {
  try {
    const invalidated = invalidateProviderRuntimeCache(providerName);
    logger.debug(
      () =>
        `[issue2035] Invalidated ${invalidated} runtime cache entr${invalidated === 1 ? 'y' : 'ies'} for ${providerName} after token refresh`,
    );
  } catch (error) {
    logger.debug(
      () =>
        `[issue2035] Failed to invalidate runtime cache for ${providerName}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
