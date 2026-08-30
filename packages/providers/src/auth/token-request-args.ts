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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

const logger = new DebugLogger('llxprt:oauth:token-request-args');

/**
 * Read the auth-bucket-prompt ephemeral setting, defaulting to false when the
 * runtime is not initialized yet.
 */
export function readAuthBucketPromptSetting(): boolean {
  try {
    const promptSetting = oauthRuntimeBridge.getEphemeralSetting(
      'auth-bucket-prompt',
    ) as boolean | null | undefined;
    return promptSetting ?? false;
  } catch (runtimeError) {
    logger.debug(
      'Could not get ephemeral setting (runtime not initialized), using default',
      runtimeError,
    );
    return false;
  }
}

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
