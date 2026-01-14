/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue490
 * Phase 6: Failover Logic Implementation
 *
 * Implements bucket failover logic for handling quota and rate limit errors
 */

/**
 * Determines if an error should trigger failover to the next bucket
 *
 * Failover triggers:
 * - 429 rate limit
 * - Quota exceeded
 * - 402 payment required
 * - Token renewal failure
 *
 * Does NOT failover:
 * - 400 bad request
 * - Other API errors
 */
export function shouldFailover(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for status code on error object (common pattern)
  const errorStatus = (error as { status?: number }).status;
  if (errorStatus === 401 || errorStatus === 403) {
    return true;
  }

  return (
    message.includes('429') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('402') ||
    message.includes('payment') ||
    message.includes('revoked') ||
    message.includes('permission_error') ||
    (message.includes('token') && message.includes('expired'))
  );
}

export interface NotificationLog {
  messages: string[];
}

/**
 * Logs a bucket switch notification
 */
export function notifyBucketSwitch(
  fromBucket: string,
  toBucket: string,
  log: NotificationLog,
): void {
  const message = `Bucket '${fromBucket}' quota exceeded, switching to '${toBucket}'`;
  log.messages.push(message);
}

export interface ProfileBucketConfig {
  provider: string;
  buckets: string[];
}

/**
 * Resolves the bucket list for a profile, prioritizing session overrides
 */
export function resolveBucketsForFailover(
  profileConfig: ProfileBucketConfig,
  sessionBucket?: string,
): string[] {
  if (sessionBucket) {
    return [sessionBucket];
  }

  if (profileConfig.buckets.length === 0) {
    return ['default'];
  }

  return profileConfig.buckets;
}

export interface BucketStatus {
  bucket: string;
  error: string;
}

/**
 * Formats comprehensive error when all buckets fail
 */
export function formatAllBucketsExhaustedError(
  provider: string,
  bucketStatuses: BucketStatus[],
): Error {
  let message = `All buckets exhausted for provider '${provider}':\n`;

  for (const status of bucketStatuses) {
    message += `  - ${status.bucket}: ${status.error}\n`;
  }

  message += `Try again later or add more buckets to the profile.`;

  return new Error(message);
}

export interface MockProfile {
  provider: string;
  model: string;
  auth?: {
    type: 'oauth';
    buckets: string[];
  };
}

export interface MockTokenStore {
  getToken: (provider: string, bucket: string) => Promise<unknown>;
}

/**
 * Validates buckets exist before profile can be loaded
 */
export async function validateProfileBucketsExist(
  profile: MockProfile,
  tokenStore: MockTokenStore,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  const buckets = profile.auth?.buckets ?? ['default'];

  for (const bucket of buckets) {
    const token = await tokenStore.getToken(profile.provider, bucket);

    if (!token) {
      errors.push(
        `OAuth bucket '${bucket}' for provider '${profile.provider}' not found. ` +
          `Use /auth ${profile.provider} login ${bucket} to authenticate.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface MockToken {
  access_token: string;
  expiry: number;
}

/**
 * Determines if a token is expired
 */
export function isTokenExpired(token: MockToken): boolean {
  const nowSeconds = Date.now() / 1000;
  return token.expiry < nowSeconds;
}

export interface MockRequest {
  prompt: string;
}

export interface MockResponse {
  content: string;
}

export type RequestExecutor = (
  request: MockRequest,
  bucket: string,
) => Promise<MockResponse>;

/**
 * Executes a request with automatic bucket failover on quota/rate limit errors
 */
export async function executeWithBucketFailover(
  request: MockRequest,
  buckets: string[],
  executor: RequestExecutor,
): Promise<MockResponse> {
  let lastError: Error | null = null;

  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];

    try {
      const response = await executor(request, bucket);
      return response;
    } catch (error) {
      const err = error as Error;
      lastError = err;

      if (shouldFailover(err)) {
        if (i < buckets.length - 1) {
          continue;
        } else {
          // Last bucket also failed with failover error
          throw new Error(`All buckets exhausted. Last error: ${err.message}`);
        }
      }

      throw err;
    }
  }

  // Note: This point is unreachable because the loop always:
  // 1. Returns on successful execution (line 182)
  // 2. Throws on non-failover error (line 196)
  // 3. Throws "All buckets exhausted" on last bucket failover error (line 192)
  // However, TypeScript doesn't recognize this, so we need this for type safety
  throw new Error(
    `All buckets exhausted. Last error: ${lastError?.message ?? 'Unknown error'}`,
  );
}
