/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from './secure-store.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SecureStore — Keyring Write Verification and Fallback Policy', () => {
  let tempDir: string;
  let store: SecureStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper: checks whether a fallback .enc file exists for the given key
   * in the tempDir.
   */
  async function fallbackFileExists(key: string): Promise<boolean> {
    const fallbackFile = path.join(tempDir, `${key}.enc`);
    return fs.access(fallbackFile).then(
      () => true,
      () => false,
    );
  }

  describe('Issue #2556: No fallback after successful, verified keyring write', () => {
    it('should NOT write a fallback file when keyring write succeeds and read-back verifies (verified write)', async () => {
      const stored: Record<string, string> = {};
      const mockKeyring: KeyringAdapter = {
        getPassword: async (_service, account) => stored[account] ?? null,
        setPassword: async (_service, account, password) => {
          stored[account] = password;
        },
        deletePassword: async (_service, account) => delete stored[account],
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      await store.set('verified-key', 'secret-value');

      // A successful + verified keyring write must NOT create a fallback file.
      expect(await fallbackFileExists('verified-key')).toBe(false);

      // The keyring holds the value.
      expect(await store.get('verified-key')).toBe('secret-value');
    });

    it('should clean up a stale fallback file after a verified keyring write', async () => {
      // Pre-seed a stale fallback file from a prior (unverified) write.
      const staleStore = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => null,
      });
      await staleStore.set('stale-key', 'old-value');
      expect(await fallbackFileExists('stale-key')).toBe(true);

      // Now write the same key with a working keyring that verifies read-back.
      const stored: Record<string, string> = {};
      const mockKeyring: KeyringAdapter = {
        getPassword: async (_service, account) => stored[account] ?? null,
        setPassword: async (_service, account, password) => {
          stored[account] = password;
        },
        deletePassword: async (_service, account) => delete stored[account],
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      await store.set('stale-key', 'new-value');

      // The stale fallback must be removed after a verified keyring write.
      expect(await fallbackFileExists('stale-key')).toBe(false);
      expect(await store.get('stale-key')).toBe('new-value');
    });

    it.skipIf(process.platform === 'win32')(
      'should clean up both current and legacy fallback paths after a verified OAuth write',
      async () => {
        const key = 'oauth:default';
        const staleStore = new SecureStore('test-service', {
          fallbackDir: tempDir,
          lockDir: path.join(tempDir, 'locks'),
          fallbackPolicy: 'allow',
          keyringLoader: async () => null,
        });
        await staleStore.set(key, 'old-value');
        const currentPath = path.join(tempDir, 'oauth%3Adefault.enc');
        const legacyPath = path.join(tempDir, 'oauth:default.enc');
        await fs.rename(currentPath, legacyPath);

        const stored: Record<string, string> = {};
        const mockKeyring: KeyringAdapter = {
          getPassword: async (_service, account) => stored[account] ?? null,
          setPassword: async (_service, account, password) => {
            stored[account] = password;
          },
          deletePassword: async (_service, account) => delete stored[account],
        };
        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          lockDir: path.join(tempDir, 'locks'),
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set(key, 'new-value');
        await expect(fs.access(currentPath)).rejects.toThrow('ENOENT');
        await expect(fs.access(legacyPath)).rejects.toThrow('ENOENT');
        expect(await store.get(key)).toBe('new-value');
      },
    );

    it.runIf(process.platform === 'win32')(
      'should clean up the current fallback path after a verified OAuth write on Windows',
      async () => {
        const key = 'oauth:default';
        const staleStore = new SecureStore('test-service', {
          fallbackDir: tempDir,
          lockDir: path.join(tempDir, 'locks'),
          fallbackPolicy: 'allow',
          keyringLoader: async () => null,
        });
        await staleStore.set(key, 'old-value');
        const currentPath = path.join(tempDir, 'oauth%3Adefault.enc');

        const stored: Record<string, string> = {};
        const mockKeyring: KeyringAdapter = {
          getPassword: async (_service, account) => stored[account] ?? null,
          setPassword: async (_service, account, password) => {
            stored[account] = password;
          },
          deletePassword: async (_service, account) => delete stored[account],
        };
        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          lockDir: path.join(tempDir, 'locks'),
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set(key, 'new-value');
        await expect(fs.access(currentPath)).rejects.toThrow('ENOENT');
        expect(await store.get(key)).toBe('new-value');
      },
    );
  });

  describe('Issue #1895 fallback safety: keyring write succeeds but read-back fails', () => {
    it('should write a fallback file when keyring accepts write but read-back returns null', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          /* accepts but does not actually persist */
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      await store.set('unreliable-key', 'my-secret');

      // Read-back failed — fallback must be written so the credential survives.
      expect(await fallbackFileExists('unreliable-key')).toBe(true);

      // The credential must be recoverable via the fallback.
      expect(await store.get('unreliable-key')).toBe('my-secret');
    });

    it('should reject with CONFLICT (non-destructive) when keyring read-back returns a foreign value', async () => {
      // A foreign value on read-back means another process owns the keychain
      // item. The new behavior (issue #2927) is non-destructive: the foreign
      // value is left untouched, no fallback is written, and CONFLICT is
      // thrown so the caller knows its write lost the race.
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => 'foreign-winner-value',
        setPassword: async () => {
          /* accepts but does not replace the foreign value */
        },
        deletePassword: async () => true,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store
        .set('mismatch-key', 'correct-value')
        .catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('CONFLICT');
      // No fallback file — the write lost the race.
      expect(await fallbackFileExists('mismatch-key')).toBe(false);
    });

    it('should throw CONFLICT when keyring read-back returns a foreign value and fallbackPolicy is deny', async () => {
      // On the deny path, a foreign value is still non-destructive: the
      // foreign value is left untouched and CONFLICT is thrown.
      let keyringValue: string | null = 'foreign-winner-value';
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => keyringValue,
        setPassword: async () => {
          /* accepts but does not replace the foreign value */
        },
        deletePassword: async () => {
          keyringValue = null;
          return true;
        },
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'deny',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store
        .set('stale-denied-key', 'correct-value')
        .catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('CONFLICT');
      expect(await fallbackFileExists('stale-denied-key')).toBe(false);
      // The foreign value must NOT be cleared — non-destructive.
      expect(keyringValue).not.toBeNull();
    });

    it('should reject with CONFLICT (non-destructive) when the foreign value cannot be deleted', async () => {
      // Even when deletePassword returns false, the new behavior is
      // non-destructive: the foreign value is detected as a conflict and
      // CONFLICT is thrown without writing a fallback or attempting a clear.
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => 'foreign-winner-value',
        setPassword: async () => {
          /* accepts but does not replace the foreign value */
        },
        deletePassword: async () => false,
      };
      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store
        .set('stuck-key', 'correct-value')
        .catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('CONFLICT');
      // No fallback artifact should be left on disk.
      expect(await fallbackFileExists('stuck-key')).toBe(false);
    });

    it('should reject with CONFLICT (non-destructive) when deletePassword throws', async () => {
      // The CONFLICT path never calls deletePassword. If it ever did, this
      // adapter throws so the test fails loudly.
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => 'foreign-winner-value',
        setPassword: async () => {
          /* accepts but does not replace the foreign value */
        },
        deletePassword: async () => {
          throw new Error('keyring delete error');
        },
      };
      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store
        .set('throw-delete-key', 'correct-value')
        .catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('CONFLICT');
      expect(await fallbackFileExists('throw-delete-key')).toBe(false);
    });
    it('should recover from fallback when keyring read-back throws', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => {
          throw new Error('keyring read error');
        },
        setPassword: async () => {
          /* accepts write */
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });
      await store.set('throw-key', 'my-value');

      const freshStore = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });
      expect(await fallbackFileExists('throw-key')).toBe(true);
      expect(await freshStore.get('throw-key')).toBe('my-value');
    });
  });

  describe('fallbackPolicy semantics', () => {
    it('should write fallback when policy is allow and keyring is unavailable', async () => {
      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => null,
      });

      await store.set('fallback-key', 'fallback-secret');

      expect(await fallbackFileExists('fallback-key')).toBe(true);
      expect(await store.get('fallback-key')).toBe('fallback-secret');
    });

    it('should NOT write fallback and throw UNAVAILABLE when fallbackPolicy is deny and no keyring adapter is available', async () => {
      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'deny',
        keyringLoader: async () => null,
      });

      const error = await store.set('denied-key', 'secret').catch((err) => err);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.message).toBe(
        'Keyring is unavailable and fallback is denied',
      );
      expect(error.code).toBe('UNAVAILABLE');
      expect(error.remediation).toContain('allow encrypted fallback storage');

      expect(await fallbackFileExists('denied-key')).toBe(false);
    });

    it('should preserve the classified keyring error when fallbackPolicy is deny', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          throw new Error('Keyring locked');
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'deny',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store.set('locked-key', 'secret').catch((err) => err);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.message).toBe('Keyring locked');
      expect(error.code).toBe('LOCKED');
      expect(error.remediation).toBe('Unlock your keyring');

      expect(await fallbackFileExists('locked-key')).toBe(false);
    });

    it('should reject when an unverified keyring write cannot be backed by fallback', async () => {
      const blockedFallbackDir = path.join(tempDir, 'not-a-directory');
      await fs.writeFile(blockedFallbackDir, 'blocks mkdir');
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          /* accepts but does not persist */
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: blockedFallbackDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      // A blocked fallback directory must cause set() to reject. The
      // filesystem error propagates so the caller knows the credential
      // could not be stored.
      await expect(
        store.set('unverified-key', 'my-secret'),
      ).rejects.toThrowError(Error);
      expect(await fallbackFileExists('unverified-key')).toBe(false);
    });

    it('should reject an unverified keyring write when fallbackPolicy is deny', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          /* accepts but does not persist */
        },
        deletePassword: async () => false,
      };
      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'deny',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store
        .set('unverified-denied', 'secret')
        .catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('UNAVAILABLE');
      expect(await fallbackFileExists('unverified-denied')).toBe(false);
    });
  });

  describe('keyring-first read preference (unchanged)', () => {
    it('should prefer keyring value over fallback when both exist', async () => {
      const stored: Record<string, string> = {};
      const mockKeyring: KeyringAdapter = {
        getPassword: async (_service, account) => stored[account] ?? null,
        setPassword: async (_service, account, password) => {
          stored[account] = password;
        },
        deletePassword: async (_service, account) => delete stored[account],
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      // Seed a fallback-only value first (keyring absent).
      const fallbackStore = new SecureStore('test-service', {
        fallbackDir: tempDir,
        lockDir: path.join(tempDir, 'locks'),
        fallbackPolicy: 'allow',
        keyringLoader: async () => null,
      });
      await fallbackStore.set('shared-key', 'fallback-value');

      // Now put a different value in the keyring.
      stored['shared-key'] = 'keyring-value';

      const retrieved = await store.get('shared-key');
      expect(retrieved).toBe('keyring-value');
    });
  });
});
