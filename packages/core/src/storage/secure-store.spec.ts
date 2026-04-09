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

describe('SecureStore - Linux Keyring Fallback Reliability', () => {
  let tempDir: string;
  let store: SecureStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Issue #1895: Keyring write succeeds but later reads fail', () => {
    it('should read from fallback when keyring returns null after successful write on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });

      try {
        let keyringValue: string | null = null;
        let shouldDropReadback = false;

        const mockKeyring: KeyringAdapter = {
          getPassword: async () => (shouldDropReadback ? null : keyringValue),
          setPassword: async (_service, _account, password) => {
            keyringValue = password;
          },
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set('test-key', 'secret-value');
        shouldDropReadback = true;
        keyringValue = null;

        const retrieved = await store.get('test-key');
        expect(retrieved).toBe('secret-value');
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });

    it('should persist fallback file even when keyring write succeeds on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });

      try {
        const mockKeyring: KeyringAdapter = {
          getPassword: async () => null,
          setPassword: async () => {
            /* succeeds */
          },
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set('persisted-key', 'my-secret');

        const fallbackFile = path.join(tempDir, 'persisted-key.enc');
        const fileExists = await fs
          .access(fallbackFile)
          .then(() => true)
          .catch(() => false);
        expect(fileExists).toBe(true);

        const retrieved = await store.get('persisted-key');
        expect(retrieved).toBe('my-secret');
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });

    it('should skip fallback file writes after keyring success on non-Linux platforms', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'darwin',
      });

      try {
        const mockKeyring: KeyringAdapter = {
          getPassword: async () => 'keyring-secret',
          setPassword: async () => {
            /* succeeds */
          },
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set('non-linux-key', 'my-secret');

        const fallbackFile = path.join(tempDir, 'non-linux-key.enc');
        const fileExists = await fs
          .access(fallbackFile)
          .then(() => true)
          .catch(() => false);

        expect(fileExists).toBe(false);
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });

    it('should treat fallback write failures as best-effort after keyring success on Linux', async () => {
      const originalPlatform = process.platform;
      const fileWriteError = new Error('disk full');
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });

      try {
        const mockKeyring: KeyringAdapter = {
          getPassword: async () => 'keyring-secret',
          setPassword: async () => {
            /* succeeds */
          },
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        const originalWriteFallbackFile = (
          store as unknown as {
            writeFallbackFile: (key: string, value: string) => Promise<void>;
          }
        ).writeFallbackFile.bind(store);

        (
          store as unknown as {
            writeFallbackFile: (key: string, value: string) => Promise<void>;
          }
        ).writeFallbackFile = async () => {
          throw fileWriteError;
        };

        await expect(
          store.set('linux-key', 'my-secret'),
        ).resolves.toBeUndefined();

        (
          store as unknown as {
            writeFallbackFile: (key: string, value: string) => Promise<void>;
          }
        ).writeFallbackFile = originalWriteFallbackFile;
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });

    it('should NOT write fallback when fallbackPolicy is deny even if keyring fails', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          throw new Error('Keyring unavailable');
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        fallbackPolicy: 'deny',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store.set('denied-key', 'secret').catch((err) => err);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.message).toBe(
        'Keyring is unavailable and fallback is denied',
      );

      const fallbackFile = path.join(tempDir, 'denied-key.enc');
      const fileExists = await fs
        .access(fallbackFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should prefer keyring value over fallback when both exist', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });

      try {
        const mockKeyring: KeyringAdapter = {
          getPassword: async (_service, account) =>
            account === 'shared-key' ? 'keyring-value' : null,
          setPassword: async () => {},
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set('shared-key', 'fallback-value');

        const retrieved = await store.get('shared-key');
        expect(retrieved).toBe('keyring-value');
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });

    it('should handle keyring that appears available but cannot read back on Linux', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });

      try {
        let writeCount = 0;
        const mockKeyring: KeyringAdapter = {
          getPassword: async (_service, account) => {
            if (account.startsWith('__securestore_probe__')) {
              return 'probe-value';
            }
            return null;
          },
          setPassword: async () => {
            writeCount++;
          },
          deletePassword: async () => false,
        };

        store = new SecureStore('test-service', {
          fallbackDir: tempDir,
          fallbackPolicy: 'allow',
          keyringLoader: async () => mockKeyring,
        });

        await store.set('unreliable-key', 'my-value');
        const retrieved = await store.get('unreliable-key');

        expect(writeCount).toBeGreaterThan(0);
        expect(retrieved).toBe('my-value');
      } finally {
        Object.defineProperty(process, 'platform', {
          configurable: true,
          value: originalPlatform,
        });
      }
    });
  });

  describe('fallbackPolicy semantics preservation', () => {
    it('should allow fallback writes when policy is allow and keyring fails', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          throw new Error('Keyring down');
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      await store.set('fallback-key', 'fallback-secret');
      const retrieved = await store.get('fallback-key');

      expect(retrieved).toBe('fallback-secret');
    });

    it('should throw UNAVAILABLE when keyring fails and fallbackPolicy is deny', async () => {
      const mockKeyring: KeyringAdapter = {
        getPassword: async () => null,
        setPassword: async () => {
          throw new Error('Keyring down');
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        fallbackPolicy: 'deny',
        keyringLoader: async () => mockKeyring,
      });

      const error = await store.set('test-key', 'value').catch((e) => e);

      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('UNAVAILABLE');
    });
  });
});
