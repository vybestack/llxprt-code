/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isResolvedSubProfile,
  type ResolvedSubProfile,
} from '@vybestack/llxprt-code-providers';
import { createProviderKeyStorage } from '@vybestack/llxprt-code-providers/auth.js';
import { memberOptions as options } from './helpers/member-auth-options.js';
import {
  loadBalancer,
  standardProfile,
  useProfileOwner,
  type ProfileOwnerFixture,
} from './helpers/profile-owner-fixture.js';

async function member(
  owner: ProfileOwnerFixture,
  ephemerals: Record<string, unknown>,
): Promise<ResolvedSubProfile> {
  await owner.store.saveProfile('member', standardProfile(ephemerals));
  await owner.application.applySnapshot({
    ...standardProfile(),
    type: 'loadbalancer',
    profiles: ['member'],
    policy: 'roundrobin',
  });
  const result = loadBalancer(owner).getLoadBalancerConfig().subProfiles[0];
  if (!isResolvedSubProfile(result))
    throw new Error('Expected resolved member');
  return result;
}
describe('Load balancer member credentials at use time', () => {
  const owner = useProfileOwner();

  it('resolves each named member key into delegate options only at use time', async () => {
    const reads: string[] = [];
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockImplementation(async (name) => {
        reads.push(name);
        return `resolved-${name}`;
      });
    try {
      await owner().store.saveProfile(
        'chutes',
        standardProfile({ 'auth-key-name': 'chutes' }),
      );
      await owner().store.saveProfile(
        'router',
        standardProfile({ 'auth-key-name': 'openrouter' }),
      );
      await owner().application.applySnapshot({
        ...standardProfile(),
        type: 'loadbalancer',
        profiles: ['chutes', 'router'],
        policy: 'roundrobin',
      });
      expect(reads).toStrictEqual([]);
      const members = loadBalancer(owner()).getLoadBalancerConfig().subProfiles;
      const first = members[0];
      const second = members[1];
      if (!isResolvedSubProfile(first) || !isResolvedSubProfile(second))
        throw new Error('Expected resolved members');
      expect(first.authToken).toBeUndefined();
      expect(second.authToken).toBeUndefined();
      const firstOptions = await options(first);
      expect(firstOptions.resolved?.authToken).toBe('resolved-chutes');
      expect(firstOptions.metadata?.profileId).toBe('chutes');
      expect(reads).toStrictEqual(['chutes']);
      const secondOptions = await options(second);
      expect(secondOptions.resolved?.authToken).toBe('resolved-openrouter');
      expect(secondOptions.metadata?.profileId).toBe('router');
      expect(first.authToken).toBeUndefined();
      expect(second.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('reads a rotated named key without caching plaintext', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(' key-A ');
    try {
      const resolved = await member(owner(), { 'auth-key-name': 'chutes' });
      const first = await options(resolved);
      storage.mockResolvedValue(' key-B ');
      const second = await options(resolved);
      expect(first.resolved?.authToken).toBe('key-A');
      expect(second.resolved?.authToken).toBe('key-B');
      expect(resolved.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('reads keyfile rotation between attempts without storing plaintext', async () => {
    const keyfile = join(owner().directory, 'rotating');
    await writeFile(keyfile, ' first-file-key ');
    const resolved = await member(owner(), { 'auth-keyfile': keyfile });
    const first = await options(resolved);
    await writeFile(keyfile, ' second-file-key ');
    const second = await options(resolved);
    expect([
      first.resolved?.authToken,
      second.resolved?.authToken,
    ]).toStrictEqual(['first-file-key', 'second-file-key']);
    expect(resolved.authToken).toBeUndefined();
  });

  it('prefers explicit auth-key over auth-key-name', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockImplementation(async () => {
        throw new Error('Named key must not be read');
      });
    try {
      const resolved = await member(owner(), {
        'auth-key': 'direct-key',
        'auth-key-name': 'chutes',
      });
      expect(resolved.authKeyName).toBeUndefined();
      expect((await options(resolved)).resolved?.authToken).toBe('direct-key');
    } finally {
      storage.mockRestore();
    }
  });

  it('continues without a token when the named key is missing at use time', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(null);
    try {
      const resolved = await member(owner(), { 'auth-key-name': 'missing' });
      expect(resolved.authKeyName).toBe('missing');
      expect((await options(resolved)).resolved?.authToken).toBeUndefined();
      expect(resolved.authToken).toBeUndefined();
    } finally {
      storage.mockRestore();
    }
  });

  it('falls back to the rotated member keyfile when the named key is missing', async () => {
    const storage = vi
      .spyOn(createProviderKeyStorage(), 'getKey')
      .mockResolvedValue(null);
    try {
      const keyfile = join(owner().directory, 'fallback');
      await writeFile(keyfile, 'stale-file-key');
      const resolved = await member(owner(), {
        'auth-key-name': 'missing',
        'auth-keyfile': keyfile,
      });
      await writeFile(keyfile, ' fresh-file-key ');
      expect((await options(resolved)).resolved?.authToken).toBe(
        'fresh-file-key',
      );
      expect(resolved.authToken).toBeUndefined();
      expect(resolved.authKeyfile).toBe(keyfile);
    } finally {
      storage.mockRestore();
    }
  });
});
