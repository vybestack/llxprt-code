/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageBus } from '@vybestack/llxprt-code-core';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import { ProxyTokenStore } from '@vybestack/llxprt-code-auth/proxy/proxy-token-store.js';
import {
  InMemoryTokenStore,
  makeToken,
} from '../auth/proxy/__tests__/credential-proxy-server-helpers.js';
import {
  createOwnerOAuthManager,
  createSessionAuthPolicyReader,
  createOAuthProfileReads,
  createOwnedTokenStoreClose,
  createOwnerAuthCacheInvalidator,
} from './index.js';

const oauthSettings: IOAuthSettingsProvider = {
  isOAuthEnabled: () => true,
  getProviderApiKey: () => undefined,
  getProviderKeyfile: () => undefined,
  getProviderBaseUrl: () => undefined,
  getOAuthEnabledProviders: () => ({ codex: true, claudecode: true }),
  setOAuthEnabled: () => {},
};

describe('owner OAuth construction primitives', () => {
  it('reads live policy from the exact settings owner with strict boolean and URL normalization', () => {
    const settings = new SettingsService();
    const read = createSessionAuthPolicyReader(settings);
    settings.setCurrentProfileName('first');
    settings.set('base-url', 42);
    settings.set('auth.noBrowser', 'true');
    settings.set('authOnly', true);
    expect(read()).toMatchObject({
      profileName: 'first',
      baseUrl: undefined,
      noBrowser: false,
      authOnly: true,
    });
    settings.setCurrentProfileName('second');
    settings.set('base-url', 'https://owner.example');
    settings.set('auth.noBrowser', true);
    settings.set('auth-bucket-prompt', false);
    settings.set('auth-bucket-delay', 17);
    settings.set('auth.interactiveTimeoutMs', 1500);
    expect(read()).toStrictEqual({
      profileName: 'second',
      baseUrl: 'https://owner.example',
      bucketPrompt: false,
      bucketDelay: 17,
      interactiveTimeoutMs: 1500,
      noBrowser: true,
      authOnly: true,
    });
  });

  it('loads profiles lazily from the captured directory and observes subsequent file changes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'owner-profiles-'));
    const profileDirectory = join(directory, 'profiles');
    const reads = createOAuthProfileReads(profileDirectory);
    try {
      expect(existsSync(profileDirectory)).toBe(false);
      const profiles = new ProfileManager(profileDirectory);
      await profiles.saveProfile('owner', {
        version: 1,
        provider: 'codex',
        model: 'first',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(await reads.loadProfile('owner')).toMatchObject({
        model: 'first',
      });
      await profiles.saveProfile('owner', {
        version: 1,
        provider: 'codex',
        model: 'second',
        modelParams: {},
        ephemeralSettings: {},
      });
      expect(await reads.loadProfile('owner')).toMatchObject({
        model: 'second',
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('constructs one OAuth owner with the supplied bus and live policy without owning its token store', async () => {
    const tokens = new InMemoryTokenStore();
    const settings = new SettingsService();
    const bus = new MessageBus();
    const manager = createOwnerOAuthManager(
      tokens,
      oauthSettings,
      bus,
      createOAuthProfileReads(undefined),
      createSessionAuthPolicyReader(settings),
      () => ({ runtimeId: 'owner', runtimeKind: 'agent' }),
      undefined,
      () => {},
      async () => {
        throw new Error('Unexpected network request');
      },
    );
    try {
      expect(manager.runtimeMessageBus).toBe(bus);
      expect(manager.getProvider('codex')?.name).toBe('codex');
      expect(manager.getProvider('claudecode')?.name).toBe('claudecode');
      settings.set('auth.noBrowser', true);
      expect(manager.isBrowserDisabled()).toBe(true);
      await manager.dispose();
      await tokens.saveToken('after-close', makeToken());
      expect(await tokens.getToken('after-close')).toMatchObject({
        token_type: 'Bearer',
      });
    } finally {
      await manager.dispose();
    }
  });

  it('retires an owned proxy transport once even when close is requested repeatedly', () => {
    class CloseCountingStore extends ProxyTokenStore {
      closeCount = 0;
      override getClient(): ReturnType<ProxyTokenStore['getClient']> {
        const client = super.getClient();
        return Object.assign(client, {
          close: () => {
            this.closeCount += 1;
          },
        });
      }
    }
    const store = new CloseCountingStore('/unconnected-owner.sock');
    const close = createOwnedTokenStoreClose(store);
    close();
    close();
    expect(store.closeCount).toBe(1);
  });

  it('invalidates only the currently resolved provider cache for the requested owner', () => {
    const first = new Map([['token', 'first']]);
    const second = new Map([['token', 'second']]);
    let selected = { name: 'codex', clearAuthCache: () => first.clear() };
    const invalidate = createOwnerAuthCacheInvalidator((name) =>
      name === 'codex' ? selected : undefined,
    );
    invalidate('missing');
    expect(first.size).toBe(1);
    invalidate('codex');
    selected = { name: 'codex', clearAuthCache: () => second.clear() };
    invalidate('codex');
    expect([first.size, second.size]).toStrictEqual([0, 0]);
  });
});
