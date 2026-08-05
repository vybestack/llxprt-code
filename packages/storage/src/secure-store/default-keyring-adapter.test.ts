/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDefaultKeyringAdapter } from './default-keyring-adapter.js';
import { SecureStore } from './secure-store.js';

const ENV_KEY = 'LLXPRT_TEST_DISABLE_OS_KEYRING';

describe('OS keyring suppression for tests', () => {
  const original = process.env[ENV_KEY];
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keyring-disabled-'));
  });

  afterEach(async () => {
    if (original === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = original;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('produces no keyring adapter when the marker is set', async () => {
    process.env[ENV_KEY] = '1';

    expect(await createDefaultKeyringAdapter()).toBeNull();
  });

  it('lets SecureStore round-trip through the encrypted file when suppressed', async () => {
    process.env[ENV_KEY] = '1';

    const store = new SecureStore('keyring-disabled-test', {
      fallbackDir: tempDir,
      lockDir: path.join(tempDir, 'locks'),
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => 'test-machine-secret',
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
});
