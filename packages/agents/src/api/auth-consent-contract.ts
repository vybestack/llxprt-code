/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface BucketAuthConsentRequest {
  readonly correlationId: string;
  readonly provider: string;
  readonly bucket: string;
  readonly bucketIndex: number;
  readonly totalBuckets: number;
}
