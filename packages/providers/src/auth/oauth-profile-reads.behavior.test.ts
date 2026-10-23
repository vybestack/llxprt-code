/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  vi,
} from 'bun:test';
import { Storage } from '@vybestack/llxprt-code-storage';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings/profiles/ProfileManager.js';
import { createOAuthProfileReads } from './oauth-profile-reads.js';
import {
  loadProfileBuckets,
  resolveCurrentProfileOAuthContext,
  resolveProfileBuckets,
} from './token-profile-resolver.js';

async function saveMember(
  directory: string,
  name: string,
  buckets: string[],
): Promise<void> {
  await new ProfileManager(directory).saveProfile(name, {
    version: 1,
    provider: 'codex',
    model: 'member-model',
    modelParams: {},
    ephemeralSettings: {},
    auth: { type: 'oauth', buckets },
  });
}

describe('OAuth profile read ownership on disk', () => {
  let directory: string;
  let previousConfigHome: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'oauth-profile-reads-'));
    previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'default');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (previousConfigHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
    await rm(directory, { recursive: true, force: true });
  });

  it('defers acquisition until first read and recovers after failed acquisition', async () => {
    spyOn(Storage, 'getGlobalConfigDir').mockImplementationOnce(() => {
      throw new Error('Profile directory unavailable');
    });
    const reads = createOAuthProfileReads(undefined);
    await expect(reads.loadProfile('member')).rejects.toThrow(
      'Profile directory unavailable',
    );

    process.env.LLXPRT_CONFIG_HOME = join(directory, 'recovered');
    await saveMember(join(directory, 'recovered', 'profiles'), 'member', [
      'recovered-account',
    ]);
    expect(
      await resolveProfileBuckets('codex', () => 'member', undefined, reads),
    ).toStrictEqual(['recovered-account']);
  });

  it('shares simultaneous first reads while isolating equal names in sibling repositories', async () => {
    const firstDirectory = join(directory, 'first');
    const secondDirectory = join(directory, 'second');
    await saveMember(firstDirectory, 'member', ['first-account']);
    await saveMember(secondDirectory, 'member', ['second-account']);
    const first = createOAuthProfileReads(firstDirectory);
    const second = createOAuthProfileReads(secondDirectory);

    expect(
      await Promise.all([
        resolveProfileBuckets('codex', () => 'member', undefined, first),
        resolveProfileBuckets('codex', () => 'member', undefined, first),
        resolveProfileBuckets('codex', () => 'member', undefined, second),
      ]),
    ).toStrictEqual([['first-account'], ['first-account'], ['second-account']]);
    await saveMember(firstDirectory, 'member', ['updated-account']);
    expect(
      await resolveProfileBuckets('codex', () => 'member', undefined, first),
    ).toStrictEqual(['updated-account']);
    expect(
      await resolveProfileBuckets('codex', () => 'member', undefined, second),
    ).toStrictEqual(['second-account']);
  });

  it('retains the acquired default repository when ambient configuration changes', async () => {
    await saveMember(join(directory, 'default', 'profiles'), 'member', [
      'retained-account',
    ]);
    await saveMember(join(directory, 'other', 'profiles'), 'member', [
      'other-account',
    ]);
    const reads = createOAuthProfileReads(undefined);
    expect(
      await loadProfileBuckets('codex', 'member', 'member', reads),
    ).toStrictEqual(['retained-account']);
    process.env.LLXPRT_CONFIG_HOME = join(directory, 'other');
    expect(
      await loadProfileBuckets('codex', 'member', 'member', reads),
    ).toStrictEqual(['retained-account']);
  });

  it('resolves default-directory member metadata instead of load balancer parent buckets', async () => {
    const profiles = join(directory, 'default', 'profiles');
    await saveMember(profiles, 'alpha', ['alpha-account']);
    await saveMember(profiles, 'beta', ['beta-account']);
    await new ProfileManager(profiles).saveProfile('parent', {
      version: 1,
      type: 'loadbalancer',
      policy: 'roundrobin',
      profiles: ['alpha', 'beta'],
      provider: '',
      model: '',
      modelParams: {},
      ephemeralSettings: {},
    });

    expect(
      await Promise.all(
        ['alpha', 'beta'].map((profileId) =>
          resolveProfileBuckets('codex', () => 'parent', { profileId }),
        ),
      ),
    ).toStrictEqual([['alpha-account'], ['beta-account']]);
    expect(await resolveProfileBuckets('codex', () => 'parent')).toStrictEqual(
      [],
    );
    expect(
      await resolveCurrentProfileOAuthContext('codex', ' alpha '),
    ).toStrictEqual({
      metadata: { providerId: 'codex', profileId: 'alpha' },
      providerMatches: true,
      hasExplicitBucketPolicy: true,
    });
    expect(
      await resolveProfileBuckets('anthropic', () => 'alpha'),
    ).toStrictEqual([]);
  });

  it('preserves explicit errors and implicit empty buckets for missing or corrupt disk profiles', async () => {
    const profiles = join(directory, 'default', 'profiles');
    await mkdir(profiles, { recursive: true });
    await writeFile(join(profiles, 'corrupt.json'), '{');
    for (const name of ['missing', 'corrupt']) {
      expect(await resolveProfileBuckets('codex', () => name)).toStrictEqual(
        [],
      );
      await expect(
        resolveProfileBuckets('codex', () => null, { profileId: name }),
      ).rejects.toThrow(`Profile '${name}'`);
      await expect(
        resolveCurrentProfileOAuthContext('codex', name),
      ).rejects.toThrow(`Profile '${name}'`);
    }
  });

  it('never substitutes the default directory for an explicitly selected repository', async () => {
    await saveMember(join(directory, 'default', 'profiles'), 'member', [
      'ambient-account',
    ]);
    const reads = createOAuthProfileReads(join(directory, 'selected'));
    expect(
      await resolveProfileBuckets('codex', () => 'member', undefined, reads),
    ).toStrictEqual([]);
    await expect(
      resolveProfileBuckets(
        'codex',
        () => null,
        { profileId: 'member' },
        reads,
      ),
    ).rejects.toThrow("Profile 'member' not found");
    await expect(
      resolveCurrentProfileOAuthContext('codex', 'member', reads),
    ).rejects.toThrow("Profile 'member' not found");
    await saveMember(join(directory, 'selected'), 'member', [
      'selected-account',
    ]);
    expect(
      await resolveProfileBuckets('codex', () => 'member', undefined, reads),
    ).toStrictEqual(['selected-account']);
  });

  it('preserves empty bucket policy for profiles without named OAuth accounts', async () => {
    await new ProfileManager(
      join(directory, 'default', 'profiles'),
    ).saveProfile('member', {
      version: 1,
      provider: 'codex',
      model: 'member-model',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth' },
    });
    expect(await resolveProfileBuckets('codex', () => 'member')).toStrictEqual(
      [],
    );
    expect(
      await resolveCurrentProfileOAuthContext('codex', 'member'),
    ).toStrictEqual({
      metadata: { providerId: 'codex', profileId: 'member' },
      providerMatches: true,
      hasExplicitBucketPolicy: false,
    });
  });
});
