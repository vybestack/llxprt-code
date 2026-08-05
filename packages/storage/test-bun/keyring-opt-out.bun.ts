/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the `LLXPRT_DISABLE_OS_KEYRING` production opt-out
 * (issue #3020).
 *
 * These cases were moved out of the Vitest suite
 * (`src/secure-store/default-keyring-adapter.test.ts`) into a Bun + `bun:test`
 * file, because that Vitest suite is not registered in the Bun manifest and
 * must not import `bun:test`. The opt-out behavior is exercised through the
 * real `createDefaultKeyringAdapter()` / `SecureStore` factory paths.
 *
 * `@napi-rs/keyring` is faked via `mock.module` so the "not opted out" cases
 * (an adapter IS produced for `0`, `''`, `true`) are deterministic and never
 * touch the developer's real OS keychain. The fake only takes effect when the
 * dynamic import actually runs — every opt-out path returns null before
 * importing.
 *
 * Both `LLXPRT_DISABLE_OS_KEYRING` (the shipped lever) and
 * `LLXPRT_TEST_DISABLE_OS_KEYRING` (the test-isolation marker, which the
 * factory also honors and which is checked first) are cleared in beforeEach and
 * restored in afterEach so nothing leaks between cases.
 *
 * @plan PLAN-20260805-ISSUE3020
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDefaultKeyringAdapter } from '../src/secure-store/default-keyring-adapter.js';
import { SecureStore } from '../src/secure-store/secure-store.js';
import { SecureStoreError } from '../src/secure-store/secure-store-errors.js';

const PROD_ENV_KEY = 'LLXPRT_DISABLE_OS_KEYRING';
const TEST_ENV_KEY = 'LLXPRT_TEST_DISABLE_OS_KEYRING';

// Boundary double for @napi-rs/keyring so the "not opted out" cases are
// deterministic: when the opt-out does NOT fire, the factory proceeds to
// import @napi-rs/keyring and must produce an adapter. The real module may be
// absent or may touch the developer's real keychain, so a fake guarantees that
// "not opted out" is observable as a non-null adapter without side effects.
mock.module('@napi-rs/keyring', () => ({
  AsyncEntry: class {
    async getPassword(): Promise<string | null> {
      return 'mocked-value';
    }
    async setPassword(): Promise<void> {}
    async deleteCredential(): Promise<boolean> {
      return false;
    }
  },
}));

describe('LLXPRT_DISABLE_OS_KEYRING production opt-out (issue #3020)', () => {
  const originalProd = process.env[PROD_ENV_KEY];
  const originalTest = process.env[TEST_ENV_KEY];
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prod-disable-'));
    // Both OS-keyring env vars are cleared so no case can be trivially
    // satisfied by a pre-set test marker, and so nothing leaks between cases.
    delete process.env[PROD_ENV_KEY];
    delete process.env[TEST_ENV_KEY];
  });

  afterEach(async () => {
    if (originalProd === undefined) {
      delete process.env[PROD_ENV_KEY];
    } else {
      process.env[PROD_ENV_KEY] = originalProd;
    }
    if (originalTest === undefined) {
      delete process.env[TEST_ENV_KEY];
    } else {
      process.env[TEST_ENV_KEY] = originalTest;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('produces no keyring adapter when LLXPRT_DISABLE_OS_KEYRING=1 (case 15)', async () => {
    process.env[PROD_ENV_KEY] = '1';

    expect(await createDefaultKeyringAdapter()).toBeNull();
  });

  it('round-trips SecureStore through the encrypted fallback when LLXPRT_DISABLE_OS_KEYRING=1 (case 16)', async () => {
    process.env[PROD_ENV_KEY] = '1';

    const store = new SecureStore('prod-disable-test', {
      fallbackDir: tempDir,
      lockDir: path.join(tempDir, 'locks'),
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => Buffer.from('test-machine-secret'),
    });

    await store.set('token', 'super-secret');

    expect(await store.get('token')).toBe('super-secret');
    // Proves the value went to the encrypted file rather than the OS keychain.
    const encrypted = await fs.readFile(
      path.join(tempDir, 'token.enc'),
      'utf8',
    );
    expect(encrypted).not.toContain('super-secret');
  });

  it('produces an adapter for 0, empty, unset, and true — only exactly 1 opts out (case 17)', async () => {
    // '0', the empty string, an unset variable, and 'true' must NOT opt out:
    // only the exact string '1' does, matching the existing test-marker
    // convention. The test marker is cleared in beforeEach, so these reach the
    // real factory check.
    process.env[PROD_ENV_KEY] = '0';
    expect(await createDefaultKeyringAdapter()).not.toBeNull();

    // Set explicitly rather than deleted: an assigned empty string and an
    // absent variable are distinct states, and only assignment exercises the
    // empty-string value itself.
    process.env[PROD_ENV_KEY] = '';
    expect(await createDefaultKeyringAdapter()).not.toBeNull();

    delete process.env[PROD_ENV_KEY];
    expect(await createDefaultKeyringAdapter()).not.toBeNull();

    process.env[PROD_ENV_KEY] = 'true';
    expect(await createDefaultKeyringAdapter()).not.toBeNull();

    // Contrast: exactly '1' opts out.
    process.env[PROD_ENV_KEY] = '1';
    expect(await createDefaultKeyringAdapter()).toBeNull();
  });

  it('a deny policy still rejects with UNAVAILABLE when opted out (case 18)', async () => {
    process.env[PROD_ENV_KEY] = '1';

    const store = new SecureStore('prod-disable-deny-test', {
      fallbackDir: tempDir,
      lockDir: path.join(tempDir, 'locks'),
      fallbackPolicy: 'deny',
      machineSecretLoader: async () => Buffer.from('test-machine-secret'),
    });

    let caught: unknown;
    try {
      await store.set('token', 'super-secret');
    } catch (error) {
      caught = error;
    }
    // The opt-out does not silently defeat a deny policy: set() raises
    // UNAVAILABLE rather than writing a fallback file.
    expect(caught).toBeInstanceOf(SecureStoreError);
    if (caught instanceof SecureStoreError) {
      expect(caught.code).toBe('UNAVAILABLE');
    }
  });
});
