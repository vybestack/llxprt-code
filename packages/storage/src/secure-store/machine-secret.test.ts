/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the machine-secret provider.
 *
 * The machine secret is a 32-byte high-entropy secret used as the root of
 * trust for the SecureStore fallback encryption (envelope v:2). It is
 * resolved in this order: in-memory cache → OS keyring → file → generate
 * (persist and return).
 *
 * Infrastructure (keyring adapter, filesystem path) is injected so the real
 * provider logic is exercised; the module under test is never mocked.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { KeyringAdapter } from './secure-store.js';
import {
  getMachineSecret,
  resetMachineSecretCache,
  type MachineSecretOptions,
} from './machine-secret.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createMockKeyring(): KeyringAdapter & {
  store: Map<string, string>;
} {
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
  };
}

async function createTempFilePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'machine-secret-test-'));
  return path.join(dir, 'machine_secret');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Machine Secret Provider', () => {
  let tempFilePath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempFilePath = await createTempFilePath();
    tempDir = path.dirname(tempFilePath);
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('first call generates a 32-byte secret when keyring is available', async () => {
    const keyring = createMockKeyring();
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    const secret = await getMachineSecret(options);

    expect(secret).not.toBeNull();
    expect(secret!.length).toBe(32);

    // Secret should be persisted to the keyring (preferred durable store)
    const stored = await keyring.getPassword(
      'llxprt-code-machine-secret',
      'default',
    );
    expect(stored).not.toBeNull();
    expect(Buffer.compare(Buffer.from(stored!, 'base64'), secret!)).toBe(0);
  });

  it('first call without keyring generates a 32-byte secret and persists it to the file', async () => {
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => null,
    };

    const secret = await getMachineSecret(options);

    expect(secret).not.toBeNull();
    expect(secret!.length).toBe(32);

    // File should now exist on disk
    const written = await fs.readFile(tempFilePath, 'utf8');
    const decoded = Buffer.from(written, 'base64');
    expect(decoded.length).toBe(32);
    expect(Buffer.compare(decoded, secret!)).toBe(0);
  });

  it('second call returns the cached secret without touching the keyring or file', async () => {
    const keyring = createMockKeyring();
    let keyringReads = 0;
    const wrappedKeyring: KeyringAdapter = {
      getPassword: async (service: string, account: string) => {
        keyringReads++;
        return keyring.getPassword(service, account);
      },
      setPassword: keyring.setPassword.bind(keyring),
      deletePassword: keyring.deletePassword.bind(keyring),
    };
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => wrappedKeyring,
    };

    const first = await getMachineSecret(options);
    const readsAfterFirst = keyringReads;

    const second = await getMachineSecret(options);

    expect(second).not.toBeNull();
    expect(Buffer.compare(second!, first!)).toBe(0);
    expect(keyringReads).toBe(readsAfterFirst);
  });

  it('prefers the OS keyring over the file when both are available', async () => {
    const keyring = createMockKeyring();
    const keyringSecret = crypto.randomBytes(32);
    await keyring.setPassword(
      'llxprt-code-machine-secret',
      'default',
      keyringSecret.toString('base64'),
    );

    // Also place a different secret in the file
    const fileSecret = crypto.randomBytes(32);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempFilePath, fileSecret.toString('base64'));

    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    const secret = await getMachineSecret(options);

    expect(secret).not.toBeNull();
    expect(Buffer.compare(secret!, keyringSecret)).toBe(0);
    expect(Buffer.compare(secret!, fileSecret)).not.toBe(0);
  });

  it('falls back to the file when the keyring has no secret', async () => {
    const keyring = createMockKeyring();
    const fileSecret = crypto.randomBytes(32);
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempFilePath, fileSecret.toString('base64'));

    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    const secret = await getMachineSecret(options);

    expect(secret).not.toBeNull();
    expect(Buffer.compare(secret!, fileSecret)).toBe(0);
  });

  it('persists a newly generated secret to the keyring when keyring is available', async () => {
    const keyring = createMockKeyring();
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    const secret = await getMachineSecret(options);

    const stored = await keyring.getPassword(
      'llxprt-code-machine-secret',
      'default',
    );
    expect(stored).not.toBeNull();
    expect(Buffer.compare(Buffer.from(stored!, 'base64'), secret!)).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    'file fallback is written with 0o600 permissions on Unix',
    async () => {
      const options: MachineSecretOptions = {
        filePath: tempFilePath,
        keyringLoader: async () => null,
      };

      await getMachineSecret(options);

      const stat = await fs.stat(tempFilePath);
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'parent directory is created with 0o700 permissions on Unix',
    async () => {
      const nestedDir = path.join(tempDir, 'nested', 'subdir');
      const nestedFile = path.join(nestedDir, 'machine_secret');

      const options: MachineSecretOptions = {
        filePath: nestedFile,
        keyringLoader: async () => null,
      };

      await getMachineSecret(options);

      const stat = await fs.stat(nestedDir);
      expect(stat.mode & 0o777).toBe(0o700);
    },
  );

  it('returns null (graceful degradation) when neither keyring nor file are usable and generation cannot persist', async () => {
    // Point filePath at a path whose parent cannot be created (use an
    // existing file as a "directory" to force mkdir to fail).
    const blockerFile = path.join(tempDir, 'blocker');
    await fs.writeFile(blockerFile, 'x');
    const impossiblePath = path.join(blockerFile, 'child', 'machine_secret');

    const options: MachineSecretOptions = {
      filePath: impossiblePath,
      keyringLoader: async () => null,
    };

    const secret = await getMachineSecret(options);
    expect(secret).toBeNull();
  });

  it('returns null when keyring loader throws and file persistence cannot create the parent path', async () => {
    const blockerFile = path.join(tempDir, 'blocker-for-loader-throw');
    await fs.writeFile(blockerFile, 'x');
    const impossiblePath = path.join(blockerFile, 'child', 'machine_secret');
    const options: MachineSecretOptions = {
      filePath: impossiblePath,
      keyringLoader: async () => {
        throw new Error('keyring exploded');
      },
    };

    const secret = await getMachineSecret(options);
    expect(secret).toBeNull();
  });

  it('does not throw when keyringLoader returns null and generates+persists to file', async () => {
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => null,
    };

    const secret = await getMachineSecret(options);
    expect(secret).not.toBeNull();
    expect(secret!.length).toBe(32);

    const onDisk = await fs.readFile(tempFilePath, 'utf8');
    expect(Buffer.from(onDisk, 'base64').length).toBe(32);
  });

  it('resetMachineSecretCache forces re-read from keyring/file on next call', async () => {
    const keyring = createMockKeyring();
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    const first = await getMachineSecret(options);

    // Rotate the keyring secret out-of-band and clear the file
    const newSecret = crypto.randomBytes(32);
    await keyring.setPassword(
      'llxprt-code-machine-secret',
      'default',
      newSecret.toString('base64'),
    );
    await fs.unlink(tempFilePath).catch(() => {});

    resetMachineSecretCache();
    const second = await getMachineSecret(options);

    expect(Buffer.compare(second!, newSecret)).toBe(0);
    expect(Buffer.compare(second!, first!)).not.toBe(0);
  });
});

