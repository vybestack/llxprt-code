/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { fromConfig } from '../fromConfig.js';
import {
  OAuthManager,
  AnthropicOAuthProvider,
  CodexOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './helpers/provider-auth-fixtures.js';
import {
  useProfileOwner,
  standardProfile,
} from './helpers/profile-owner-fixture.js';

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

describe('profile postcommit sibling lifetime', () => {
  const owner = useProfileOwner();
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
    const published = (): void => {
      postcommit = true;
    };
    coreEvents.on(CoreEvent.ModelProfileChanged, published);
    class Store extends MemoryTokenStore {
      override async getToken(
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> {
        if (postcommit && provider === 'codex') {
          failed.release();
          throw failure;
        }
        if (postcommit && provider === 'claudecode') {
          entered.release();
          await release.promise;
        }
        return super.getToken(provider, bucket);
      }
    }
    const store = new Store();
    const oauth = new OAuthManager(store, undefined, {
      config: owner().config,
      messageBus: owner().messageBus,
    });
    oauth.registerProvider(new CodexOAuthProvider(store));
    oauth.registerProvider(new AnthropicOAuthProvider(store));
    for (const provider of ['codex', 'claudecode']) {
      const model = new FakeProvider(
        fileURLToPath(new URL('./fixtures/plain-text.jsonl', import.meta.url)),
        owner().directory,
      );
      model.name = provider;
      model.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
      owner().manager.registerProvider(model);
      await oauth.toggleOAuthEnabled(provider);
      for (const bucket of ['primary', 'secondary'])
        await store.saveToken(
          provider,
          makeExpiredToken(`${provider}-${bucket}`),
          `${provider}-${bucket}`,
        );
    }
    const member = standardProfile();
    if (member.type === 'loadbalancer')
      throw new Error('Expected standard profile');
    for (const provider of ['codex', 'claudecode'])
      await owner().store.saveProfile(provider, {
        ...member,
        provider,
        auth: {
          type: 'oauth',
          buckets: [`${provider}-primary`, `${provider}-secondary`],
        },
      });
    const agent = await fromConfig({
      oauthManager: oauth,
      settingsOwner: owner().settingsOwner,
      settingsService: owner().settingsService,
      providerManager: owner().providerManager,
      config: owner().config,
      mcpRuntime: owner().mcpRuntime,
      messageBus: owner().messageBus,
    });
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init) => {
        if (
          String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
          !(init?.body instanceof URLSearchParams) ||
          init.body.get('grant_type') !== 'refresh_token'
        )
          throw new Error(`Unexpected network request: ${String(input)}`);
        return Response.json({
          access_token: 'native-rotated-access',
          refresh_token: 'native-rotated-refresh',
          expires_in: 120,
        });
      },
    );
    let settled = false;
    const operation = agent.profiles
      .applySnapshot(
        {
          version: 1,
          type: 'loadbalancer',
          policy: 'roundrobin',
          profiles: ['codex', 'claudecode'],
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
        (await store.getToken('claudecode', 'claudecode-primary'))
          ?.access_token,
      ).toBe('native-rotated-access');
      expect(await store.getToken('claudecode', 'default')).toBeNull();
      expect(
        oauth.getSessionBucket('claudecode', {
          providerId: 'claudecode',
          profileId: 'claudecode',
        }),
      ).toBe('claudecode-primary');
      coreEvents.off(CoreEvent.ModelProfileChanged, published);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: 'fake',
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
      coreEvents.off(CoreEvent.ModelProfileChanged, published);
      process.off('unhandledRejection', onUnhandled);
      await agent.dispose();
      transport.mockRestore();
    }
  }, 30000);
});
