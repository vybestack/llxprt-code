/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ProfileManager } from './ProfileManager.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import type { Profile } from './types.js';

const PROFILES_DIRECTORY = 'profiles';

function getIsolatedProfilesDirectory(): string {
  const configHome = process.env.LLXPRT_CONFIG_HOME;
  if (
    process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1' ||
    configHome === undefined ||
    path.resolve(Storage.getGlobalConfigDir()) !== path.resolve(configHome)
  ) {
    throw new Error('ProfileManager tests require isolated storage');
  }

  return path.join(configHome, PROFILES_DIRECTORY);
}

describe('ProfileManager storage isolation', () => {
  afterEach(async () => {
    await fs.rm(getIsolatedProfilesDirectory(), {
      recursive: true,
      force: true,
    });
  });

  it('writes profiles only beneath the isolated config root when no explicit directory is provided', async () => {
    const configDir = Storage.getGlobalConfigDir();
    const isolatedRoot = path.dirname(configDir);

    expect(process.env.LLXPRT_TEST_STORAGE_ISOLATED).toBe('1');
    expect(configDir).toBe(path.join(isolatedRoot, 'config'));
    expect(process.env.LLXPRT_CONFIG_HOME).toBe(configDir);

    const manager = new ProfileManager();
    const profile: Profile = {
      version: 1,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: {},
    };

    await manager.saveProfile('isolation-test-profile', profile);

    const profilesDir = path.join(configDir, PROFILES_DIRECTORY);
    const profilePath = path.join(profilesDir, 'isolation-test-profile.json');

    const content = await fs.readFile(profilePath, 'utf-8');
    expect(JSON.parse(content).provider).toBe('gemini');
    expect(path.dirname(path.dirname(profilePath))).toBe(configDir);
  });

  it('constructs the default profiles directory from Storage.getGlobalConfigDir', async () => {
    const configDir = Storage.getGlobalConfigDir();
    const manager = new ProfileManager();
    const profiles = await manager.listProfiles();

    // listProfiles creates the directory; verify it was created under the
    // isolated config root, not the real home directory.
    const stat = await fs.stat(path.join(configDir, PROFILES_DIRECTORY));
    expect(stat.isDirectory()).toBe(true);

    // listProfiles returns [] for a fresh isolated root.
    expect(profiles).toStrictEqual([]);
  });
});
