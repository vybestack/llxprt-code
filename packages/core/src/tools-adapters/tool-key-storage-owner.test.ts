/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreToolKeyStorageAdapter } from './CoreToolKeyStorageAdapter.js';
import {
  ToolKeyStorage,
  type KeyringAdapter,
} from '../tools/tool-key-storage.js';

function createOwner(toolsDir: string): ToolKeyStorage {
  const keys = new Map<string, string>();
  const keyring: KeyringAdapter = {
    getPassword: async (service, account) =>
      keys.get(`${service}:${account}`) ?? null,
    setPassword: async (service, account, value) => {
      keys.set(`${service}:${account}`, value);
    },
    deletePassword: async (service, account) =>
      keys.delete(`${service}:${account}`),
  };
  return new ToolKeyStorage({ toolsDir, keyringLoader: async () => keyring });
}

describe('tool key adapter ownership', () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });
  it('keeps same-name credentials and deletion separate for two owners', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tool-key-owner-'));
    directories.push(directory);
    const firstStorage = createOwner(join(directory, 'first'));
    const secondStorage = createOwner(join(directory, 'second'));
    await firstStorage.saveKey('exa', 'first-secret');
    await secondStorage.saveKey('exa', 'second-secret');
    const first = new CoreToolKeyStorageAdapter(firstStorage);
    const second = new CoreToolKeyStorageAdapter(secondStorage);
    expect((await first.resolveKey('exa')) === 'first-secret').toBe(true);
    expect((await second.resolveKey('exa')) === 'second-secret').toBe(true);
    await first.deleteKey('exa');
    expect(await first.hasKey('exa')).toBe(false);
    expect(await second.hasKey('exa')).toBe(true);
    expect(await second.getKey('exa')).toBe('second-secret');
  });
});
