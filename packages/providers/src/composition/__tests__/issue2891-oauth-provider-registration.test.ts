/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type {
  OAuthUICallback,
  OAuthUIEvent,
} from '@vybestack/llxprt-code-auth';
import {
  OAuthError,
  OAuthErrorType,
} from '@vybestack/llxprt-code-auth/oauth-errors.js';
import {
  OAuthManager,
  AnthropicOAuthProvider,
  CodexOAuthProvider,
  HostCredentialOwner,
} from '../../auth/index.js';
import {
  ensureOAuthProviderRegistered,
  isOAuthProviderRegistered,
} from '../oauth-provider-registration.js';

function captureAuthorization(events: OAuthUIEvent[]): OAuthUICallback {
  return (event) => {
    events.push(event);
    throw new OAuthError(
      OAuthErrorType.USER_CANCELLED,
      'claudecode',
      'Authorization captured',
    );
  };
}

describe('OAuth registration ownership (#2891, #2616)', () => {
  it('recognizes directly registered providers before composition registration', () => {
    const manager = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    manager.registerProvider(
      new AnthropicOAuthProvider(globalThis.fetch, manager.getTokenStore()),
    );

    expect(isOAuthProviderRegistered('claudecode', manager)).toBe(true);
  });

  it.each([AnthropicOAuthProvider, CodexOAuthProvider])(
    'preserves directly registered %p identity across repeated registration',
    (Provider) => {
      const manager = new OAuthManager(
        new HostCredentialOwner(process.env).authority.createTokenStore(),
      );
      const provider = new Provider(globalThis.fetch, manager.getTokenStore());
      manager.registerProvider(provider);

      ensureOAuthProviderRegistered(provider.name, manager, globalThis.fetch);
      ensureOAuthProviderRegistered(provider.name, manager, globalThis.fetch);

      expect(manager.getProvider(provider.name)).toBe(provider);
    },
  );

  it('keeps two managers independent', () => {
    const first = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    const second = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    for (const name of ['claudecode', 'codex']) {
      ensureOAuthProviderRegistered(name, first, globalThis.fetch);
      expect(isOAuthProviderRegistered(name, second)).toBe(false);
      expect(first.getProvider(name)).toBeDefined();
      ensureOAuthProviderRegistered(name, second, globalThis.fetch);
      expect(second.getProvider(name)).toBeDefined();
      expect(second.getProvider(name)).not.toBe(first.getProvider(name));
    }
  });

  it.each([
    { direct: false, initiallyAttached: false },
    { direct: false, initiallyAttached: true },
    { direct: true, initiallyAttached: false },
    { direct: true, initiallyAttached: true },
  ])(
    'routes a later callback only to its manager (%j)',
    async ({ direct, initiallyAttached }) => {
      const first = new OAuthManager(
        new HostCredentialOwner(process.env).authority.createTokenStore(),
      );
      const second = new OAuthManager(
        new HostCredentialOwner(process.env).authority.createTokenStore(),
      );
      const originalEvents: OAuthUIEvent[] = [];
      const firstEvents: OAuthUIEvent[] = [];
      const secondEvents: OAuthUIEvent[] = [];
      if (direct) {
        first.registerProvider(
          new AnthropicOAuthProvider(
            globalThis.fetch,
            first.getTokenStore(),
            initiallyAttached
              ? captureAuthorization(originalEvents)
              : undefined,
          ),
        );
      } else {
        ensureOAuthProviderRegistered(
          'claudecode',
          first,
          globalThis.fetch,
          undefined,
          initiallyAttached ? captureAuthorization(originalEvents) : undefined,
        );
      }
      ensureOAuthProviderRegistered(
        'claudecode',
        second,
        globalThis.fetch,
        undefined,
        captureAuthorization(secondEvents),
      );
      const original = first.getProvider('claudecode');
      ensureOAuthProviderRegistered(
        'claudecode',
        first,
        globalThis.fetch,
        undefined,
        captureAuthorization(firstEvents),
      );
      const firstProvider = first.getProvider('claudecode');
      const secondProvider = second.getProvider('claudecode');
      if (!firstProvider || !secondProvider)
        throw new Error('Missing registered providers');

      await expect(firstProvider.initiateAuth()).rejects.toThrow(
        'Authorization captured',
      );
      expect(secondEvents).toHaveLength(0);
      await expect(secondProvider.initiateAuth()).rejects.toThrow(
        'Authorization captured',
      );

      expect(firstProvider).toBe(original);
      expect(originalEvents).toHaveLength(0);
      expect(firstEvents).toHaveLength(1);
      expect(secondEvents).toHaveLength(1);
      for (const event of [...firstEvents, ...secondEvents]) {
        expect(event.type).toBe('oauth_url');
        expect(event.text).toContain('code_challenge=');
      }
    },
  );

  it('registers using the manager token store when none is passed', () => {
    const manager = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    ensureOAuthProviderRegistered('claudecode', manager, globalThis.fetch);
    expect(manager.getProvider('claudecode')).toBeInstanceOf(
      AnthropicOAuthProvider,
    );
  });

  it('skips registration without a reachable token store, then permits an explicit store', () => {
    const manager = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    const registration = {
      registerProvider: manager.registerProvider.bind(manager),
      getProvider: manager.getProvider.bind(manager),
    };
    ensureOAuthProviderRegistered('claudecode', registration, globalThis.fetch);
    expect(manager.getSupportedProviders()).toStrictEqual([]);
    expect(isOAuthProviderRegistered('claudecode', registration)).toBe(false);

    ensureOAuthProviderRegistered(
      'claudecode',
      registration,
      globalThis.fetch,
      manager.getTokenStore(),
    );
    expect(manager.getProvider('claudecode')).toBeInstanceOf(
      AnthropicOAuthProvider,
    );
  });

  it('leaves unsupported provider names unregistered', () => {
    const manager = new OAuthManager(
      new HostCredentialOwner(process.env).authority.createTokenStore(),
    );
    ensureOAuthProviderRegistered('not-a-provider', manager, globalThis.fetch);
    expect(isOAuthProviderRegistered('not-a-provider', manager)).toBe(false);
    expect(manager.getSupportedProviders()).toStrictEqual([]);
  });
});
