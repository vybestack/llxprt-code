/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Acceptance test for issue #2927 (T5): two concurrent getMachineSecret()
 * resolutions against a shared fake keyring converge on one persisted secret
 * with zero deletePassword calls.
 *
 * NOTE: These tests verify in-process serialization (the in-flight promise
 * coalescing and the single CredentialWriteLock instance per lockDir).
 * Cross-process filesystem contention is covered by
 * credential-write-lock.test.ts, not here.
 *
 * @plan PLAN-20260801-ISSUE2927
 * @requirement R3, R5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { KeyringAdapter } from './secure-store.js';
import { getMachineSecret, resetMachineSecretCache } from './machine-secret.js';

function createCountingKeyring(): KeyringAdapter & {
  store: Map<string, string>;
  readonly deleteCount: number;
  readonly setCount: number;
} {
  const store = new Map<string, string>();
  let deleteCount = 0;
  let setCount = 0;
  return {
    store,
    get deleteCount(): number {
      return deleteCount;
    },
    get setCount(): number {
      return setCount;
    },
    getPassword: async (service: string, account: string) => {
      // Real async yield so two concurrent resolutions genuinely overlap
      // rather than completing sequentially before the second reaches the
      // lock.
      await new Promise((resolve) => setTimeout(resolve, 1));
      return store.get(`${service}:${account}`) ?? null;
    },
    setPassword: async (service: string, account: string, password: string) => {
      setCount += 1;
      // Real async yield so the in-process serialization chain is actually
      // exercised — the second resolution overlaps the first in the event
      // loop and waits on the in-flight promise.
      await new Promise((resolve) => setTimeout(resolve, 5));
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) => {
      deleteCount += 1;
      return store.delete(`${service}:${account}`);
    },
  };
}

describe('Machine Secret Provider — concurrent write acceptance (issue #2927, T5)', () => {
  let tempDir: string;
  let tempFilePath: string;
  let lockDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'machine-secret-concurrent-'),
    );
    tempFilePath = path.join(tempDir, 'machine_secret');
    lockDir = path.join(tempDir, 'locks');
    resetMachineSecretCache();
  });

  afterEach(async () => {
    resetMachineSecretCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('two concurrent in-process resolutions converge on one secret with zero deletePassword calls', async () => {
    // NOTE: This test proves in-process convergence (in-flight promise
    // coalescing and the single CredentialWriteLock instance per lockDir).
    // Cross-process filesystem contention is covered by
    // credential-write-lock.test.ts, not here.
    const keyring = createCountingKeyring();
    // Use a single shared keyringLoader reference so both calls share the
    // same cache source key (matching real-world usage where a single
    // SecureStore instance is shared).
    const keyringLoader = async (): Promise<KeyringAdapter | null> => keyring;
    const sharedOptions = {
      filePath: tempFilePath,
      keyringLoader,
      lockDir,
    };

    const [secretA, secretB] = await Promise.all([
      getMachineSecret(sharedOptions),
      getMachineSecret(sharedOptions),
    ]);

    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();
    // Both resolved — compare via fallback that would produce a mismatch
    // sentinel if either were null.
    const a: Buffer = secretA ?? Buffer.alloc(0);
    const b: Buffer = secretB ?? Buffer.from('__mismatch__');
    expect(Buffer.compare(a, b)).toBe(0);

    expect(keyring.deleteCount).toBe(0);

    // L6: Assert the expected write count — exactly one setPassword should
    // have occurred (the winning write).
    expect(keyring.setCount).toBe(1);

    // The keyring holds exactly one value for the machine secret account.
    const stored = keyring.store.get('llxprt-code-machine-secret:default');
    expect(stored).toBeDefined();
    const storedValue: string = stored ?? '__missing__';
    expect(Buffer.from(storedValue, 'base64')).toStrictEqual(a);
  });

  it('two in-process resolutions with independent source identities converge on the same secret (H2)', async () => {
    const keyring = createCountingKeyring();

    // Two DISTINCT keyringLoader function references — so the module-level
    // in-flight coalescing cache does NOT merge them. They share one adapter
    // and one lockDir, so they MUST serialize through the filesystem lock.
    const loaderA = async (): Promise<KeyringAdapter | null> => keyring;
    const loaderB = async (): Promise<KeyringAdapter | null> => keyring;

    const [secretA, secretB] = await Promise.all([
      getMachineSecret({
        filePath: tempFilePath,
        keyringLoader: loaderA,
        lockDir,
      }),
      getMachineSecret({
        filePath: tempFilePath,
        keyringLoader: loaderB,
        lockDir,
      }),
    ]);

    // Both must be non-null.
    expect(secretA).not.toBeNull();
    expect(secretB).not.toBeNull();

    // Both must converge on the SAME secret.
    const a: Buffer = secretA ?? Buffer.alloc(0);
    const b: Buffer = secretB ?? Buffer.from('__mismatch__');
    expect(Buffer.compare(a, b)).toBe(0);

    // Exactly one durable value in the keyring.
    const stored = keyring.store.get('llxprt-code-machine-secret:default');
    expect(stored).toBeDefined();
    expect(Buffer.from(stored ?? '__missing__', 'base64')).toStrictEqual(a);

    // Exactly one setPassword call — both converged on a single winner.
    expect(keyring.setCount).toBe(1);

    // Zero deletions.
    expect(keyring.deleteCount).toBe(0);
  });
});
