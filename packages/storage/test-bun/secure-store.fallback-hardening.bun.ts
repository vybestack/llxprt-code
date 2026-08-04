/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #1985: harden secure-store fallback semantics.
 *
 * - delete() must surface keyring delete failures (instead of swallowing them)
 *   while still removing the encrypted fallback file, so a secret the user
 *   asked to remove cannot silently survive in the keyring.
 * - has() must treat the same keyring-read error set as fallbackable as get()
 *   (UNAVAILABLE, NOT_FOUND, TIMEOUT), instead of only tolerating NOT_FOUND,
 *   so the two cannot drift again.
 *
 * @plan PLAN-20260803-ISSUE1985
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SecureStore,
  SecureStoreError,
  isRuntimeReplacedError,
  type KeyringAdapter,
} from '../src/secure-store/secure-store.js';
import { runtimeReplacedError } from '../src/secure-store/runtime-replaced-errors.js';
import type { StorageLogger } from '../src/types/logger.js';

const SERVICE = 'fallback-hardening';

/**
 * Shared temp fallback-dir lifecycle. Registers beforeEach/afterEach for the
 * enclosing describe and returns lazy accessors, so identical temp-dir setup
 * is defined once rather than copy-pasted across describe blocks.
 *
 * @plan PLAN-20260803-ISSUE1985
 */
