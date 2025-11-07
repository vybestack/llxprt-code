import type { ResolvedAuthToken } from '../types/providerRuntime.js';

/**
 * Auth token helpers for stateless provider runtimes.
 * @plan PLAN-20251023-STATELESS-HARDENING.P05
 * @requirement REQ-SP4-003
 */

interface AuthTokenProviderLike {
  provide?: () => Promise<string | undefined> | string | undefined;
}

export function isRuntimeAuthTokenProvider(
  value: unknown,
): value is AuthTokenProviderLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'provide' in value &&
    typeof (value as AuthTokenProviderLike).provide === 'function'
  );
}

import { DebugLogger } from '../../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:auth:token');

export async function resolveRuntimeAuthToken(
  token: ResolvedAuthToken | undefined,
): Promise<string | undefined> {
  if (typeof token === 'string') {
    logger.debug(() => `Returning string token: "${token.substring(0, 8)}..."`);
    return token;
  }
  if (isRuntimeAuthTokenProvider(token)) {
    const result = await token.provide?.();
    logger.debug(
      () =>
        `Provider result: ${typeof result === 'string' ? `"${result.substring(0, 8)}..."` : 'null/undefined'}`,
    );
    return typeof result === 'string' ? result : undefined;
  }
  logger.debug(
    () =>
      `No token available, token type: ${typeof token}, value: ${JSON.stringify(token)}`,
  );
  return undefined;
}
