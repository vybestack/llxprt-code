/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

import { unwrapLoggingProvider, type OAuthProvider } from '../oauth-manager.js';

// Cast the current stub to the future-friendly signature so the tests compile
const unwrap = unwrapLoggingProvider as unknown as (
  provider: OAuthProvider | undefined,
) => OAuthProvider | undefined;

function createProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: async () => {
      /* no-op for tests */
    },
    getToken: async () => null,
    refreshToken: async () => null,
  };
}

function createLoggingWrapper(
  provider: OAuthProvider,
  overrideName?: string,
): OAuthProvider & { readonly wrappedProvider: OAuthProvider } {
  return {
    name: overrideName ?? provider.name,
    initiateAuth: provider.initiateAuth.bind(provider),
    getToken: provider.getToken.bind(provider),
    refreshToken: provider.refreshToken.bind(provider),
    get wrappedProvider() {
      return provider;
    },
  };
}

describe('unwrapLoggingProvider safety net', () => {
  it('unwraps nested LoggingProviderWrapper instances @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20', () => {
    const base = createProvider('base');
    const wrappedOnce = createLoggingWrapper(base, 'wrapper-1');
    const wrappedTwice = createLoggingWrapper(wrappedOnce, 'wrapper-2');

    const result = unwrap(wrappedTwice);

    expect(result).toBe(base);
  });

  it('no-ops when provider is undefined @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 4-6', () => {
    const result = unwrap(undefined);

    expect(result).toBeUndefined();
  });

  it('preserves behaviour when no wrappers are present @plan:PLAN-20251020-STATELESSPROVIDER3.P11 @requirement:REQ-SP3-003 @pseudocode oauth-safety.md lines 17-20', () => {
    const base = createProvider('plain');

    const result = unwrap(base);

    expect(result).toBe(base);
  });
});
