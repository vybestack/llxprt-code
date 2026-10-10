/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure argument-coercion helpers for token access entry points. Extracted
 * from TokenAccessCoordinator to keep that file within the source-size
 * budget; behavior is unchanged.
 */

import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-auth';

export function resolveImplicitBucketToCheck(
  sessionBucket: string | undefined,
  profileBuckets: string[],
): string | undefined {
  if (typeof sessionBucket === 'string' && sessionBucket.trim() !== '') {
    return sessionBucket;
  }
  return profileBuckets.length === 1 ? profileBuckets[0] : undefined;
}

export function extractRequestMetadata(
  bucket: string | unknown,
): OAuthTokenRequestMetadata | undefined {
  if (typeof bucket === 'string' || bucket === null || bucket === undefined) {
    return undefined;
  }
  if (isPlainObject(bucket)) {
    return bucket as OAuthTokenRequestMetadata;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
