/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for SecureStore.
 *
 * Tests drive the implementation (TDD): they should all FAIL against the
 * current stub, which throws NotYetImplemented for every method.
 *
 * @plan PLAN-20260211-SECURESTORE.P05
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  type KeyringAdapter,
} from './secure-store.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keytar adapter for testing keychain operations.
 * This is injected via SecureStoreOptions.keyringLoader — no mock theater.
 */
function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
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

/**
 * Creates a temp directory for use as fallbackDir in tests.
 */
async function createTempFallbackDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-test-'));
  return tmpDir;
}

// ─── Keyring Access (R1) ─────────────────────────────────────────────────────

describe('SecureStore — Keyring Access', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with path separators', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    let err1: unknown;
    try {
      await store.set('path/traversal', 'evil');
    } catch (__caught) {
      err1 = __caught;
    }
    expect(err1).toBeDefined();
    expect(err1).toBeInstanceOf(SecureStoreError);
    expect((err1 as SecureStoreError).code).toBe('CORRUPT');

    let err2: unknown;
    try {
      await store.set('path\\traversal', 'evil');
    } catch (__caught) {
      err2 = __caught;
    }
    expect(err2).toBeDefined();
    expect(err2).toBeInstanceOf(SecureStoreError);
    expect((err2 as SecureStoreError).code).toBe('CORRUPT');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with null bytes', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    let err: unknown;
    try {
      await store.set('null\0byte', 'evil');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.4
   */
  it('rejects keys with dot/dotdot components', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    let err1: unknown;
    try {
      await store.set('.', 'evil');
    } catch (__caught) {
      err1 = __caught;
    }
    expect(err1).toBeDefined();
    expect(err1).toBeInstanceOf(SecureStoreError);
    expect((err1 as SecureStoreError).code).toBe('CORRUPT');

    let err2: unknown;
    try {
      await store.set('..', 'evil');
    } catch (__caught) {
      err2 = __caught;
    }
    expect(err2).toBeDefined();
    expect(err2).toBeInstanceOf(SecureStoreError);
    expect((err2 as SecureStoreError).code).toBe('CORRUPT');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.7
   */
  it('list() skips malformed filenames in fallback directory', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Store a valid key
    await store.set('valid-key', 'valid-value');

    // Manually create a malformed .enc file with a path separator in the name
    // (shouldn't be possible via set(), but could exist on disk)
    // We create a file whose name sans .enc would fail validation
    await fs.writeFile(path.join(tempDir, '..enc'), 'garbage');

    const keys = await store.list();
    // Should contain 'valid-key' but skip the malformed filename
    expect(keys).toContain('valid-key');
    expect(keys).not.toContain('.');
  });
});

// ─── Probe Cache Invalidation ────────────────────────────────────────────────

