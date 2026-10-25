import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { OAuthToken } from '@vybestack/llxprt-code-auth';
import { createAgent } from '../createAgent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './helpers/provider-auth-fixtures.js';
import { standardProfile } from './helpers/profile-owner-fixture.js';
import { enableOAuthProviders } from './helpers/oauth-contribution.js';
import { createRefreshableOAuthContribution } from './helpers/refreshable-oauth-provider.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function causes(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(causes)
    : [error];
}

const failingMember = 'sibling-failing';
const heldMember = 'sibling-held';
// OAuth is not enabled for this alias, so selecting it needs no token.
const plainAlias = 'sibling-plain';

describe('profile postcommit sibling lifetime', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const credentials = useOwnedCredentials();
  const environmentKeys = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_FAKE_RESPONSES',
  ];
  let previousEnvironment: Map<string, string | undefined>;
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'postcommit-siblings-'));
    previousEnvironment = new Map(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    for (const key of environmentKeys) process.env[key] = directory;
    // The fake replay seam would pin every agent to the `fake` provider.
    delete process.env.LLXPRT_FAKE_RESPONSES;
    await enableOAuthProviders(directory, [failingMember, heldMember]);
  });
  afterEach(async () => {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('joins a paused LB member after another fails and uses captured member buckets', async () => {
    const entered = gate();
    const release = gate();
    const failed = gate();
    const failure = new Error('External token store unavailable');
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    let postcommit = false;
    class Store extends MemoryTokenStore {
      override async getToken(
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> {
        if (postcommit && provider === failingMember) {
          failed.release();
          throw failure;
        }
        if (postcommit && provider === heldMember) {
          entered.release();
          await release.promise;
        }
        return super.getToken(provider, bucket);
      }
    }
    const store = new Store();
    const oauthContribution = createRefreshableOAuthContribution([
      {
        alias: plainAlias,
        refresh: async () => {
          throw new Error('The plain alias has no OAuth refresh');
        },
      },
      {
        alias: failingMember,
        refresh: async () => {
          throw new Error('The failing member never reaches a refresh');
        },
      },
      {
        alias: heldMember,
        refresh: async (current) => ({
          ...current,
          access_token: 'native-rotated-access',
          refresh_token: 'native-rotated-refresh',
          expiry: Math.floor(Date.now() / 1000) + 120,
        }),
      },
    ]);
    for (const provider of [failingMember, heldMember]) {
      for (const bucket of ['primary', 'secondary'])
        await store.saveToken(
          provider,
          makeExpiredToken(`${provider}-${bucket}`),
          `${provider}-${bucket}`,
        );
    }
    const agent = await createAgent({
      provider: plainAlias,
      model: 'initial-model',
      workingDir: directory,
      telemetry: { enabled: false },
      recording: { enabled: false },
      interactive: true,
      tokenStore: store,
      credentialAuthority: credentials().authority,
      providerContributions: oauthContribution.contributions,
    });
    const profiles = new ProfileManager();
    const member = standardProfile();
    if (member.type === 'loadbalancer')
      throw new Error('Expected standard profile');
    for (const provider of [failingMember, heldMember])
      await profiles.saveProfile(provider, {
        ...member,
        provider,
        auth: {
          type: 'oauth',
          buckets: [`${provider}-primary`, `${provider}-secondary`],
        },
      });
    agent.settings.subscribeModelChanges((published) => {
      if (published !== undefined) postcommit = true;
    });
    let settled = false;
    const operation = agent.profiles
      .applySnapshot(
        {
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: [failingMember, heldMember],
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
        },
        { profileName: 'parent-not-on-disk' },
      )
      .then(
        (value) => {
          settled = true;
          return { value };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );
    try {
      await Promise.race([
        Promise.all([entered.promise, failed.promise]),
        operation.then((outcome) => {
          if ('error' in outcome) throw outcome.error;
          throw new Error('Application completed before both storage barriers');
        }),
      ]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect({ settled, applying: agent.profiles.isApplying() }).toStrictEqual({
        settled: false,
        applying: true,
      });
      expect(unhandled).toStrictEqual([]);
      release.release();
      const outcome = await operation;
      expect(outcome).toHaveProperty('error.committed', true);
      if (!('error' in outcome))
        throw new Error('Expected committed store failure');
      expect(causes(outcome.error)).toContain(failure);
      postcommit = false;
      expect(
        (await store.getToken(heldMember, `${heldMember}-primary`))
          ?.access_token,
      ).toBe('native-rotated-access');
      expect(await store.getToken(heldMember, 'default')).toBeNull();
      expect(
        oauthContribution.managers[0].getSessionBucket(heldMember, {
          providerId: heldMember,
          profileId: heldMember,
        }),
      ).toBe(`${heldMember}-primary`);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: plainAlias,
        model: 'recovered',
        modelParams: {},
        ephemeralSettings: {},
      });
      const events = [];
      for await (const event of agent.stream('continue after sibling failure', {
        mcpDiscovery: 'skip',
      }))
        events.push(event);
      expect(events.filter((event) => event.type === 'error')).toStrictEqual(
        [],
      );
      expect(events.filter((event) => event.type === 'done')).toStrictEqual([
        { type: 'done', reason: 'stop' },
      ]);
      expect(unhandled).toStrictEqual([]);
    } finally {
      release.release();
      await operation;
      process.off('unhandledRejection', onUnhandled);
      await agent.dispose();
    }
  }, 30000);
});
