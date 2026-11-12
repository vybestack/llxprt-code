import type {
  RequestCredential,
  ResolvedAuthToken,
} from '../types/providerRuntime.js';

/**
 * Auth token helpers for stateless provider runtimes.
 * @plan PLAN-20251023-STATELESS-HARDENING.P05
 * @requirement REQ-SP4-003
 */

interface AuthTokenProviderLike {
  provide: () => Promise<string | undefined> | string | undefined;
  provideCredential?: () => Promise<RequestCredential>;
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
    const result = await token.provide();
    return typeof result === 'string' ? result : undefined;
  }
  return undefined;
}

/**
 * Copies exactly the bearer, account id and identity marker out of a resolver
 * result, so nothing else a source attaches can travel with the credential.
 */
export function toRequestCredential(
  resolved: RequestCredential,
): RequestCredential {
  return {
    token: resolved.token,
    ...(resolved.accountId === undefined
      ? {}
      : { accountId: resolved.accountId }),
    ...(resolved.identity === undefined ? {} : { identity: resolved.identity }),
  };
}

/**
 * Resolves the runtime token as a bearer+identity pair with ONE read. A token
 * source that can supply identity does so from the same read as the bearer; a
 * plain string or bearer-only provider yields a bearer without identity.
 */
export async function resolveRuntimeAuthCredential(
  token: ResolvedAuthToken | undefined,
): Promise<RequestCredential | undefined> {
  if (isRuntimeAuthTokenProvider(token) && token.provideCredential) {
    return token.provideCredential();
  }
  const bearer = await resolveRuntimeAuthToken(token);
  return bearer === undefined ? undefined : { token: bearer };
}
