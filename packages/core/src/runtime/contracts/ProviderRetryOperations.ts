/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BucketFailoverHandler,
  OnAuthErrorHandler,
} from '../../config/configTypes.js';

export interface ProviderRetryOperations {
  readRetryAuthToken?: () => Promise<string>;
  handleAuthError?: OnAuthErrorHandler['handleAuthError'];
  tryBucketFailover?: BucketFailoverHandler['tryFailover'];
  readFailoverBuckets?: BucketFailoverHandler['getBuckets'];
  readCurrentBucket?: BucketFailoverHandler['getCurrentBucket'];
  readFailoverReasons?: BucketFailoverHandler['getLastFailoverReasons'];
  resetBucketSession?: BucketFailoverHandler['resetSession'];
}
