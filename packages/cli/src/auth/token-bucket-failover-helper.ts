/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Failover handler management helpers extracted from TokenAccessCoordinator.
 *
 * Manages creation and consistency-checking of the Config's
 * BucketFailoverHandlerImpl for multi-bucket OAuth profiles.
 */

import {
  DebugLogger,
  type Config,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import { hasRequestMetadata } from './auth-utils.js';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OnAuthErrorHandlerImpl } from './OnAuthErrorHandlerImpl.js';
import type { OAuthBucketManager } from './OAuthBucketManager.js';
import type { BucketFailoverOAuthManagerLike } from './types.js';

const logger = new DebugLogger('llxprt:oauth:token');

/**
 * Ensure the Config's bucket failover handler exists and is consistent with
 * the current profile buckets and request scope. Creates a new handler when
 * buckets or scope differ. Logs a warning when Config is unavailable.
 *
 * Returns the current (or newly created) failover handler, or undefined when
 * the profile has ≤1 bucket or no Config is available.
 */
export function ensureFailoverHandler(
  providerName: string,
  profileBuckets: string[],
  requestMetadata: OAuthTokenRequestMetadata | undefined,
  config: Config | undefined,
  bucketManager: OAuthBucketManager,
  facadeRef: BucketFailoverOAuthManagerLike,
):
  | {
      getBuckets: () => string[];
      getCurrentBucket: () => string | undefined;
      isEnabled: () => boolean;
    }
  | undefined {
  if (profileBuckets.length <= 1) {
    return undefined;
  }

  if (!config) {
    logger.warn(
      `[issue1029] CRITICAL: Profile has ${profileBuckets.length} buckets but no Config available to set failover handler! ` +
        `Bucket failover will NOT work. Ensure OAuthManager receives the active Config instance from the composition root.`,
    );
    return undefined;
  }

  let failoverHandler = config.getBucketFailoverHandler?.();

  const existingBuckets = failoverHandler?.getBuckets?.() ?? [];
  const sameBuckets =
    existingBuckets.length === profileBuckets.length &&
    existingBuckets.every((value, index) => value === profileBuckets[index]);
  const requestedScopeKey = bucketManager.getSessionBucketScopeKey(
    providerName,
    requestMetadata,
  );
  const existingRequestMetadata = hasRequestMetadata(failoverHandler)
    ? failoverHandler.getRequestMetadata()
    : undefined;
  const existingScopeKey = bucketManager.getSessionBucketScopeKey(
    providerName,
    existingRequestMetadata,
  );
  const sameScope = existingScopeKey === requestedScopeKey;

  logger.debug(
    () =>
      `[issue1029] Failover handler check: hasExisting=${!!failoverHandler}, sameBuckets=${sameBuckets}, sameScope=${sameScope}, existingBuckets=${JSON.stringify(existingBuckets)}`,
  );

  if (!failoverHandler || !sameBuckets || !sameScope) {
    const handler = new BucketFailoverHandlerImpl(
      profileBuckets,
      providerName,
      facadeRef,
      requestMetadata,
    );
    config.setBucketFailoverHandler(handler);
    failoverHandler = handler;
    logger.debug(
      () =>
        `[issue1029] Created and set new BucketFailoverHandlerImpl on config for ${providerName} with buckets: ${JSON.stringify(profileBuckets)}`,
    );
  }

  return failoverHandler;
}

/**
 * Ensure the Config's OnAuthErrorHandler exists and is set.
 * Creates and sets a new handler when one doesn't exist.
 * Logs a warning when Config is unavailable.
 *
 * Returns the current (or newly created) handler, or undefined when no Config is available.
 *
 * @fix issue1861 - Token revocation handling
 */
export function ensureOnAuthErrorHandler(
  providerName: string,
  config: Config | undefined,
  facadeRef: BucketFailoverOAuthManagerLike,
): void {
  if (!config) {
    logger.warn(
      `[issue1861] CRITICAL: No Config available to set auth error handler! ` +
        `Token revocation recovery will NOT work. Ensure OAuthManager receives the active Config instance from the composition root.`,
    );
    return;
  }

  // Check if handler already exists
  const existingHandler = config.getOnAuthErrorHandler?.();
  if (existingHandler) {
    logger.debug(
      () =>
        `[issue1861] OnAuthErrorHandler already configured on config for ${providerName}`,
    );
    return;
  }

  // Create new handler
  const newHandler = new OnAuthErrorHandlerImpl(facadeRef);
  config.setOnAuthErrorHandler?.(newHandler);

  logger.debug(
    () =>
      `[issue1861] Created and set new OnAuthErrorHandlerImpl on config for ${providerName}`,
  );
}
