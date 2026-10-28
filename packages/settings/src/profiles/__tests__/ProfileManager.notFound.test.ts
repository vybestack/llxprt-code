/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ProfileManager, ProfileNotFoundError } from '../ProfileManager.js';

describe('ProfileManager — missing profile is a typed error with its cause', () => {
  let tempDir: string;
  let pm: ProfileManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-profile-nf-'));
    pm = new ProfileManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loadProfile reports a missing profile as ProfileNotFoundError carrying the ENOENT cause', async () => {
    const error = await pm.loadProfile('missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProfileNotFoundError);
    const notFound = error as ProfileNotFoundError;
    expect(notFound.profileName).toBe('missing');
    expect(notFound.message).toBe("Profile 'missing' not found");
    expect((notFound.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('deleteProfile reports a missing profile as ProfileNotFoundError carrying the ENOENT cause', async () => {
    const error = await pm.deleteProfile('missing').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProfileNotFoundError);
    const notFound = error as ProfileNotFoundError;
    expect(notFound.profileName).toBe('missing');
    expect((notFound.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });
});
