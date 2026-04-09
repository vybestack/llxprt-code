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
    it('should read from fallback when keyring returns null after successful write', async () => {
      // GIVEN: A keyring that writes successfully but later returns null on read
      // (simulating the Ubuntu UI scenario where keyring appears to work but doesn't persist)
      let keyringValue: string | null = null;

      const mockKeyring: KeyringAdapter = {
        getPassword: async () =>
          // Simulate keyring returning null even after write succeeded
          keyringValue,
        setPassword: async (_service, _account, password) => {
          // Write appears to succeed but doesn't actually persist
          keyringValue = password;
          // Simulate the Ubuntu bug: subsequent reads return null
          setTimeout(() => {
            keyringValue = null;
          }, 0);
        },
        deletePassword: async () => false,
      };

      store = new SecureStore('test-service', {
        fallbackDir: tempDir,
        fallbackPolicy: 'allow',
        keyringLoader: async () => mockKeyring,
      });

      // WHEN: Set a value (keyring write appears to succeed)
      await store.set('test-key', 'secret-value');

      // Wait for the simulated keyring "bug" to take effect
      await new Promise((resolve) => setTimeout(resolve, 10));

      // THEN: Should still be able to read from fallback
      const retrieved = await store.get('test-key');
      expect(retrieved).toBe('secret-value');
    });

    it('should persist fallback file even when keyring write succeeds', async () => {
      // GIVEN: A working keyring
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

      // WHEN: Set a value (keyring write succeeds)
      await store.set('persisted-key', 'my-secret');

      // THEN: Fallback file should exist even though keyring succeeded
      const fallbackFile = path.join(tempDir, 'persisted-key.enc');
      const fileExists = await fs
        .access(fallbackFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // Verify we can read it back even if keyring returns null
      const retrieved = await store.get('persisted-key');
      expect(retrieved).toBe('my-secret');
    });

    it('should NOT write fallback when fallbackPolicy is deny even if keyring fails', async () => {
      // GIVEN: A failing keyring with deny policy
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

      // WHEN/THEN: Set should throw UNAVAILABLE error
      await expect(store.set('denied-key', 'secret')).rejects.toThrow(
        SecureStoreError,
      );
      await expect(store.set('denied-key', 'secret')).rejects.toThrow(
        'Keyring is unavailable and fallback is denied',
      );

      // Verify fallback file was NOT created
      const fallbackFile = path.join(tempDir, 'denied-key.enc');
      const fileExists = await fs
        .access(fallbackFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(false);
    });

    it('should prefer keyring value over fallback when both exist', async () => {
      // GIVEN: Keyring has a value and fallback file also has a value
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

      // First write via store.set() to create fallback file
      await store.set('shared-key', 'fallback-value');

      // WHEN: Read the value (keyring has different value)
      const retrieved = await store.get('shared-key');

      // THEN: Keyring value should win (authoritative source)
      expect(retrieved).toBe('keyring-value');
    });

    it('should handle keyring that appears available but cannot read back', async () => {
      // GIVEN: Keyring probe would pass but reads fail inconsistently
      let writeCount = 0;
      const mockKeyring: KeyringAdapter = {
        getPassword: async (_service, account) => {
          // Returns value only for probe, not for real keys
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

      // WHEN: Write and then read back
      await store.set('unreliable-key', 'my-value');
      const retrieved = await store.get('unreliable-key');

      // THEN: Should get value from fallback
      expect(writeCount).toBeGreaterThan(0);
      expect(retrieved).toBe('my-value');
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