// ─── Concurrency race on first-time generation ──────────────────────────────

describe('Machine Secret Provider — Concurrency', () => {
  let tempFilePath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempFilePath = await createTempFilePath();
    tempDir = path.dirname(tempFilePath);
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('concurrent first-call calls all return the same secret matching persisted', async () => {
    const keyring = createMockKeyring();
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => keyring,
    };

    // Fire N concurrent first-time calls. Without a mutex, each may
    // generate a different secret and the loser may return a non-durable
    // value while another wins persistence.
    const N = 16;
    const results = await Promise.all(
      Array.from({ length: N }, () => getMachineSecret(options)),
    );

    // Every result must be non-null and identical.
    for (const secret of results) {
      expect(secret).not.toBeNull();
      expect(Buffer.compare(secret!, results[0]!)).toBe(0);
    }

    // The persisted keyring secret must match what was returned.
    const stored = await keyring.getPassword(
      'llxprt-code-machine-secret',
      'default',
    );
    expect(stored).not.toBeNull();
    expect(Buffer.compare(Buffer.from(stored!, 'base64'), results[0]!)).toBe(0);
  });

  it('concurrent first-call calls with file fallback all share the persisted secret', async () => {
    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => null,
    };

    const N = 16;
    const results = await Promise.all(
      Array.from({ length: N }, () => getMachineSecret(options)),
    );

    for (const secret of results) {
      expect(secret).not.toBeNull();
      expect(Buffer.compare(secret!, results[0]!)).toBe(0);
    }

    const onDisk = await fs.readFile(tempFilePath, 'utf8');
    expect(Buffer.compare(Buffer.from(onDisk, 'base64'), results[0]!)).toBe(0);
  });
});

// ─── Cache scoping by durable source identity ───────────────────────────────

