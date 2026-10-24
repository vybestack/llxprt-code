/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  ProfileManager,
  ProfileNotFoundError,
} from '@vybestack/llxprt-code-settings';
import { resolveLoadBalancerSubProfile } from './loadBalancerProfile.js';

describe('resolveLoadBalancerSubProfile — sub-profile load errors keep their cause', () => {
  let profilesDir: string;
  let profileManager: ProfileManager;

  function resolve(
    name: string,
  ): ReturnType<typeof resolveLoadBalancerSubProfile> {
    return resolveLoadBalancerSubProfile(name, {
      lbName: 'lb',
      profileManagerInstance: profileManager,
      lbLogger: { debug: () => {}, warn: () => {} },
    });
  }

  beforeEach(async () => {
    profilesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-lb-sub-'));
    profileManager = new ProfileManager(profilesDir);
  });

  afterEach(async () => {
    await fs.rm(profilesDir, { recursive: true, force: true });
  });

  it('resolves an existing member (control)', async () => {
    await profileManager.saveProfile('member', {
      version: 1,
      provider: 'openai',
      model: 'gpt-4',
      modelParams: {},
      ephemeralSettings: {},
    });

    const resolved = await resolve('member');

    expect(resolved.providerName).toBe('openai');
    expect(resolved.model).toBe('gpt-4');
  });

  it('reports a missing member file as non-existent with the not-found cause chain', async () => {
    const error = await resolve('absent').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const failure = error as Error;
    expect(failure.message).toBe(
      'Load balancer profile "lb" references profile "absent" which does not exist',
    );
    expect(failure.cause).toBeInstanceOf(ProfileNotFoundError);
    const notFound = failure.cause as ProfileNotFoundError;
    expect(notFound.profileName).toBe('absent');
    expect((notFound.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('reports a malformed member file as a load failure with the whole cause chain', async () => {
    await fs.writeFile(path.join(profilesDir, 'broken.json'), '{ not json');

    const error = await resolve('broken').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const failure = error as Error;
    expect(failure.message).toBe(
      'Load balancer profile "lb" could not load profile "broken"',
    );
    const corrupted = failure.cause as Error;
    expect(corrupted.message).toContain("Profile 'broken' is corrupted");
    expect(corrupted.cause).toBeInstanceOf(SyntaxError);
  });
});