function useTempFallbackDir(): {
  dir: () => string;
  lockDir: () => string;
  encExists: (relPath: string) => Promise<boolean>;
} {
  let tempDir = '';
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'secure-store-fb-hardening-'),
    );
  });
  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
  return {
    dir: () => tempDir,
    lockDir: () => path.join(tempDir, 'locks'),
    encExists: async (relPath: string) => {
      try {
        await fs.access(path.join(tempDir, relPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * Writes a real encrypted fallback `.enc` file for `key` under the temp dir by
 * running set() with no keyring adapter.
 *
 * @plan PLAN-20260803-ISSUE1985
 */
async function seedFallbackFile(
  fallbackDir: string,
  lockDir: string,
  key: string,
  value = 'seeded-value',
): Promise<void> {
  const seeder = new SecureStore(SERVICE, {
    fallbackDir,
    lockDir,
    keyringLoader: async () => null,
  });
  await seeder.set(key, value);
}

/**
 * KeyringAdapter that throws `error` from deletePassword.
 *
 * @plan PLAN-20260803-ISSUE1985
 */
function keyringThrowingOnDelete(error: Error): KeyringAdapter {
  return {
    getPassword: async () => null,
    setPassword: async () => {},
    deletePassword: async () => {
      throw error;
    },
  };
}

/**
 * KeyringAdapter that throws `error` from getPassword.
 *
 * @plan PLAN-20260803-ISSUE1985
 */
function keyringThrowingOnGet(error: Error): KeyringAdapter {
  return {
    getPassword: async () => {
      throw error;
    },
    setPassword: async () => {},
    deletePassword: async () => false,
  };
}

/**
 * StorageLogger that records every `debug` message (evaluating the lazy thunks
 * SecureStore passes) so tests can assert on the observable log content.
 *
 * @plan PLAN-20260803-ISSUE1985
 */
class RecordingLogger implements StorageLogger {
  readonly debugs: string[] = [];
  debug(message: string | (() => string)): void {
    this.debugs.push(typeof message === 'function' ? message() : message);
  }
  warn(): void {
    // no-op
  }
  error(): void {
    // no-op
  }
}

// ─── delete(): surface keyring delete failures (AC-1) ─────────────────────────

describe('SecureStore fallback hardening — delete() surfaces keyring failures', () => {
  const env = useTempFallbackDir();

  it('rejects with LOCKED when deletePassword throws "Keyring locked" (AC-1.1)', async () => {
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnDelete(new Error('Keyring locked')),
    });

    const error = await store.delete('locked-key').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('LOCKED');
    expect(error.remediation).toBe('Unlock your keyring');
  });

  it.each([
    {
      message: 'Permission denied',
      code: 'DENIED',
      remediation: 'Check permissions, run as correct user',
    },
    {
      message: 'Operation timed out',
      code: 'TIMEOUT',
      remediation: 'Retry, check system load',
    },
    {
      message: 'dbus connection refused',
      code: 'UNAVAILABLE',
      remediation:
        'Use --key, install a keyring backend, use seatbelt mode, or allow encrypted fallback storage',
    },
  ])(
    'rejects with $code when deletePassword throws "$message" (AC-1.1)',
    async ({ message, code, remediation }) => {
      const store = new SecureStore(SERVICE, {
        fallbackDir: env.dir(),
        lockDir: env.lockDir(),
        keyringLoader: async () => keyringThrowingOnDelete(new Error(message)),
      });

      const error = await store.delete('throw-key').catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe(code);
      expect(error.remediation).toBe(remediation);
    },
  );

  it('still removes the current-path encrypted fallback file before rejecting (AC-1.2)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'survive-key');
    expect(await env.encExists('survive-key.enc')).toBe(true);

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnDelete(new Error('Keyring locked')),
    });

    const error = await store.delete('survive-key').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('LOCKED');
    // The local encrypted copy must not be left behind even though the keyring
    // delete failed.
    expect(await env.encExists('survive-key.enc')).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'also removes the legacy unencoded fallback path before rejecting (AC-1.2)',
    async () => {
      const key = 'oauth:default';
      await seedFallbackFile(env.dir(), env.lockDir(), key);
      // Move the encoded file to the legacy unencoded path.
      await fs.rename(
        path.join(env.dir(), 'oauth%3Adefault.enc'),
        path.join(env.dir(), 'oauth:default.enc'),
      );
      expect(await env.encExists('oauth:default.enc')).toBe(true);

      const store = new SecureStore(SERVICE, {
        fallbackDir: env.dir(),
        lockDir: env.lockDir(),
        keyringLoader: async () =>
          keyringThrowingOnDelete(new Error('Permission denied')),
      });

      const error = await store.delete(key).catch((e) => e);
      expect(error).toBeInstanceOf(SecureStoreError);
      expect(error.code).toBe('DENIED');
      expect(await env.encExists('oauth:default.enc')).toBe(false);
      expect(await env.encExists('oauth%3Adefault.enc')).toBe(false);
    },
  );

  it('resolves when deletePassword throws a NOT_FOUND-classified error and reports the fallback result (AC-1.3)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'nf-key');
    expect(await env.encExists('nf-key.enc')).toBe(true);

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnDelete(new Error('credential not found')),
    });

    // The keyring simply had nothing to remove; the fallback file was deleted.
    await expect(store.delete('nf-key')).resolves.toBe(true);
    expect(await env.encExists('nf-key.enc')).toBe(false);
  });

  it('returns false when deletePassword resolves false and no fallback file exists (AC-1.4)', async () => {
    const keyring: KeyringAdapter = {
      getPassword: async () => null,
      setPassword: async () => {},
      deletePassword: async () => false,
    };
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () => keyring,
    });

    await expect(store.delete('absent')).resolves.toBe(false);
  });

  it('returns true from the fallback file alone when no keyring adapter loads (AC-1.5)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'fb-only');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () => null,
    });

    await expect(store.delete('fb-only')).resolves.toBe(true);
    expect(await env.encExists('fb-only.enc')).toBe(false);
  });

  it('logs the failed keyring delete with its key and classification (AC-1.6)', async () => {
    const logger = new RecordingLogger();
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      logger,
      keyringLoader: async () =>
        keyringThrowingOnDelete(new Error('Keyring locked')),
    });

    const error = await store.delete('logged-key').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('LOCKED');

    // The log content *is* the observable behavior here: the previously-silent
    // catch must now identify the failed key, the operation, and the code.
    const failureLog = logger.debugs.find((m) => m.includes('[delete]'));
    expect(failureLog).toBeDefined();
    expect(failureLog).toContain('logged-key');
    expect(failureLog).toContain('LOCKED');
    expect(failureLog).toContain('keyring delete failed');
  });

  it('preserves RUNTIME_REPLACED in delete() instead of downgrading it to UNAVAILABLE', async () => {
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnDelete(runtimeReplacedError()),
    });

    const error = await store.delete('replaced-delete').catch((e) => e);
    // A RUNTIME_REPLACED SecureStoreError matches none of the message
    // heuristics; without structured-code preservation classifyError() would
    // downgrade it to UNAVAILABLE and isRuntimeReplacedError() would no longer
    // identify the rethrown error.
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('RUNTIME_REPLACED');
    expect(isRuntimeReplacedError(error)).toBe(true);
  });
});

