/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for SecureStore fallback envelope versioning (v:1/v:2).
 *
 * v:2 envelopes incorporate a machine secret as the dominant KDF entropy so
 * that the confidentiality of fallback files depends on a proper secret
 * rather than solely on filesystem permissions. v:1 envelopes remain
 * decryptable for backwards compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { SecureStore, SecureStoreError } from './secure-store.js';
import { resetMachineSecretCache } from './machine-secret.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

async function createTempFallbackDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'secure-store-v2-test-'));
}

const FIXED_SECRET_A = crypto.randomBytes(32);
const FIXED_SECRET_B = crypto.randomBytes(32);

function makeSecretProvider(secret: Buffer): {
  loader: () => Promise<Buffer | null>;
} {
  return {
    loader: async () => secret,
  };
}

function nullSecretProvider(): {
  loader: () => Promise<Buffer | null>;
} {
  return {
    loader: async () => null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SecureStore — Fallback Envelope v:2 (machine secret)', () => {
  let tempDir: string;
  let machineSecretPath: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    machineSecretPath = path.join(tempDir, '.machine_secret');
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('new writes produce a v:2 envelope when a machine secret is available', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    await store.set('v2-key', 'v2-value');

    const file = path.join(tempDir, 'v2-key.enc');
    const content = await fs.readFile(file, 'utf8');
    const envelope = JSON.parse(content);
    expect(envelope.v).toBe(2);
    expect(envelope.crypto.alg).toBe('aes-256-gcm');
    expect(envelope.crypto.kdf).toBe('scrypt');
  });

  it('v:2 fallback data round-trips through set/get', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    await store.set('roundtrip', 'super-secret-roundtrip');
    const result = await store.get('roundtrip');
    expect(result).toBe('super-secret-roundtrip');
  });

  it('v:2 fallback is readable by a second instance sharing the machine secret', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const store1 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });
    const store2 = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    await store1.set('shared', 'shared-secret');
    const result = await store2.get('shared');
    expect(result).toBe('shared-secret');
  });

  it('v:2 fallback fails with CORRUPT when machine secret differs', async () => {
    const providerA = makeSecretProvider(FIXED_SECRET_A);
    const providerB = makeSecretProvider(FIXED_SECRET_B);
    const writer = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: providerA.loader,
      machineSecretPath,
    });
    const reader = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: providerB.loader,
      machineSecretPath,
    });

    await writer.set('divergent', 'written-with-A');

    let err: unknown;
    try {
      await reader.get('divergent');
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
  });

  it('v:2 read throws CORRUPT when machine secret is unavailable', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const writer = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    await writer.set('unavailable', 'value');

    const reader = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: nullSecretProvider().loader,
      machineSecretPath,
    });

    let err: unknown;
    try {
      await reader.get('unavailable');
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
  });

  it('writes v:1 envelope when machine secret is unavailable', async () => {
    const provider = nullSecretProvider();
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    await store.set('v1-degraded', 'value');

    const file = path.join(tempDir, 'v1-degraded.enc');
    const content = await fs.readFile(file, 'utf8');
    const envelope = JSON.parse(content);
    expect(envelope.v).toBe(1);
  });
});

// ─── Prevent v:2 → v:1 downgrade on overwrite ───────────────────────────────