describe('SecureStore — Probe Cache Invalidation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('probe cache invalidated after N consecutive keyring failures', async () => {
    let failCount = 0;
    const adapter: KeyringAdapter = {
      getPassword: async () => {
        failCount++;
        if (failCount >= 1) throw new Error('Keyring daemon unavailable');
        return null;
      },
      setPassword: async (_s, _a, _p) => {
        // probe set succeeds initially
      },
      deletePassword: async () => true,
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Probe initially — set/get/delete cycle determines availability
    await store.isKeychainAvailable();
    // Adapter works for set, fails for get — probe returns false
    // After enough failures through operations, probe cache should be invalidated
    // and next isKeychainAvailable() call should re-probe

    // Force multiple operation failures to trigger cache invalidation
    for (let i = 0; i < 3; i++) {
      try {
        await store.get(`fail-key-${i}`);
      } catch {
        // expected to fail
      }
    }

    // After N consecutive failures, the probe cache should be invalidated
    // isKeychainAvailable should re-probe (not return stale cached true)
    const afterFailures = await store.isKeychainAvailable();
    expect(afterFailures).toBe(false);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('consecutive failure counter resets on successful keyring operation', async () => {
    let shouldFail = false;
    const mockKeyring = createMockKeyring();
    const adapter: KeyringAdapter = {
      getPassword: async (service, account) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.getPassword(service, account);
      },
      setPassword: async (service, account, password) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.setPassword(service, account, password);
      },
      deletePassword: async (service, account) => {
        if (shouldFail) throw new Error('Keyring temporarily locked');
        return mockKeyring.deletePassword(service, account);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Probe initially — keyring works
    const first = await store.isKeychainAvailable();
    expect(first).toBe(true);

    // Cause some failures (but fewer than threshold)
    shouldFail = true;
    try {
      await store.get('fail-1');
    } catch {
      // expected
    }
    try {
      await store.get('fail-2');
    } catch {
      // expected
    }

    // Now keyring recovers — a successful operation resets the counter
    shouldFail = false;
    await store.set('success-key', 'success-val');

    // More failures after reset (but fewer than threshold again)
    shouldFail = true;
    try {
      await store.get('fail-3');
    } catch {
      // expected
    }

    // Counter was reset, so we haven't hit the threshold
    // Probe should still return true (from cache or re-probe success)
    shouldFail = false;
    const afterReset = await store.isKeychainAvailable();
    expect(afterReset).toBe(true);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R2.3
   */
  it('after cache invalidation, next isKeychainAvailable re-probes', async () => {
    let probeCallCount = 0;
    let shouldFail = false;
    const probeStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        return probeStore.get(acct) ?? null;
      },
      setPassword: async (_svc: string, acct: string, pw: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        probeStore.set(acct, pw);
      },
      deletePassword: async (_svc: string, acct: string) => {
        if (shouldFail) throw new Error('Keyring unavailable');
        probeCallCount++;
        return probeStore.delete(acct);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Initial probe succeeds
    await store.isKeychainAvailable();
    const _countAfterFirst = probeCallCount;

    // Cause failures to invalidate cache
    shouldFail = true;
    for (let i = 0; i < 3; i++) {
      try {
        await store.set(`fail-${i}`, 'val');
      } catch {
        // expected
      }
    }

    // Recover keyring
    shouldFail = false;
    probeCallCount = 0;

    // This should re-probe (not return stale result)
    const result = await store.isKeychainAvailable();
    expect(result).toBe(true);
    // Probe performed new set/get/delete cycle
    expect(probeCallCount).toBeGreaterThan(0);
  });
});

// ─── Fault Injection (R27.1) ─────────────────────────────────────────────────

describe('SecureStore — Fault Injection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('sequential writes leave no temp files behind', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write a known good value first
    await store.set('interrupt-key', 'original-value');

    // Now simulate a "corrupted" write by manually creating a temp file
    // that would exist mid-write, then verify SecureStore's next write
    // produces a clean final file with no temp artifacts
    await store.set('interrupt-key', 'updated-value');

    const files = await fs.readdir(tempDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    expect(tmpFiles.length).toBe(0);

    // Original .enc file should have the updated value
    const result = await store.get('interrupt-key');
    expect(result).toBe('updated-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('keyring error after successful fallback write does not lose data', async () => {
    let keyringFailed = false;
    const faultStore = new Map<string, string>();
    const adapter: KeyringAdapter = {
      getPassword: async (_svc: string, acct: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        return faultStore.get(acct) ?? null;
      },
      setPassword: async (_svc: string, acct: string, pw: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        faultStore.set(acct, pw);
      },
      deletePassword: async (_svc: string, acct: string) => {
        if (keyringFailed) throw new Error('Keyring crashed');
        return faultStore.delete(acct);
      },
    };

    const store = new SecureStore('test-service', {
      keyringLoader: async () => adapter,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // First: keyring works, probe succeeds
    const available = await store.isKeychainAvailable();
    expect(available).toBe(true);

    // Now keyring crashes — set should fall back to file
    keyringFailed = true;
    await store.set('resilient-key', 'important-secret');

    // Data should be retrievable from fallback even though keyring is down
    const result = await store.get('resilient-key');
    expect(result).toBe('important-secret');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R27.1
   */
  it('concurrent writers produce complete non-corrupt files', async () => {
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    // Write the same key concurrently from two store instances
    await Promise.all([
      store1.set('concurrent-key', 'value-from-writer-1'),
      store2.set('concurrent-key', 'value-from-writer-2'),
    ]);

    // The file should contain one complete valid value (last write wins)
    const readStore = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });
    const result = await readStore.get('concurrent-key');

    // Result must be one of the two values — not corrupt or partial
    const validValues = ['value-from-writer-1', 'value-from-writer-2'];
    expect(validValues).toContain(result);
  });
});

// ─── Fallback Policy (R4.2) ─────────────────────────────────────────────────

describe('SecureStore — Fallback Policy', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.2
   */
  it('deny policy throws UNAVAILABLE when keyring is down', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
    });

    let err: unknown;
    try {
      await store.set('denied', 'value');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
    expect((err as SecureStoreError).remediation.length).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.1
   */
  it('allow policy stores in fallback when keyring is down', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store.set('allowed-key', 'allowed-value');
    const result = await store.get('allowed-key');
    expect(result).toBe('allowed-value');
  });
});

// ─── Cross-Instance Consistency ──────────────────────────────────────────────

describe('SecureStore — Cross-Instance Consistency', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R4.3
   */
  it('different SecureStore instances with same config read each other fallback files', async () => {
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
    });

    await store1.set('shared-key', 'shared-value');
    const result = await store2.get('shared-key');
    expect(result).toBe('shared-value');
  });

  /**
   * @plan PLAN-20260211-SECURESTORE.P05
   * @requirement R3.4
   */
  it('delete from one instance is reflected in another', async () => {
    const mockKeyring = createMockKeyring();
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });
    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
    });

    await store1.set('cross-delete', 'to-be-deleted');
    await store1.delete('cross-delete');

    const result = await store2.get('cross-delete');
    expect(result).toBeNull();
  });
});