// ─── has(): fallback classification parity with get() (AC-2) ──────────────────

describe('SecureStore fallback hardening — has() matches get() fallback semantics', () => {
  const env = useTempFallbackDir();

  it('returns true from the fallback file when getPassword throws a TIMEOUT-classified error (AC-2.1)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'timeout-key');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('Operation timed out')),
    });

    await expect(store.has('timeout-key')).resolves.toBe(true);
  });

  it('returns false when getPassword throws an UNAVAILABLE-classified error and no fallback file exists (AC-2.2)', async () => {
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('dbus connection refused')),
    });

    await expect(store.has('absent')).resolves.toBe(false);
  });

  it('returns true from the fallback file when getPassword throws an UNAVAILABLE-classified error (AC-2.2)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'unavail-key');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('dbus connection refused')),
    });

    await expect(store.has('unavail-key')).resolves.toBe(true);
  });

  it('falls through to the fallback file on a NOT_FOUND-classified getPassword error (AC-2.3)', async () => {
    await seedFallbackFile(env.dir(), env.lockDir(), 'nf-has-key');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('credential not found')),
    });

    await expect(store.has('nf-has-key')).resolves.toBe(true);
  });

  it('rejects with LOCKED when getPassword throws "Keyring locked" (AC-2.4)', async () => {
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('Keyring locked')),
    });

    const error = await store.has('locked').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('LOCKED');
  });

  it('rejects with DENIED when getPassword throws "Permission denied" (AC-2.4)', async () => {
    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(new Error('Permission denied')),
    });

    const error = await store.has('denied').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('DENIED');
  });

  it.skipIf(process.platform === 'win32')(
    'finds a legacy unencoded fallback file after an UNAVAILABLE keyring error (AC-2.5)',
    async () => {
      const key = 'oauth:default';
      await seedFallbackFile(env.dir(), env.lockDir(), key);
      // Move the encoded file to the legacy unencoded path.
      await fs.rename(
        path.join(env.dir(), 'oauth%3Adefault.enc'),
        path.join(env.dir(), 'oauth:default.enc'),
      );

      const store = new SecureStore(SERVICE, {
        fallbackDir: env.dir(),
        lockDir: env.lockDir(),
        keyringLoader: async () =>
          keyringThrowingOnGet(new Error('dbus connection refused')),
      });

      await expect(store.has(key)).resolves.toBe(true);
    },
  );

  it('rejects with CORRUPT (not UNAVAILABLE) when getPassword throws a SecureStoreError(CORRUPT) and does not consult the fallback file (AC-2.4)', async () => {
    // Seed a valid fallback file so that an UNAVAILABLE downgrade would make
    // has() return true instead of rejecting. CORRUPT must reject outright.
    await seedFallbackFile(env.dir(), env.lockDir(), 'corrupt-key');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () =>
        keyringThrowingOnGet(
          new SecureStoreError('malformed credential', 'CORRUPT', 'x'),
        ),
    });

    const error = await store.has('corrupt-key').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('CORRUPT');
  });

  it('preserves RUNTIME_REPLACED in has() instead of falling back to the file', async () => {
    // Seed a valid fallback file: without structured-code preservation,
    // classifyError() downgrades RUNTIME_REPLACED to the fallbackable
    // UNAVAILABLE and has() returns true instead of rejecting.
    await seedFallbackFile(env.dir(), env.lockDir(), 'replaced-has');

    const store = new SecureStore(SERVICE, {
      fallbackDir: env.dir(),
      lockDir: env.lockDir(),
      keyringLoader: async () => keyringThrowingOnGet(runtimeReplacedError()),
    });

    const error = await store.has('replaced-has').catch((e) => e);
    expect(error).toBeInstanceOf(SecureStoreError);
    expect(error.code).toBe('RUNTIME_REPLACED');
    expect(isRuntimeReplacedError(error)).toBe(true);
  });
});
