/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  installOwnedConfig,
  installBorrowedConfigSettings,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();
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

function createOAuth(
  config: Config,
  settings: SettingsService,
  store: MemoryTokenStore,
): OAuthManager {
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
  registerStandardOAuthProviders(oauth, globalThis.fetch);
  return oauth;
}
function createConfig(
  profile: string,
  settings: SettingsService,
  profileDirectory?: string,
): Config {
  settings.setCurrentProfileName(profile);
  const config = acquireConfig({
    sessionId: profile,
    profileDirectory,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'gpt-5',
  });
  acquireSettings(config, settings);
  return config;
}
describe('OAuth ownership (#2616)', () => {
  it('selects same-label profile buckets from each explicitly chosen definition directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oauth-profile-owner-'));
    const store = new MemoryTokenStore();
    await store.saveToken('codex', token('alpha'), 'alpha');
    await store.saveToken('codex', token('beta'), 'beta');
    const directoryA = join(root, 'a');
    const directoryB = join(root, 'b');
    const configs: Config[] = [];
    const oauths: OAuthManager[] = [];
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
        const settings = new SettingsService();
        const config = createConfig('equal-label', settings, directory);
        configs.push(config);
        oauths.push(createOAuth(config, settings, store));
      }
      const firstOAuth = oauths[0];
      const secondOAuth = oauths[1];
      const firstConfig = configs[0];
      const readB = secondOAuth.getOAuthToken('codex');
      const readA = firstOAuth.getOAuthToken('codex');
      expect((await readB)?.access_token).toBe('access-beta');
      expect((await readA)?.access_token).toBe('access-alpha');
      await firstConfig.dispose();
      expect((await secondOAuth.getOAuthToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    } finally {
      await Promise.allSettled(configs.map((config) => config.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  let firstConfig: Config;
  let secondConfig: Config;
  let firstSettings: SettingsService;
  let secondSettings: SettingsService;
  let firstOAuth: OAuthManager;
  let secondOAuth: OAuthManager;
  let profileA: string;
  let profileB: string;
  let missingProfile: string;
  let store: MemoryTokenStore;
  function installOwners(): void {
    let profiles: ProfileManager;

    beforeEach(async () => {
      if (process.env.LLXPRT_TEST_STORAGE_ISOLATED !== '1') {
        throw new Error(
          'OAuth owner tests require the storage isolation preload',
        );
      }
      const suffix = randomUUID();
      profileA = `oauth-owner-a-${suffix}`;
      profileB = `oauth-owner-b-${suffix}`;
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
      store = new MemoryTokenStore();
      await store.saveToken('codex', token('alpha'), 'alpha');
      await store.saveToken('codex', token('beta'), 'beta');
      await store.saveToken('codex', token('default'));
      firstSettings = new SettingsService();
      secondSettings = new SettingsService();
      firstConfig = createConfig(profileA, firstSettings);
      secondConfig = createConfig(profileB, secondSettings);
      firstOAuth = createOAuth(firstConfig, firstSettings, store);
      secondOAuth = createOAuth(secondConfig, secondSettings, store);
      missingProfile = `oauth-owner-missing-${suffix}`;
    });

    afterEach(async () => {
      await firstOAuth.configureProactiveRenewalsForProfile({});
      await secondOAuth.configureProactiveRenewalsForProfile({});
      await firstConfig.dispose();
      await secondConfig.dispose();
      await profiles.deleteProfile(profileA);
      await profiles.deleteProfile(profileB);
    });
  }

  describe('OAuth explicit request characterization outside identity ALS (#2616)', () => {
    installOwners();

    it('explicit requested profiles select distinct accounts when owners interleave', async () => {
      const firstRead = firstOAuth.getOAuthToken('codex', {
        profileId: profileA,
      });
      const secondRead = secondOAuth.getOAuthToken('codex', {
        profileId: profileB,
      });
      expect((await secondRead)?.access_token).toBe('access-beta');
      expect((await firstRead)?.access_token).toBe('access-alpha');
      expect(
        (await firstOAuth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('explicit requested profiles override the owning settings profile', async () => {
      expect(
        (await firstOAuth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        (await secondOAuth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('explicit bucket strings override the owning settings profile', async () => {
      expect(
        (await firstOAuth.getOAuthToken('codex', 'beta'))?.access_token,
      ).toBe('access-beta');
      expect(
        (await secondOAuth.getOAuthToken('codex', 'alpha'))?.access_token,
      ).toBe('access-alpha');
    });

    it('a missing explicitly requested profile rejects rather than borrowing a default token', async () => {
      await expect(
        firstOAuth.getOAuthToken('codex', { profileId: missingProfile }),
      ).rejects.toThrow(missingProfile);
    });

    it('profile-scoped session bucket overrides remain on the manager that set them', async () => {
      firstOAuth.setSessionBucket('codex', 'beta', { profileId: profileA });
      expect(
        (await firstOAuth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        (await secondOAuth.getOAuthToken('codex', { profileId: profileA }))
          ?.access_token,
      ).toBe('access-alpha');
    });

    it('an explicitly selected bucket logout leaves the other account usable', async () => {
      await firstOAuth.logout('codex', 'alpha');
      expect(await store.getToken('codex', 'alpha')).toBeNull();
      expect(
        (await secondOAuth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
      expect(
        await secondOAuth.getOAuthToken('codex', { profileId: profileA }),
      ).toBeNull();
    });
  });

  describe('OAuth owner requirements outside identity ALS (#2616)', () => {
    installOwners();

    it('implicit stored-token reads follow each owner through interleaved profile changes', async () => {
      const firstRead = firstOAuth.peekStoredToken('codex');
      const secondRead = secondOAuth.peekStoredToken('codex');
      expect((await secondRead)?.access_token).toBe('access-beta');
      expect((await firstRead)?.access_token).toBe('access-alpha');
      firstSettings.setCurrentProfileName(profileB);
      expect((await firstOAuth.peekStoredToken('codex'))?.access_token).toBe(
        'access-beta',
      );
      expect((await secondOAuth.peekStoredToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    });

    it('implicit refresh uses the owner account when another process already replaced the token', async () => {
      const firstRefresh = firstOAuth.forceRefreshToken(
        'codex',
        'replaced-alpha',
      );
      const secondRefresh = secondOAuth.forceRefreshToken(
        'codex',
        'replaced-beta',
      );
      expect((await secondRefresh)?.access_token).toBe('access-beta');
      expect((await firstRefresh)?.access_token).toBe('access-alpha');
    });

    it('bucket status identifies each owner session rather than the shared default', async () => {
      const firstStatus = firstOAuth.getAuthStatusWithBuckets('codex');
      const secondStatus = secondOAuth.getAuthStatusWithBuckets('codex');
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
      await firstOAuth.logout('codex');
      expect(await store.getToken('codex', 'alpha')).toBeNull();
      expect((await store.getToken('codex'))?.access_token).toBe(
        'access-default',
      );
      expect(
        (await secondOAuth.getOAuthToken('codex', { profileId: profileB }))
          ?.access_token,
      ).toBe('access-beta');
    });

    it('single-bucket authentication uses the owner prompt setting without runtime registration', async () => {
      for (const oauth of [firstOAuth, secondOAuth]) {
        oauth.registerProvider(createTestProvider('owner-prompt'));
        await oauth.toggleOAuthEnabled('owner-prompt');
      }
      firstSettings.set('auth-bucket-prompt', true);
      secondSettings.set('auth-bucket-prompt', false);
      await expect(
        firstOAuth.getToken('owner-prompt', 'alpha'),
      ).rejects.toThrow('requires a runtime MessageBus');
      expect(await secondOAuth.getToken('owner-prompt', 'beta')).toBe(
        'initiated-owner-prompt',
      );
    });

    it('disposing another owner leaves implicit account selection intact', async () => {
      await firstConfig.dispose();
      expect((await secondOAuth.getOAuthToken('codex'))?.access_token).toBe(
        'access-beta',
      );
    });

    it('multi-bucket auth recognizes existing tokens without runtime registration', async () => {
      await Promise.all([
        firstOAuth.authenticateMultipleBuckets('codex', ['alpha', 'beta']),
        secondOAuth.authenticateMultipleBuckets('codex', ['beta', 'alpha']),
      ]);
      expect(await store.listBuckets('codex')).toStrictEqual([
        'alpha',
        'beta',
        'default',
      ]);
    });
  });
});
