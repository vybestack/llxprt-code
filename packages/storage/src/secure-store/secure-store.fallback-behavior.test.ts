/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isValidEnvelope } from './envelope.js';
import { SecureStore, SecureStoreError } from './secure-store.js';

const MACHINE_SECRET = Buffer.alloc(32, 0x21);

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

describe('SecureStore encrypted-file fallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'secure-store-fallback-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStore(service = 'fallback-behavior-test'): SecureStore {
    return new SecureStore(service, {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      lockDir: path.join(tempDir, 'locks'),
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => MACHINE_SECRET,
    });
  }

  it('writes the public v2 encrypted envelope format', async () => {
    const store = createStore();
    await store.set('my-key', 'my-value');

    const content = await fs.readFile(path.join(tempDir, 'my-key.enc'), 'utf8');
    const envelope: unknown = JSON.parse(content);

    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({
      v: 2,
      crypto: {
        alg: 'aes-256-gcm',
        kdf: 'scrypt',
        N: 16384,
        r: 8,
        p: 1,
        saltLen: 16,
      },
    });
    expect(content).not.toContain('my-value');
  });

  it('gets a stored value', async () => {
    const store = createStore();
    await store.set('roundtrip-key', 'roundtrip-value');

    expect(await store.get('roundtrip-key')).toBe('roundtrip-value');
  });

  it('returns null for a missing value', async () => {
    expect(await createStore().get('missing')).toBeNull();
  });

  it('reports whether a value exists', async () => {
    const store = createStore();
    expect(await store.has('has-key')).toBe(false);

    await store.set('has-key', 'has-value');

    expect(await store.has('has-key')).toBe(true);
  });

  it('lists stored values', async () => {
    const store = createStore();
    await store.set('gamma', 'val-c');
    await store.set('alpha', 'val-a');
    await store.set('beta', 'val-b');

    expect(await store.list()).toStrictEqual(['alpha', 'beta', 'gamma']);
  });

  it('deletes a stored value and its file', async () => {
    const store = createStore();
    const filePath = path.join(tempDir, 'delete-me.enc');
    await store.set('delete-me', 'delete-value');

    expect(await store.delete('delete-me')).toBe(true);
    const accessError = await fs
      .access(filePath)
      .catch((error: unknown) => error);
    expect(isFileSystemError(accessError) && accessError.code).toBe('ENOENT');
    expect(await store.get('delete-me')).toBeNull();
  });

  it('persists values across SecureStore instances', async () => {
    const service = 'fallback-persistence-test';
    await createStore(service).set('persistent-key', 'persistent-value');

    expect(await createStore(service).get('persistent-key')).toBe(
      'persistent-value',
    );
  });

  it('throws UNAVAILABLE without writing a file when fallback is denied', async () => {
    const store = new SecureStore('fallback-deny-test', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      lockDir: path.join(tempDir, 'locks'),
      fallbackPolicy: 'deny',
    });

    await expect(store.set('should-fail', 'value')).rejects.toMatchObject<
      Partial<SecureStoreError>
    >({ code: 'UNAVAILABLE' });
    // No fallback file should be written — only the lock directory may exist.
    const entries = await fs.readdir(tempDir);
    expect(entries.filter((e) => e.endsWith('.enc'))).toHaveLength(0);
  });

  it('reports the keyring as unavailable when no adapter is loaded', async () => {
    expect(await createStore().isKeychainAvailable()).toBe(false);
  });
});
