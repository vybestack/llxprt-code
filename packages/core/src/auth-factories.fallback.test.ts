/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Real core-factory encrypted OAuth fallback behavior test.
 *
 * Contract under test (issue2606):
 * - When the OS keyring is unavailable, the production-wired KeyringTokenStore
 *   (SecureStore service `llxprt-code-oauth`, fallbackPolicy `allow`) saves
 *   tokens to an ENCRYPTED envelope under the canonical
 *   `<data>/secure-store/llxprt-code-oauth/` directory.
 * - No credentials are written under the legacy `~/.llxprt` tree.
 * - The saved token round-trips through load.
 *
 * Determinism: the keyring seam is made deterministically unavailable via an
 * explicit `keyringLoader: async () => null`, mirroring how the production
 * factory constructs its SecureStore. This exercises the real SecureStore +
 * KeyringTokenStore wiring (the "core-factory" composition) without modifying
 * production code and without test-only global env hacks. Production
 * keyring-primary behavior is unchanged: when a keyring IS available it is
 * tried first; here it is simply absent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createKeyringTokenStore } from './auth-factories.js';
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

describe('core-factory encrypted OAuth fallback (issue2606 #10)', () => {
  let root: string;
  let dataHome: string;
  let logHome: string;
  let fakeHome: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'core-auth-fallback-'));
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

  it('saves an encrypted fallback envelope under canonical <data>/secure-store/llxprt-code-oauth and round-trips the token', async () => {
    // Exercise the PRODUCTION factory composition (createKeyringTokenStore),
    // injecting a deterministically-unavailable keyring (returns null) to force
    // the encrypted file fallback path. The factory wires SecureStore
    // (service `llxprt-code-oauth`, fallbackPolicy `allow`) + Storage locks +
    // DebugLogger exactly as production does; only the keyring seam is faked.
    const tokenStore = createKeyringTokenStore(async () => null);

    const token: OAuthToken = {
      access_token: 'fallback-access-token',
      refresh_token: 'fallback-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: 'openid profile',
    };

    await tokenStore.saveToken('gemini', token);

    // The canonical fallback directory resolves through Storage under the
    // LLXPRT_DATA_HOME override set above.
    const expectedDir = path.join(
      dataHome,
      'secure-store',
      AUTH_SECURE_STORE_SERVICE,
    );
    const entries = await fs.readdir(expectedDir);
    // At least one encrypted envelope file must exist.
    expect(entries.some((f) => f.endsWith('.enc'))).toBe(true);

    // Read the envelope and assert it is an encrypted envelope (not plaintext)
    // with a recognized version field. The access token must NOT appear in
    // cleartext inside the file.
    const encFile = entries.find((f) => f.endsWith('.enc'))!;
    const raw = await fs.readFile(path.join(expectedDir, encFile), 'utf8');
    const envelope = JSON.parse(raw);
    expect(typeof envelope.v).toBe('number');
    expect(envelope.crypto).toBeDefined();
    expect(raw).not.toContain('fallback-access-token');

    // Round-trip: load through the same token store returns the saved token.
    // Assert ALL token fields (not just access/refresh) so a serialization bug
    // that drops expiry/token_type/scope is caught.
    const loaded = await tokenStore.getToken('gemini');
    expect(loaded).not.toBeNull();
    expect(loaded!.access_token).toBe('fallback-access-token');
    expect(loaded!.refresh_token).toBe('fallback-refresh-token');
    expect(loaded!.expiry).toBe(token.expiry);
    expect(loaded!.token_type).toBe('Bearer');
    expect(loaded!.scope).toBe('openid profile');
  });

  it('does not write any credentials under the legacy ~/.llxprt tree', async () => {
    const tokenStore = createKeyringTokenStore(async () => null);

    const token: OAuthToken = {
      access_token: 'no-legacy-write-at',
      refresh_token: 'no-legacy-write-rt',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: null,
    };
    await tokenStore.saveToken('codex', token);
    // Acquire/release a lock to exercise the lock path too, and assert the
    // lock is actually acquired (file exists during acquisition) rather than
    // passing solely on the absence of exceptions.
    const acquired = await tokenStore.acquireRefreshLock('codex', {
      waitMs: 1000,
    });
    expect(acquired).toBe(true);
    const lockFile = path.join(logHome, 'oauth', 'locks', 'codex-refresh.lock');
    expect((await fs.stat(lockFile)).isFile()).toBe(true);
    await tokenStore.releaseRefreshLock('codex');

    // The legacy tree under the faked HOME must not exist at all.
    const legacyDir = path.join(fakeHome, '.llxprt');
    await expect(fs.stat(legacyDir)).rejects.toThrow('ENOENT');
  });
});
