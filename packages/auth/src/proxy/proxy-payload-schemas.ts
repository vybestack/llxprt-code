/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Narrowly scoped schemas that validate credential-proxy payloads at the
 * IPC trust boundary (issue #2197). Successful response envelopes and
 * operation-specific data are parsed with these before use.
 */

import { z } from 'zod';
import { OAuthTokenSchema, BucketStatsSchema } from '../types.js';

/**
 * Stable error message for a successful response whose data does not match its
 * operation schema. Used at every client payload boundary.
 */
export const PROXY_PAYLOAD_ERROR = 'PROXY_PAYLOAD_ERROR';

export function proxyPayloadError(message: string): Error {
  return new Error(`${PROXY_PAYLOAD_ERROR}: ${message}`);
}

/**
 * Response envelope schema. `ok` must be boolean; `data` must be a
 * non-null, non-array object when present; `error`, `code`, and
 * `retryAfter` must have their protocol types when present. Unknown envelope
 * fields, including the request `id`, are preserved so the same schema validates
 * handshake and correlated frames.
 */
export const ProxyResponseSchema = z
  .object({
    ok: z.boolean(),
    data: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
    code: z.string().optional(),
    retryAfter: z.number().optional(),
  })
  .passthrough();

export type ProxyResponse = z.infer<typeof ProxyResponseSchema>;

/** Success payload for get_token. Validates and preserves the full OAuth token. */
export const OAuthTokenDataSchema = OAuthTokenSchema.passthrough();

/** Success payload for list_providers. */
export const ProvidersDataSchema = z.object({
  providers: z.array(z.string()),
});

/** Success payload for list_buckets. */
export const BucketsDataSchema = z.object({ buckets: z.array(z.string()) });

/** Success payload for get_bucket_stats. */
export const BucketStatsDataSchema = BucketStatsSchema.passthrough();

/** Success payload for get_api_key. */
export const ApiKeyDataSchema = z.object({ key: z.string() });

/** Success payload for list_api_keys. */
export const ApiKeysDataSchema = z.object({ keys: z.array(z.string()) });

/** Success payload for has_api_key. */
export const HasApiKeyDataSchema = z.object({ exists: z.boolean() });

/**
 * Parses an operation-specific successful payload with the given schema. When
 * the data is missing, malformed, or wrong-typed, throws the stable proxy
 * payload validation error.
 */
export function parseSuccessPayload<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  data: Record<string, unknown> | undefined,
  operation: string,
): T {
  if (data === undefined) {
    throw proxyPayloadError(`${operation}: missing data`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw proxyPayloadError(`${operation}: malformed payload`);
  }
  return parsed.data;
}
