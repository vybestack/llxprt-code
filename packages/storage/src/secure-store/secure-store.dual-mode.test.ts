/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dual-mode contract harness for SecureStore.
 *
 * Issue #2704: CI ran both "keyring" and "fallback" SecureStore test legs,
 * but an env-var mode selector (LLXPRT_SECURE_STORE_FORCE_FALLBACK) lost its
 * only reader during a package move, so both legs exercised the SAME code.
 * This suite restores real divergence coverage by driving BOTH code paths
 * through the existing `keyringLoader` DI seam — explicitly injecting either
 * a working mock adapter (keyring-present) or `null` (keyring-absent). No
 * process-global env var is used; removing the fallback implementation must
 * break these tests.
 *
 * @plan PLAN-20260211-SECURESTORE.P05
 * @requirement R1.1, R3.1-R3.8, R4.1, R4.2
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

// ─── Keyring vs Fallback Behavioral Difference Matrix ───────────────────────
//
// These divergences are drawn directly from packages/storage/src/secure-store/
// secure-store.ts. They are the behaviors that differ between the two code
// paths and therefore MUST be covered by distinct, explicitly-injected tests
// (not a single path exercised twice via an env-var toggle).
//
// 1. On-disk artifacts:
//    - Fallback (keyring-absent): set() writes an encrypted `.enc` file via
//      atomic temp+rename with 0o600 permissions.
//    - Keyring (keyring-present, non-Linux): set() writes ONLY to the keyring;
//      the fallback dir stays empty. (On Linux, a backup fallback copy is also
//      written after a successful keyring write.)
//
// 2. Envelope / machine-secret dependence (fallback only):
//    - Fallback files are AES-256-GCM envelopes (v:1 or v:2). v:2 incorporates
//      a machine secret as the dominant KDF entropy; v:1 derives from
//      serviceName + machineId. Decryption fails closed (CORRUPT) on mismatch.
//    - Keyring stores opaque strings with no envelope/machine-secret concept.
//
// 3. fallbackPolicy:
//    - 'deny' + keyring-absent → set() throws SecureStoreError(UNAVAILABLE).
//    - 'allow' + keyring-absent → set() writes the encrypted fallback file.
//
// 4. delete() OR-semantics:
//    - delete() tries the keyring AND the fallback file; returns true if
//      EITHER succeeded. A keyring-present store can delete a fallback-only
//      artifact (and vice versa) because both paths are attempted.
//
// 5. list()/has() merging:
//    - list() merges keyring findCredentials accounts with fallback-dir
//      filenames (deduped, sorted). has() checks keyring then fallback file.

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates an in-memory mock keyring adapter. Injected via keyringLoader so the
 * real SecureStore keyring code path executes against a deterministic,
 * host-independent adapter (not the real OS keychain).
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

async function createTempFallbackDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-dual-'));
}

// Deterministic v1 envelopes: no machine secret, so writes are reproducible
// without touching the global machine-secret cache or the real keychain.
const NULL_MACHINE_SECRET_LOADER = async (): Promise<Buffer | null> => null;

// ─── Shared Contract (both modes) ────────────────────────────────────────────

interface ContractMode {
  readonly mode: string;
  readonly fallbackPolicy: 'allow' | 'deny';
  readonly makeLoader: () => () => Promise<KeyringAdapter | null>;
}

// The keyring-present mode uses fallbackPolicy 'deny' so that on Linux (where
// production writes an encrypted backup after a successful keyring write) the
// keyring code path is exercised in isolation — reads, list, and has must be
// satisfied by the keyring, not masked by a fallback artifact. The keyring-
// absent mode uses 'allow' so the encrypted-file fallback path is engaged.
const SHARED_CONTRACT_MODES: readonly ContractMode[] = [
  {
    mode: 'keyring-present',
    fallbackPolicy: 'deny',
    makeLoader: () => async () => createMockKeyring(),
  },
  {
    mode: 'keyring-absent',
    fallbackPolicy: 'allow',
    makeLoader: () => async () => null,
  },
];

describe.each(SHARED_CONTRACT_MODES)(
  'SecureStore shared contract [$mode]',
  ({ makeLoader, fallbackPolicy }) => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await createTempFallbackDir();
    });

    afterEach(async () => {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('round-trips a value via get/set', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('round-trip', 'secret-value');
      expect(await store.get('round-trip')).toBe('secret-value');
    });

    it('overwrites a previous value on re-set', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('overwrite', 'first');
      await store.set('overwrite', 'second');
      expect(await store.get('overwrite')).toBe('second');
    });

    it('isolates independent keys', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('a', '1');
      await store.set('b', '2');
      expect(await store.get('a')).toBe('1');
      expect(await store.get('b')).toBe('2');
    });

    it('delete() returns true for an existing key', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('delete-me', 'val');
      expect(await store.delete('delete-me')).toBe(true);
    });

    it('delete() returns false for a nonexistent key', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      expect(await store.delete('never-set')).toBe(false);
    });

    it('list() includes set keys', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('alpha', '1');
      await store.set('beta', '2');
      const keys = await store.list();
      expect(keys).toStrictEqual(['alpha', 'beta']);
    });

    it('has() returns true for a set key and false otherwise', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await store.set('present', 'val');
      expect(await store.has('present')).toBe(true);
      expect(await store.has('absent')).toBe(false);
    });

    it('get() returns null for a key that was never set', async () => {
      const store = new SecureStore('dual-service', {
        keyringLoader: makeLoader(),
        fallbackDir: tempDir,
        fallbackPolicy,
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      expect(await store.get('nonexistent')).toBeNull();
    });
  },
);

