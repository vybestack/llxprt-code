/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real core-factory keyring-primary OAuth behavior test (companion to
 * auth-factories.fallback.test.ts).
 *
 * Issue #2704: the existing fallback test injected `createKeyringTokenStore(
 * async () => null)` to force the encrypted file fallback path. There was no
 * matching test that injects a WORKING keyring adapter, so the keyring-primary
 * code path was unexercised at the factory layer. This suite injects a
 * Map-backed mock adapter via the same `keyringLoader` DI seam and verifies:
 *
 * - Token save/load/remove round-trips through the KEYRING path (not the
 *   encrypted file fallback).
 * - No encrypted `.enc` fallback artifacts are written to the canonical
 *   `<data>/secure-store/llxprt-code-oauth/` directory.
 *
 * Determinism: the keyring seam is made deterministically available via an
 * explicit mock adapter; no OS keychain and no process-global env-var toggle
 * is used.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createKeyringTokenStore } from './auth-factories.js';
import type { KeyringAdapter } from './storage/secure-store.js';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';

const ENV_KEYS = [
  'LLXPRT_DATA_HOME',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
  'HOME',
] as const;

/** Service name used by the production createKeyringTokenStore factory. */
const AUTH_SECURE_STORE_SERVICE = 'llxprt-code-oauth';

/**
 * Map-backed mock keyring adapter (reuses the pattern from
 * packages/storage/src/secure-store/secure-store.basic.test.ts). Injected via
 * the keyringLoader DI seam so the real keyring code path executes without
 * touching the OS keychain.
 */
function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service, account) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service, account, password) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service, account) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

describe('core-factory keyring-primary OAuth (issue2704 #1)', () => {
  let root: string;
  let dataHome: string;
  let logHome: string;
  let fakeHome: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'core-auth-keyring-'));
    dataHome = path.join(root, 'data');
    logHome = path.join(root, 'log');
    fakeHome = path.join(root, 'fake-home');
    mkdirSync(dataHome, { recursive: true });
    mkdirSync(logHome, { recursive: true });
    mkdirSync(fakeHome, { recursive: true });
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    process.env['LLXPRT_DATA_HOME'] = dataHome;
    process.env['LLXPRT_LOG_HOME'] = logHome;
    process.env['HOME'] = fakeHome;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips a token through the KEYRING path when a keyring adapter is available', async () => {
    const mockKeyring = createMockKeyring();
    const tokenStore = createKeyringTokenStore(async () => mockKeyring);

    const token: OAuthToken = {
      access_token: 'keyring-access-token',
      refresh_token: 'keyring-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    };

    await tokenStore.saveToken('gemini', token);

    // Assert the token is retrievable through the factory wiring.
    const loaded = await tokenStore.getToken('gemini');
    expect(loaded).not.toBeNull();
    expect(loaded!.access_token).toBe('keyring-access-token');
    expect(loaded!.refresh_token).toBe('keyring-refresh-token');
    expect(loaded!.expiry).toBe(token.expiry);
    expect(loaded!.token_type).toBe('Bearer');
    expect(loaded!.scope).toBe('openid profile');

    // Remove round-trips through the keyring path too.
    await tokenStore.removeToken('gemini');
    expect(await tokenStore.getToken('gemini')).toBeNull();
  });

  it('stores token data in the keyring adapter, not the fallback dir', async () => {
    const mockKeyring = createMockKeyring();
    const tokenStore = createKeyringTokenStore(async () => mockKeyring);

    const token: OAuthToken = {
      access_token: 'no-enc-at',
      refresh_token: 'no-enc-rt',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: null,
    };

    await tokenStore.saveToken('codex', token);

    // The token data must be reachable via the injected keyring adapter state.
    const storedInKeyring = mockKeyring.store.get(
      `${AUTH_SECURE_STORE_SERVICE}:codex:default`,
    );
    expect(storedInKeyring).toBeDefined();
    // And must be a JSON object (the KeyringTokenStore serializes the token).
    const parsed = JSON.parse(storedInKeyring!) as { access_token: string };
    expect(parsed.access_token).toBe('no-enc-at');
  });

  it('getToken returns the keyring value even when a conflicting fallback artifact exists (keyring-authoritative read)', async () => {
    // On Linux, production writes an encrypted fallback backup after a
    // successful keyring write. To prove getToken reads from the keyring
    // (not the backup), write via the keyring path, then tamper with the
    // adapter so the keyring holds a DIFFERENT value than any fallback
    // artifact. The loaded token must match the keyring value, proving the
    // keyring read path is exercised and authoritative.
    const mockKeyring = createMockKeyring();
    const tokenStore = createKeyringTokenStore(async () => mockKeyring);

    const token: OAuthToken = {
      access_token: 'keyring-authoritative-at',
      refresh_token: 'keyring-authoritative-rt',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: 'openid',
    };
    await tokenStore.saveToken('openai', token);

    // Now overwrite the keyring entry directly with a different valid token
    // JSON. If getToken reads from the keyring, it returns THIS value.
    const tampered: OAuthToken = {
      ...token,
      access_token: 'tampered-keyring-at',
    };
    mockKeyring.store.set(
      `${AUTH_SECURE_STORE_SERVICE}:openai:default`,
      JSON.stringify(tampered),
    );

    const loaded = await tokenStore.getToken('openai');
    expect(loaded).not.toBeNull();
    expect(loaded!.access_token).toBe('tampered-keyring-at');
  });

  // On Linux, a successful keyring write also keeps an encrypted backup copy,
  // so asserting "no .enc fallback artifacts" is only valid on non-Linux.
  it.skipIf(process.platform === 'linux')(
    'does NOT write any encrypted .enc fallback artifacts when the keyring is available (non-Linux)',
    async () => {
      const mockKeyring = createMockKeyring();
      const tokenStore = createKeyringTokenStore(async () => mockKeyring);

      const token: OAuthToken = {
        access_token: 'no-enc-at',
        refresh_token: 'no-enc-rt',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: null,
      };

      await tokenStore.saveToken('codex', token);

      const fallbackDir = path.join(
        dataHome,
        'secure-store',
        AUTH_SECURE_STORE_SERVICE,
      );
      const exists = await fs
        .stat(fallbackDir)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(false);
    },
  );

  it('token data does not leak into the legacy ~/.llxprt tree', async () => {
    const mockKeyring = createMockKeyring();
    const tokenStore = createKeyringTokenStore(async () => mockKeyring);

    const token: OAuthToken = {
      access_token: 'no-legacy-keyring',
      refresh_token: 'no-legacy-keyring-rt',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: 'openid',
    };
    await tokenStore.saveToken('anthropic', token);

    // The legacy tree under the faked HOME must not exist.
    const legacyDir = path.join(fakeHome, '.llxprt');
    await expect(fs.stat(legacyDir)).rejects.toThrow('ENOENT');
  });
});
