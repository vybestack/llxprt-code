import type {
  UserMemoryInput,
  UserMemoryProfileProvider,
} from '../types/providerRuntime.js';

/**
 * Runtime helper for narrowing the union type used by NormalizedGenerateChatOptions.userMemory
 * @plan PLAN-20251023-STATELESS-HARDENING.P05
 * @requirement REQ-SP4-003
 */
export function isUserMemoryProfileProvider(
  value: unknown,
): value is UserMemoryProfileProvider {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getProfile' in value &&
    typeof (value as { getProfile?: unknown }).getProfile === 'function'
  );
}

export async function resolveUserMemory(
  userMemory: UserMemoryInput | undefined,
  fallback?: () => string | undefined,
): Promise<string> {
  if (typeof userMemory === 'string') {
    return userMemory;
  }

  if (isUserMemoryProfileProvider(userMemory)) {
    const profile = await userMemory.getProfile();
    if (typeof profile === 'string') {
      return profile;
    }
    if (profile && typeof profile === 'object') {
      try {
        return JSON.stringify(profile);
      } catch {
        return '';
      }
    }
    return '';
  }

  const fallbackValue = fallback?.();
  return typeof fallbackValue === 'string' ? fallbackValue : '';
}