describe('Machine Secret Provider — Cache scoping', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'machine-secret-cache-test-'),
    );
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('two distinct filePaths return and use distinct persisted secrets', async () => {
    const pathA = path.join(tempDir, 'a', 'machine_secret');
    const pathB = path.join(tempDir, 'b', 'machine_secret');

    const optsA: MachineSecretOptions = {
      filePath: pathA,
      keyringLoader: async () => null,
    };
    const optsB: MachineSecretOptions = {
      filePath: pathB,
      keyringLoader: async () => null,
    };

    const secretA = await getMachineSecret(optsA);
    const secretB = await getMachineSecret(optsB);

    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();
    expect(Buffer.compare(secretA!, secretB!)).not.toBe(0);

    const onDiskA = await fs.readFile(pathA, 'utf8');
    const onDiskB = await fs.readFile(pathB, 'utf8');
    expect(Buffer.compare(Buffer.from(onDiskA, 'base64'), secretA!)).toBe(0);
    expect(Buffer.compare(Buffer.from(onDiskB, 'base64'), secretB!)).toBe(0);
  });

  it('clearing one source does not poison the other', async () => {
    const pathA = path.join(tempDir, 'a', 'machine_secret');
    const pathB = path.join(tempDir, 'b', 'machine_secret');

    const optsA: MachineSecretOptions = {
      filePath: pathA,
      keyringLoader: async () => null,
    };
    const optsB: MachineSecretOptions = {
      filePath: pathB,
      keyringLoader: async () => null,
    };

    const secretA = await getMachineSecret(optsA);
    const secretB = await getMachineSecret(optsB);

    // Wipe source A and clear the cache.
    await fs.unlink(pathA).catch(() => {});
    resetMachineSecretCache();

    // Source B should still resolve its persisted secret unaffected.
    const secretBReRead = await getMachineSecret(optsB);
    expect(secretBReRead).not.toBeNull();
    expect(Buffer.compare(secretBReRead!, secretB!)).toBe(0);
    // And should NOT accidentally be source A's value.
    expect(Buffer.compare(secretBReRead!, secretA!)).not.toBe(0);
  });

  it('two injected keyring loaders using the same filePath keep separate cached secrets', async () => {
    const sharedPath = path.join(tempDir, 'shared', 'machine_secret');
    const keyringA = createMockKeyring();
    const keyringB = createMockKeyring();
    const secretA = crypto.randomBytes(32);
    const secretB = crypto.randomBytes(32);
    await keyringA.setPassword(
      'llxprt-code-machine-secret',
      'default',
      secretA.toString('base64'),
    );
    await keyringB.setPassword(
      'llxprt-code-machine-secret',
      'default',
      secretB.toString('base64'),
    );

    const optsA: MachineSecretOptions = {
      filePath: sharedPath,
      keyringLoader: async () => keyringA,
    };
    const optsB: MachineSecretOptions = {
      filePath: sharedPath,
      keyringLoader: async () => keyringB,
    };

    const resolvedA = await getMachineSecret(optsA);
    const resolvedB = await getMachineSecret(optsB);

    expect(resolvedA).not.toBeNull();
    expect(resolvedB).not.toBeNull();
    expect(Buffer.compare(resolvedA!, secretA)).toBe(0);
    expect(Buffer.compare(resolvedB!, secretB)).toBe(0);
  });
});

// ─── Existing file permission repair ────────────────────────────────────────

describe('Machine Secret Provider — Permission repair', () => {
  let tempFilePath: string;
  let tempDir: string;

  beforeEach(async () => {
    tempFilePath = await createTempFilePath();
    tempDir = path.dirname(tempFilePath);
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === 'win32')(
    'pre-existing 0o644 file is repaired to 0o600 before acceptance',
    async () => {
      const preExisting = crypto.randomBytes(32);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(tempFilePath, preExisting.toString('base64'), {
        mode: 0o644,
      });
      // Ensure the file is actually 0o644 (some platforms may adjust).
      await fs.chmod(tempFilePath, 0o644);

      const options: MachineSecretOptions = {
        filePath: tempFilePath,
        keyringLoader: async () => null,
      };

      const secret = await getMachineSecret(options);

      expect(secret).not.toBeNull();
      expect(Buffer.compare(secret!, preExisting)).toBe(0);

      const stat = await fs.stat(tempFilePath);
      expect(stat.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'pre-existing 0o777 parent directory is repaired to 0o700 before file acceptance',
    async () => {
      const preExisting = crypto.randomBytes(32);
      await fs.mkdir(tempDir, { recursive: true, mode: 0o777 });
      await fs.chmod(tempDir, 0o777);
      await fs.writeFile(tempFilePath, preExisting.toString('base64'), {
        mode: 0o600,
      });

      const options: MachineSecretOptions = {
        filePath: tempFilePath,
        keyringLoader: async () => null,
      };

      const secret = await getMachineSecret(options);

      expect(secret).not.toBeNull();
      expect(Buffer.compare(secret!, preExisting)).toBe(0);

      const stat = await fs.stat(tempDir);
      expect(stat.mode & 0o777).toBe(0o700);
    },
  );

  it('invalid existing file degrades instead of rotating the machine secret', async () => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempFilePath, 'not-a-valid-32-byte-secret');

    const options: MachineSecretOptions = {
      filePath: tempFilePath,
      keyringLoader: async () => null,
    };

    const secret = await getMachineSecret(options);

    expect(secret).toBeNull();
    const onDisk = await fs.readFile(tempFilePath, 'utf8');
    expect(onDisk).toBe('not-a-valid-32-byte-secret');
  });
});
