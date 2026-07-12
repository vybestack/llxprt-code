/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isValidEnvelope } from './envelope.js';
import { ProviderKeyStorage } from './provider-key-storage.js';
import { SecureStore } from './secure-store.js';

const MACHINE_SECRET = Buffer.alloc(32, 0x42);
const SERVICE_NAME = 'llxprt-code-provider-keys';

describe('ProviderKeyStorage encrypted fallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-key-storage-fallback-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createStorage(): ProviderKeyStorage {
    const secureStore = new SecureStore(SERVICE_NAME, {
      keyringLoader: async () => null,
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      machineSecretLoader: async () => MACHINE_SECRET,
    });
    return new ProviderKeyStorage({ secureStore });
  }

  it('persists provider keys across storage instances in an encrypted v2 envelope', async () => {
    await createStorage().saveKey('persisted-key', 'sk-persisted-value');

    const content = await fs.readFile(
      path.join(tempDir, 'persisted-key.enc'),
      'utf8',
    );
    const envelope: unknown = JSON.parse(content);
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({ v: 2 });
    expect(content).not.toContain('sk-persisted-value');

    const reader = createStorage();
    expect(await reader.getKey('persisted-key')).toBe('sk-persisted-value');
    expect(await reader.hasKey('persisted-key')).toBe(true);
    expect(await reader.listKeys()).toContain('persisted-key');

    expect(await reader.deleteKey('persisted-key')).toBe(true);
    expect(await reader.getKey('persisted-key')).toBeNull();
  });
});
