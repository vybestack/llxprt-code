/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3965: the native keyring binding turns backend read errors into
 * `null`, which is indistinguishable from an absent credential. A valid
 * credential that is still present must survive a bounded number of transient
 * null reads, while genuine absence, deletion, and fatal keyring errors keep
 * their existing semantics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  resetOsKeyringSessionForTesting,
  type KeyringAdapter,
} from './secure-store.js';

interface FlakyKeyring extends KeyringAdapter {
  /** Makes the next `count` getPassword calls report null. */
  injectNullReads(count: number): void;
  /** Makes every getPassword call report null from now on. */
  alwaysReadNull(): void;
  /** Makes the next getPassword call throw. */
  failNextRead(error: Error): void;
  readonly readCount: () => number;
}

function createFlakyKeyring(): FlakyKeyring {
  const entries = new Map<string, string>();
  let pendingNulls = 0;
  let nullForever = false;
  let pendingFailure: Error | null = null;
  let reads = 0;
  return {
    injectNullReads: (count) => {
      pendingNulls = count;
    },
    alwaysReadNull: () => {
      nullForever = true;
    },
    failNextRead: (error) => {
      pendingFailure = error;
    },
    readCount: () => reads,
    getPassword: async (service, account) => {
      reads += 1;
      if (pendingFailure !== null) {
        const failure = pendingFailure;
        pendingFailure = null;
        throw failure;
      }
      if (nullForever) return null;
      if (pendingNulls > 0) {
        pendingNulls -= 1;
        return null;
      }
      return entries.get(`${service}:${account}`) ?? null;
    },
    setPassword: async (service, account, password) => {
      entries.set(`${service}:${account}`, password);
    },
    deletePassword: async (service, account) =>
      entries.delete(`${service}:${account}`),
  };
}

const SERVICE = 'issue3965-transient-null';
const KEY = 'codex:default';
const NO_MACHINE_SECRET = async (): Promise<Buffer | null> => null;

function createStore(
  fallbackDir: string,
  keyring: KeyringAdapter | null,
): SecureStore {
  return new SecureStore(SERVICE, {
    fallbackDir,
    lockDir: path.join(fallbackDir, 'locks'),
    keyringLoader: async () => keyring,
    fallbackPolicy: 'allow',
    machineSecretLoader: NO_MACHINE_SECRET,
  });
}

describe('SecureStore transient keyring null reads (issue #3965)', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-3965-'));
  });
  afterEach(async () => {
    resetOsKeyringSessionForTesting();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const tempDir = (): string => dir;

  describe('get()', () => {
    it('returns the stored value with a single keyring read when the keyring answers', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');
      const readsBefore = keyring.readCount();

      const value = await store.get(KEY);

      expect(value).toBe('token-v1');
      expect(keyring.readCount() - readsBefore).toBe(1);
    });

    it('recovers the value after one transient null read', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');

      keyring.injectNullReads(1);

      expect(await store.get(KEY)).toBe('token-v1');
    });

    it('recovers the value after consecutive transient null reads', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');

      keyring.injectNullReads(2);

      expect(await store.get(KEY)).toBe('token-v1');
    });

    it('returns null for a genuinely absent key after a bounded number of reads', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);

      const value = await store.get(KEY);

      expect(value).toBeNull();
      expect(keyring.readCount()).toBeLessThanOrEqual(3);
    });

    it('stops reading a keyring that keeps reporting null', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');
      const readsBefore = keyring.readCount();
      keyring.alwaysReadNull();

      const value = await store.get(KEY);

      expect(value).toBeNull();
      expect(keyring.readCount() - readsBefore).toBeLessThanOrEqual(3);
    });

    it('prefers the keyring value over an obsolete fallback file when the first read is a transient null', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'current-from-keyring');
      // A verified keyring write removes stale fallback files, so seed the
      // obsolete one afterwards to model a leftover from an earlier outage.
      await createStore(tempDir(), null).set(KEY, 'obsolete-from-fallback');

      keyring.injectNullReads(1);

      expect(await store.get(KEY)).toBe('current-from-keyring');
    });

    it('still serves the fallback file when the keyring genuinely lacks the key', async () => {
      const keyring = createFlakyKeyring();
      const fallbackOnly = createStore(tempDir(), null);
      await fallbackOnly.set(KEY, 'fallback-value');
      const store = createStore(tempDir(), keyring);

      expect(await store.get(KEY)).toBe('fallback-value');
    });

    it('serves the fallback file when no keyring is available', async () => {
      const store = createStore(tempDir(), null);
      await store.set(KEY, 'fallback-value');

      expect(await store.get(KEY)).toBe('fallback-value');
    });

    it('does not resurrect a deleted credential through retries', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');
      await store.delete(KEY);

      keyring.injectNullReads(1);

      expect(await store.get(KEY)).toBeNull();
      expect(await store.has(KEY)).toBe(false);
    });

    it('does not retry a fatal keyring error', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');
      const readsBefore = keyring.readCount();
      keyring.failNextRead(
        new SecureStoreError('keyring entry unreadable', 'CORRUPT', 're-save'),
      );

      const failure = await store.get(KEY).then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(SecureStoreError);
      expect(keyring.readCount() - readsBefore).toBe(1);
    });

    it('does not retry a non-null value, even when it is not a valid credential', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, '{not-json');
      const readsBefore = keyring.readCount();

      const value = await store.get(KEY);

      expect(value).toBe('{not-json');
      expect(keyring.readCount() - readsBefore).toBe(1);
    });
  });

  describe('has()', () => {
    it('reports a present credential after one transient null read', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);
      await store.set(KEY, 'token-v1');

      keyring.injectNullReads(1);

      expect(await store.has(KEY)).toBe(true);
    });

    it('reports a genuinely absent credential as missing', async () => {
      const keyring = createFlakyKeyring();
      const store = createStore(tempDir(), keyring);

      expect(await store.has(KEY)).toBe(false);
    });
  });
});