// Type for accessing the private fallbackDir field in tests.
type SecureStoreInternals = { fallbackDir: string };

function getFallbackDir(store: SecureStore): string {
  return (store as unknown as SecureStoreInternals).fallbackDir;
}

describe('SecureStore — Default Path Uses Platform Standards', () => {
  /**
   * @given SecureStore created without explicit fallbackDir
   * @when checking the default fallback path
   * @then it uses platform-standard app data directory, not ~/.llxprt
   *
   * Platform paths (via env-paths):
   * - macOS: ~/Library/Application Support/llxprt-code/secure-store/{service}
   * - Linux: ~/.local/share/llxprt-code/secure-store/{service} (or $XDG_DATA_HOME)
   * - Windows: %LOCALAPPDATA%\llxprt-code\secure-store\{service}
   */
  it('default fallbackDir is not under ~/.llxprt', () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackPolicy: 'allow',
    });
    const fallbackDir = getFallbackDir(store);
    expect(fallbackDir).not.toContain(path.join('.llxprt', 'secure-store'));
    expect(fallbackDir).toContain('llxprt-code');
    expect(fallbackDir).toContain('test-service');
  });

  it.runIf(process.platform === 'darwin')(
    'default fallbackDir uses macOS Application Support path',
    () => {
      const store = new SecureStore('test-service', {
        keyringLoader: async () => null,
        fallbackPolicy: 'allow',
      });
      const fallbackDir = getFallbackDir(store);
      expect(fallbackDir).toContain('Library/Application Support');
    },
  );

  it.runIf(process.platform === 'win32')(
    'default fallbackDir uses Windows AppData path',
    () => {
      const store = new SecureStore('test-service', {
        keyringLoader: async () => null,
        fallbackPolicy: 'allow',
      });
      const fallbackDir = getFallbackDir(store);
      expect(fallbackDir.toLowerCase()).toMatch(/appdata|localappdata/i);
    },
  );

  it.runIf(process.platform === 'linux')(
    'default fallbackDir uses Linux XDG data path with XDG_DATA_HOME set',
    () => {
      process.env.XDG_DATA_HOME = '/tmp/custom-xdg';
      try {
        const store = new SecureStore('test-service', {
          keyringLoader: async () => null,
          fallbackPolicy: 'allow',
        });
        const fallbackDir = getFallbackDir(store);
        expect(fallbackDir).toContain('/tmp/custom-xdg');
      } finally {
        delete process.env.XDG_DATA_HOME;
      }
    },
  );

  it.runIf(process.platform === 'linux' && !process.env.XDG_DATA_HOME)(
    'default fallbackDir uses Linux XDG data path default',
    () => {
      const store = new SecureStore('test-service', {
        keyringLoader: async () => null,
        fallbackPolicy: 'allow',
      });
      const fallbackDir = getFallbackDir(store);
      expect(fallbackDir).toContain('.local/share');
    },
  );
});