describe('SecureStore — No v:2 downgrade on overwrite with unavailable secret', () => {
  let tempDir: string;
  let machineSecretPath: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    machineSecretPath = path.join(tempDir, '.machine_secret');
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('v:2 overwrite attempt with unavailable secret throws and leaves existing v:2 readable with original secret', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const writer = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    // Write a v:2 file.
    await writer.set('protected', 'original-value');

    const filePath = path.join(tempDir, 'protected.enc');
    const beforeContent = await fs.readFile(filePath, 'utf8');
    const beforeEnvelope = JSON.parse(beforeContent);
    expect(beforeEnvelope.v).toBe(2);

    // Now attempt to set the same key with the machine secret unavailable.
    // This must NOT silently overwrite the v:2 file with a v:1 envelope.
    const degradedWriter = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: nullSecretProvider().loader,
      machineSecretPath,
    });

    let err: unknown;
    try {
      await degradedWriter.set('protected', 'attacker-value');
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    // Must be CORRUPT or UNAVAILABLE — a secure rejection, never a silent
    // overwrite.
    const code = (err as SecureStoreError).code;
    expect(code === 'CORRUPT' || code === 'UNAVAILABLE').toBe(true);

    // The on-disk file must still be v:2 and byte-identical (not overwritten).
    const afterContent = await fs.readFile(filePath, 'utf8');
    expect(afterContent).toBe(beforeContent);

    // And the original secret must still decrypt the original value.
    const reader = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });
    const recovered = await reader.get('protected');
    expect(recovered).toBe('original-value');
  });

  it('new file with unavailable secret still writes v:1 (no existing v:2 to protect)', async () => {
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: nullSecretProvider().loader,
      machineSecretPath,
    });

    await store.set('fresh', 'fresh-value');

    const filePath = path.join(tempDir, 'fresh.enc');
    const content = await fs.readFile(filePath, 'utf8');
    const envelope = JSON.parse(content);
    expect(envelope.v).toBe(1);
  });

  it('existing v:1 file with unavailable secret can be overwritten with v:1', async () => {
    // First write a v:1 file.
    const v1Writer = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: nullSecretProvider().loader,
      machineSecretPath,
    });
    await v1Writer.set('v1key', 'v1-original');

    const filePath = path.join(tempDir, 'v1key.enc');
    let content = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(content.v).toBe(1);

    // Overwriting another v:1 while secret is unavailable is allowed.
    await v1Writer.set('v1key', 'v1-updated');

    content = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(content.v).toBe(1);
    const result = await v1Writer.get('v1key');
    expect(result).toBe('v1-updated');
  });
});

describe('SecureStore — Legacy v:1 envelope compatibility', () => {
  let tempDir: string;
  let machineSecretPath: string;

  beforeEach(async () => {
    tempDir = await createTempFallbackDir();
    machineSecretPath = path.join(tempDir, '.machine_secret');
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('legacy v:1 files remain decryptable with v:2-capable store', async () => {
    // First write a v:1 file using a store that has no machine secret
    const v1Writer = new SecureStore('legacy-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: nullSecretProvider().loader,
      machineSecretPath,
    });
    await v1Writer.set('legacy', 'legacy-value');

    // Confirm it's v:1
    const file = path.join(tempDir, 'legacy.enc');
    const before = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(before.v).toBe(1);

    // Now read it with a store that DOES have a machine secret (v:2 capable)
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const reader = new SecureStore('legacy-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    const result = await reader.get('legacy');
    expect(result).toBe('legacy-value');
  });

  it('unknown envelope versions still throw CORRUPT with upgrade remediation', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);
    const store = new SecureStore('test-service', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    const badEnvelope = JSON.stringify({ v: 99, crypto: {}, data: 'abc' });
    await fs.writeFile(path.join(tempDir, 'bad-version.enc'), badEnvelope);

    let err: unknown;
    try {
      await store.get('bad-version');
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeDefined();
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
    expect((err as SecureStoreError).remediation).toContain('upgrade');
  });

  it('cross-service: different serviceNames derive different keys for the same machine secret', async () => {
    const provider = makeSecretProvider(FIXED_SECRET_A);

    const storeA = new SecureStore('service-a', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });
    const storeB = new SecureStore('service-b', {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: provider.loader,
      machineSecretPath,
    });

    // Both write to the same fallbackDir but under sanitized key names.
    // service-a writes 'shared' which becomes 'shared.enc'.
    await storeA.set('shared', 'from-a');

    // service-b cannot decrypt service-a's file because serviceName is part
    // of the derivation, AND because each serviceName writes into its own
    // fallbackDir by default. Here we forced the same dir, so we instead
    // verify a key written by storeA is readable by storeA but not storeB
    // when the key collides — but to keep the test deterministic, we just
    // confirm storeA can read its own write.
    const own = await storeA.get('shared');
    expect(own).toBe('from-a');

    // storeB writing 'shared' should not be decryptable by storeA
    await storeB.set('shared', 'from-b');
    const other = await storeB.get('shared');
    expect(other).toBe('from-b');

    // storeA now sees storeB's file content for the same key; it must not
    // decrypt with service-a's key.
    let err: unknown;
    try {
      await storeA.get('shared');
    } catch (caught) {
      err = caught;
    }
    expect(err).toBeInstanceOf(SecureStoreError);
    expect((err as SecureStoreError).code).toBe('CORRUPT');
  });
});