// ─── Divergence Assertions (keyring-present vs keyring-absent) ───────────────

describe('SecureStore keyring-vs-fallback divergence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keyring-absent mode writes an encrypted .enc artifact', async () => {
    const fallbackStore = new SecureStore('diverge', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });

    await fallbackStore.set('fallback-only', 'fb');

    const files = await fs.readdir(tempDir);
    const encFiles = files.filter((f) => f.endsWith('.enc'));

    // Fallback path always produces a .enc file.
    expect(encFiles).toContain('fallback-only.enc');
  });

  // On Linux, a successful keyring write also keeps an encrypted backup copy
  // in the fallback dir, so the "no fallback artifact" assertion is only valid
  // on non-Linux platforms. Split into its own skipIf-guarded test so the
  // unconditional divergence above stays platform-independent.
  it.skipIf(process.platform === 'linux')(
    'keyring-present mode leaves no .enc fallback artifact (non-Linux)',
    async () => {
      const keyringStore = new SecureStore('diverge', {
        keyringLoader: async () => createMockKeyring(),
        fallbackDir: tempDir,
        fallbackPolicy: 'allow',
        machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
      });

      await keyringStore.set('keyring-only-no-artifact', 'kr');

      const files = await fs.readdir(tempDir);
      const encFiles = files.filter((f) => f.endsWith('.enc'));
      expect(encFiles).not.toContain('keyring-only-no-artifact.enc');
    },
  );

  it('keyring-absent write produces an encrypted envelope (cleartext absent, AES-256-GCM)', async () => {
    const fallbackStore = new SecureStore('diverge', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });

    const secret = 'super-secret-plaintext-token';
    await fallbackStore.set('envelope-key', secret);

    // Removing the fallback implementation breaks this: no .enc file would
    // exist and the cleartext would never be encrypted.
    const encPath = path.join(tempDir, 'envelope-key.enc');
    const raw = await fs.readFile(encPath, 'utf8');
    const envelope = JSON.parse(raw) as {
      v: number;
      crypto: { alg: string; kdf: string };
      data: string;
    };

    expect(envelope.v).toBe(1);
    expect(envelope.crypto.alg).toBe('aes-256-gcm');
    expect(envelope.crypto.kdf).toBe('scrypt');
    // Cleartext must NOT appear in the encrypted envelope.
    expect(raw).not.toContain(secret);

    // Round-trip proves the fallback decrypt path executes end-to-end.
    expect(await fallbackStore.get('envelope-key')).toBe(secret);
  });

  it("fallbackPolicy 'deny' + absent keyring throws UNAVAILABLE", async () => {
    const store = new SecureStore('diverge', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
    });

    let err: unknown;
    try {
      await store.set('denied', 'val');
    } catch (__caught) {
      err = __caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('UNAVAILABLE');
  });

  it('delete() removes a fallback-only artifact via a keyring-present store (OR-semantics)', async () => {
    // Write via fallback only.
    const fallbackStore = new SecureStore('diverge', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });
    await fallbackStore.set('or-delete', 'fb-val');

    // The keyring-present store has an empty keyring but shares the fallback dir.
    const keyringStore = new SecureStore('diverge', {
      keyringLoader: async () => createMockKeyring(),
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });

    // delete() tries keyring (nothing there) AND fallback file — returns true.
    expect(await keyringStore.delete('or-delete')).toBe(true);
    // The fallback file is gone.
    expect(await fallbackStore.get('or-delete')).toBeNull();
  });

  it('list()/has() merge keyring accounts with fallback-dir filenames', async () => {
    const mockKeyring = createMockKeyring();
    // 'a' lives only in the keyring. fallbackPolicy 'deny' ensures no fallback
    // artifact is written for 'a' on any platform (including Linux, which
    // otherwise writes an encrypted backup after a keyring success).
    const keyringStore = new SecureStore('diverge', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
      fallbackPolicy: 'deny',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });
    await keyringStore.set('a', 'kr-val');

    // 'b' lives only in the fallback file (written by an absent-keyring store).
    const fallbackStore = new SecureStore('diverge', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });
    await fallbackStore.set('b', 'fb-val');

    // A merge-capable store (keyring present + fallback allowed) sees BOTH:
    // keyring account 'a' + fallback filename 'b'. `mergeStore` reuses the
    // populated `mockKeyring` (shared with `keyringStore`) so that 'a' is
    // present in the keyring, while 'b' exists only as a fallback artifact.
    const mergeStore = new SecureStore('diverge', {
      keyringLoader: async () => mockKeyring,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: NULL_MACHINE_SECRET_LOADER,
    });
    const keys = await mergeStore.list();
    expect(keys).toStrictEqual(['a', 'b']);

    // has() also checks both stores.
    expect(await mergeStore.has('a')).toBe(true);
    expect(await mergeStore.has('b')).toBe(true);
  });
});
