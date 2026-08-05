/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from './IProvider.js';
import type { BucketFailoverHandler } from '@vybestack/llxprt-code-core/config/config.js';
import type { OnAuthErrorHandler } from '@vybestack/llxprt-code-core/config/configTypes.js';

/**
 * Extract the bucket failover handler from a config-like object, if present.
 */
export function resolveBucketFailoverHandlerFromConfig(
  config: unknown,
): BucketFailoverHandler | undefined {
  const configWithHandler = config as
    | { getBucketFailoverHandler?: () => BucketFailoverHandler | undefined }
    | null
    | undefined;
  return configWithHandler?.getBucketFailoverHandler?.();
}

/**
 * Resolve the bucket failover handler from GenerateChatOptions, checking
 * runtime config first then the static config.
 */
export function getBucketFailoverHandlerFromOptions(
  options: GenerateChatOptions,
): BucketFailoverHandler | undefined {
  return (
    resolveBucketFailoverHandlerFromConfig(options.runtime?.config) ??
    resolveBucketFailoverHandlerFromConfig(options.config)
  );
}

/**
 * Extract the auth error handler from a config-like object, if present.
 * @fix issue1861
 */
export function resolveOnAuthErrorHandlerFromConfig(
  config: unknown,
): OnAuthErrorHandler | undefined {
  const configWithHandler = config as
    | { getOnAuthErrorHandler?: () => OnAuthErrorHandler | undefined }
    | null
    | undefined;
  return configWithHandler?.getOnAuthErrorHandler?.();
}

/**
 * Resolve the auth error handler from GenerateChatOptions, checking
 * runtime config first then the static config.
 */
export function getOnAuthErrorHandlerFromOptions(
  options: GenerateChatOptions,
): OnAuthErrorHandler | undefined {
  return (
    resolveOnAuthErrorHandlerFromConfig(options.runtime?.config) ??
    resolveOnAuthErrorHandlerFromConfig(options.config)
  );
}

/**
 * Whether any auth-recovery mechanism that can change a retry's outcome is
 * resolvable from the options: an onAuthError handler OR a bucket-failover
 * handler. Used to avoid granting a refresh retry when no recovery can occur
 * (issue #2917).
 */
export function hasAuthRecoveryHandler(options: GenerateChatOptions): boolean {
  return (
    getOnAuthErrorHandlerFromOptions(options) !== undefined ||
    getBucketFailoverHandlerFromOptions(options) !== undefined
  );
}
