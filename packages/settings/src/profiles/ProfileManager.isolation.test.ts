/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { ProfileManager } from './ProfileManager.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import type { Profile } from './types.js';

describe('ProfileManager storage isolation', () => {
  afterEach(async () => {
    // Clean up any profiles created during tests so subsequent tests see a
    // fresh state within the shared isolated config root.
    const profilesDir = path.join(Storage.getGlobalConfigDir(), 'profiles');
    await fs.rm(profilesDir, { recursive: true, force: true });
  });

  it('writes profiles only beneath the isolated config root when no explicit directory is provided', async () => {
    const configDir = Storage.getGlobalConfigDir();

    // The storage isolation bootstrap (test-setup-storage-isolation.ts)
    // must have redirected config/data/cache/log roots to a temp dir.
    expect(configDir.startsWith(os.tmpdir())).toBe(true);
    expect(configDir.startsWith(os.homedir())).toBe(false);

    const manager = new ProfileManager();
    const profile: Profile = {
      version: 1,
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      modelParams: {},
      ephemeralSettings: {},
    };

    await manager.saveProfile('isolation-test-profile', profile);

    const profilesDir = path.join(configDir, 'profiles');
    const profilePath = path.join(profilesDir, 'isolation-test-profile.json');

    // The file must exist beneath the isolated config root.
    const content = await fs.readFile(profilePath, 'utf-8');
    expect(JSON.parse(content).provider).toBe('gemini');

    // The file must NOT exist beneath the real home directory.
    // Use path.resolve to handle cross-platform (Windows drive letter) cases
    // where path.relative returns an absolute path instead of a '..' prefix.
    const resolvedProfile = path.resolve(profilePath);
    const resolvedHome = path.resolve(os.homedir()) + path.sep;
    expect(resolvedProfile.startsWith(resolvedHome)).toBe(false);
  });

  it('constructs the default profiles directory from Storage.getGlobalConfigDir', async () => {
    const configDir = Storage.getGlobalConfigDir();
    const manager = new ProfileManager();
    const profiles = await manager.listProfiles();

    // listProfiles creates the directory; verify it was created under the
    // isolated config root, not the real home directory.
    const stat = await fs.stat(path.join(configDir, 'profiles'));
    expect(stat.isDirectory()).toBe(true);

    // listProfiles returns [] for a fresh isolated root.
    expect(profiles).toStrictEqual([]);
  });
});
