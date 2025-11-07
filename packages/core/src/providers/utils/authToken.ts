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

export async function resolveRuntimeAuthToken(
  token: ResolvedAuthToken | undefined,
): Promise<string | undefined> {
  if (typeof token === 'string') {
    return token;
  }
  if (isRuntimeAuthTokenProvider(token)) {
    const result = await token.provide?.();
    return typeof result === 'string' ? result : undefined;
  }
  return undefined;
}
