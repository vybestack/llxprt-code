/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BucketFailoverHandler,
  OnAuthErrorHandler,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import { resolveAuthTokenFromOptions } from '../retryAuthTokenResolver.js';
import type { ResolvedAuthToken } from '../types/providerRuntime.js';
import type { GenerateChatOptions } from '../IProvider.js';

export function retryOperationFixture(
  options: GenerateChatOptions,
  auth?: OnAuthErrorHandler,
  bucket?: BucketFailoverHandler,
): GenerateChatOptions {
  let credential: ResolvedAuthToken | undefined = options.resolved?.authToken;
  return {
    ...options,
    ...(auth
      ? {
          resolved: {
            ...options.resolved,
            authToken: {
              provide: async () =>
                typeof credential === 'string'
                  ? credential
                  : resolveAuthTokenFromOptions(options),
            },
          },
          handleAuthError: async (context) => {
            await auth.handleAuthError(context);
            credential = `${context.failedAccessToken}:refreshed`;
          },
        }
      : {}),
    ...(bucket
      ? {
          tryBucketFailover: bucket.tryFailover.bind(bucket),
          readFailoverBuckets: bucket.getBuckets.bind(bucket),
          readCurrentBucket: bucket.getCurrentBucket.bind(bucket),
          readFailoverReasons: bucket.getLastFailoverReasons?.bind(bucket),
          resetBucketSession: bucket.resetSession?.bind(bucket),
        }
      : {}),
  };
}
