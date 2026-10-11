/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createProviderConfigFixture } from '../runtime/__tests__/provider-config-fixture.js';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  ProfileManager,
  SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import { OAuthManager } from './oauth-manager.js';
import { registerStandardOAuthProviders } from '../composition/oauth-provider-registration.js';
import {
  MemoryTokenStore,
  createTestProvider,
} from './__tests__/behavioral/test-utils.js';

function token(account: string): OAuthToken {
  return {
    access_token: `access-${account}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
  };
}

function owner(
  profile: string,
  store: MemoryTokenStore,
  profileDirectory?: string,
): {
  config: Config;
  settings: SettingsService;
  oauth: OAuthManager;
} {
  const settings = new SettingsService();
  settings.setCurrentProfileName(profile);
  const { config: config } = createProviderConfigFixture({
    sessionId: profile,
    profileDirectory,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'gpt-5',
    settingsService: settings,
  });
  const oauth = new OAuthManager(store, undefined, {
    config,
    readSessionAuthPolicy: () => ({
      profileName: settings.getCurrentProfileName(),
      noBrowser: settings.get('auth.noBrowser') === true,
      authOnly: settings.get('authOnly') === true,
      bucketPrompt: settings.get('auth-bucket-prompt'),
      bucketDelay: settings.get('auth-bucket-delay'),
      interactiveTimeoutMs: settings.get('auth-interactive-timeout-ms'),
    }),
  });
  registerStandardOAuthProviders(oauth);
  return { config, settings, oauth };
}

describe('OAuth ownership (#2616)', () => {
  it('selects same-label profile buckets from each explicitly chosen definition directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oauth-profile-owner-'));
    const store = new MemoryTokenStore();
    await store.saveToken('codex', token('alpha'), 'alpha');
    await store.saveToken('codex', token('beta'), 'beta');
    const directoryA = join(root, 'a');
    const directoryB = join(root, 'b');
    const owners: Array<ReturnType<typeof owner>> = [];
    try {
      for (const [directory, bucket] of [
        [directoryA, 'alpha'],
        [directoryB, 'beta'],
      ]) {
        const profiles = new ProfileManager(directory);
        await profiles.saveProfile('equal-label', {
          version: 1,
          provider: 'codex',
          model: 'gpt-5',
          modelParams: {},
          ephemeralSettings: {},
          auth: { type: 'oauth', buckets: [bucket] },
        });
        owners.push(owner('equal-label', store, directory));
      }
      const first = owners[0];
      const second = owners[1];
      const readB = second.oauth.getOAuthToken('codex');
      const readA = first.oauth.getOAuthToken('codex');
      expect((await readB)?.access_token).toBe('access-beta');
      expect((await readA)?.access_token).toBe('access-alpha');
      await first.config.dispose();
      expect((await second.oauth.getOAuthToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    } finally {
      await Promise.allSettled(owners.map(({ config }) => config.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  function useOwners(): () => {
    first: ReturnType<typeof owner>;
    second: ReturnType<typeof owner>;
    profileA: string;
    profileB: string;
    missingProfile: string;
    store: MemoryTokenStore;
  } {
    let fixture: ReturnType<ReturnType<typeof useOwners>>;
    let profiles: ProfileManager;

    beforeEach(async () => {
      if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
        throw new Error(
          'OAuth owner tests require the storage isolation preload',
        );
      }
      const suffix = randomUUID();
      const profileA = `oauth-owner-a-${suffix}`;
      const profileB = `oauth-owner-b-${suffix}`;
      profiles = new ProfileManager();
      for (const [name, bucket] of [
        [profileA, 'alpha'],
        [profileB, 'beta'],
      ]) {
        await profiles.saveProfile(name, {
          version: 1,
          provider: 'codex',
          model: 'gpt-5',
          modelParams: {},
          ephemeralSettings: {},
          auth: { type: 'oauth', buckets: [bucket] },
        });
      }
      const store = new MemoryTokenStore();
      await store.saveToken('codex', token('alpha'), 'alpha');
      await store.saveToken('codex', token('beta'), 'beta');
      await store.saveToken('codex', token('default'));
      fixture = {
        first: owner(profileA, store),
        second: owner(profileB, store),
        profileA,
        profileB,
        missingProfile: `oauth-owner-missing-${suffix}`,
        store,
      };
    });

    afterEach(async () => {
      await fixture.first.oauth.configureProactiveRenewalsForProfile({});
      await fixture.second.oauth.configureProactiveRenewalsForProfile({});
      await fixture.first.config.dispose();
      await fixture.second.config.dispose();
      await profiles.deleteProfile(fixture.profileA);
      await profiles.deleteProfile(fixture.profileB);
    });

    return () => fixture;
  }

  describe('OAuth explicit request characterization outside identity ALS (#2616)', () => {
    const owners = useOwners();

    it('explicit requested profiles select distinct accounts when owners interleave', async () => {
      const { first, second, profileA, profileB } = owners();
      const firstRead = first.oauth.getOAuthToken('codex', {
        profileId: profileA,
      });
      const secondRead = second.oauth.getOAuthToken('codex', {
        profileId: profileB,
      });
      expect((await secondRead)?.access_token).toBe('access-beta');
      expect((await firstRead)?.access_token).toBe('access-alpha');
      expect(
        (await first.oauth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('explicit requested profiles override the owning settings profile', async () => {
      const { first, second, profileA, profileB } = owners();
      expect(
        (await first.oauth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        (await second.oauth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('explicit bucket strings override the owning settings profile', async () => {
      const { first, second } = owners();
      expect(
        (await first.oauth.getOAuthToken('codex', 'beta'))?.access_token,
      ).toBe('access-beta');
      expect(
        (await second.oauth.getOAuthToken('codex', 'alpha'))?.access_token,
      ).toBe('access-alpha');
    });

    it('a missing explicitly requested profile rejects rather than borrowing a default token', async () => {
      const { first, missingProfile } = owners();
      await expect(
        first.oauth.getOAuthToken('codex', { profileId: missingProfile }),
      ).rejects.toThrow(missingProfile);
    });

    it('profile-scoped session bucket overrides remain on the manager that set them', async () => {
      const { first, second, profileA } = owners();
      first.oauth.setSessionBucket('codex', 'beta', { profileId: profileA });
      expect(
        (await first.oauth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        (await second.oauth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('an explicitly selected bucket logout leaves the other account usable', async () => {
      const { first, second, profileA, profileB, store } = owners();
      await first.oauth.logout('codex', 'alpha');
      expect(await store.getToken('codex', 'alpha')).toBeNull();
      expect(
        (await second.oauth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        await second.oauth.getOAuthToken('codex', { profileId: profileA }),
      ).toBeNull();
    });
  });

  describe('OAuth owner requirements outside identity ALS (#2616)', () => {
    const owners = useOwners();

    it('implicit stored-token reads follow each owner through interleaved profile changes', async () => {
      const { first, second, profileB } = owners();
      const firstRead = first.oauth.peekStoredToken('codex');
      const secondRead = second.oauth.peekStoredToken('codex');
      expect((await secondRead)?.access_token).toBe('access-beta');
      expect((await firstRead)?.access_token).toBe('access-alpha');
      first.settings.setCurrentProfileName(profileB);
      expect((await first.oauth.peekStoredToken('codex'))?.access_token).toBe(
        'access-beta',
      );
      expect((await second.oauth.peekStoredToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    });

    it('implicit refresh uses the owner account when another process already replaced the token', async () => {
      const { first, second } = owners();
      const firstRefresh = first.oauth.forceRefreshToken(
        'codex',
        'replaced-alpha',
      );
      const secondRefresh = second.oauth.forceRefreshToken(
        'codex',
        'replaced-beta',
      );
      expect((await secondRefresh)?.access_token).toBe('access-beta');
      expect((await firstRefresh)?.access_token).toBe('access-alpha');
    });

    it('bucket status identifies each owner session rather than the shared default', async () => {
      const { first, second } = owners();
      const firstStatus = first.oauth.getAuthStatusWithBuckets('codex');
      const secondStatus = second.oauth.getAuthStatusWithBuckets('codex');
      expect(
        (await secondStatus)
          .filter((entry) => entry.isSessionBucket)
          .map((entry) => entry.bucket),
      ).toStrictEqual(['beta']);
      expect(
        (await firstStatus)
          .filter((entry) => entry.isSessionBucket)
          .map((entry) => entry.bucket),
      ).toStrictEqual(['alpha']);
    });

    it('implicit logout removes only the owner profile account', async () => {
      const { first, second, profileB, store } = owners();
      await first.oauth.logout('codex');
      expect(await store.getToken('codex', 'alpha')).toBeNull();
      expect((await store.getToken('codex'))?.access_token).toBe(
        'access-default',
      );
      expect(
        (await second.oauth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
    });

    it('single-bucket authentication uses the owner prompt setting without runtime registration', async () => {
      const { first, second } = owners();
      for (const current of [first, second]) {
        current.oauth.registerProvider(createTestProvider('owner-prompt'));
        await current.oauth.toggleOAuthEnabled('owner-prompt');
      }
      first.settings.set('auth-bucket-prompt', true);
      second.settings.set('auth-bucket-prompt', false);
      await expect(
        first.oauth.getToken('owner-prompt', 'alpha'),
      ).rejects.toThrow('requires a runtime MessageBus');
      expect(await second.oauth.getToken('owner-prompt', 'beta')).toBe(
        'initiated-owner-prompt',
      );
    });

    it('disposing another owner leaves implicit account selection intact', async () => {
      const { first, second } = owners();
      await first.config.dispose();
      expect((await second.oauth.getOAuthToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    });

    it('multi-bucket auth recognizes existing tokens without runtime registration', async () => {
      const { first, second, store } = owners();
      await Promise.all([
        first.oauth.authenticateMultipleBuckets('codex', ['alpha', 'beta']),
        second.oauth.authenticateMultipleBuckets('codex', ['beta', 'alpha']),
      ]);
      expect(await store.listBuckets('codex')).toStrictEqual([
        'alpha',
        'beta',
        'default',
      ]);
    });
  });
});
