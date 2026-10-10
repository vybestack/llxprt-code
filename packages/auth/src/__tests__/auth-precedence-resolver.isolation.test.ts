/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolver instances share no module-level auth state (issue #2616): two
 * resolvers for the same provider and runtime label resolve independently,
 * and reconfiguring one never changes what the other returns.
 */

import { describe, it, expect } from 'bun:test';
import { AuthPrecedenceResolver } from '../index.js';
import type { ISettingsService, OAuthManager } from '../index.js';

function createSettingsService(
  values: Record<string, unknown> = {},
): ISettingsService {
  return {
    get: (key) => values[key],
    getProviderSettings: () => ({}),
    on: () => {},
    off: () => {},
  };
}

function createOAuthManager(initialToken: string | null): {
  manager: OAuthManager;
  setToken: (token: string | null) => void;
  calls: () => number;
} {
  let token = initialToken;
  let calls = 0;
  return {
    manager: {
      getToken: async () => {
        calls += 1;
        return token;
      },
      isAuthenticated: async () => token !== null,
    },
    setToken: (next) => {
      token = next;
    },
    calls: () => calls,
  };
}

const OAUTH_CONFIG = {
  providerId: 'anthropic',
  isOAuthEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'anthropic',
} as const;

describe('AuthPrecedenceResolver instance isolation', () => {
  it('keeps two resolvers for the same provider and runtime label independent', async () => {
    const first = createOAuthManager('token-from-first');
    const second = createOAuthManager('token-from-second');
    const settings = createSettingsService({ currentProfile: 'work' });
    const resolverA = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
      oauthManager: first.manager,
    });
    const resolverB = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
      oauthManager: second.manager,
    });
    const options = { includeOAuth: true, runtimeId: 'shared-runtime' };

    expect(await resolverA.resolveAuthentication(options)).toBe(
      'token-from-first',
    );
    expect(await resolverB.resolveAuthentication(options)).toBe(
      'token-from-second',
    );

    // Revoking the credential behind A is visible to A only.
    first.setToken(null);
    expect(await resolverA.resolveAuthentication(options)).toBeNull();
    expect(await resolverB.resolveAuthentication(options)).toBe(
      'token-from-second',
    );
  });

  it('does not leak a resolved token between resolvers or across resolutions', async () => {
    const oauth = createOAuthManager('token-1');
    const settings = createSettingsService();
    const resolverA = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
      oauthManager: oauth.manager,
    });
    const resolverB = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
    });
    const options = { includeOAuth: true, runtimeId: 'shared-runtime' };

    expect(await resolverA.resolveAuthentication(options)).toBe('token-1');
    // B has no OAuth manager, so it cannot see A's earlier resolution.
    expect(await resolverB.resolveAuthentication(options)).toBeNull();

    oauth.setToken('token-2');
    expect(await resolverA.resolveAuthentication(options)).toBe('token-2');
    expect(oauth.calls()).toBe(2);
  });

  it('reconfiguring one resolver leaves the other untouched', async () => {
    const first = createOAuthManager('token-from-first');
    const second = createOAuthManager('token-from-second');
    const replacement = createOAuthManager('replacement-token');
    const settings = createSettingsService();
    const resolverA = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
      oauthManager: first.manager,
    });
    const resolverB = new AuthPrecedenceResolver(OAUTH_CONFIG, {
      settingsService: settings,
      oauthManager: second.manager,
    });
    const options = { includeOAuth: true, runtimeId: 'shared-runtime' };

    resolverA.updateOAuthManager(replacement.manager);
    resolverA.updateConfig({ apiKey: 'a-only-api-key' });

    expect(await resolverA.resolveAuthentication(options)).toBe(
      'a-only-api-key',
    );
    expect(await resolverB.resolveAuthentication(options)).toBe(
      'token-from-second',
    );
    expect(replacement.calls()).toBe(0);
    expect(second.calls()).toBe(1);
  });
});
