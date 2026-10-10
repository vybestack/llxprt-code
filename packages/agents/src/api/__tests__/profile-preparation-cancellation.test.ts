/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  MemoryTokenStore,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

describe('profile-preparation-cancellation', () => {
  it.each([false, true])(
    'disposal joins all profile token reads without late publication (sibling fails: %s)',
    async (siblingFails) => {
      const built = await buildCliStyleConfig('multi-turn-text.jsonl');
      const other = await buildCliStyleConfig('plain-text.jsonl');
      const entered = gate();
      const release = gate();
      class PausedStore extends MemoryTokenStore {
        override async getToken(provider: string, bucket?: string) {
          if (bucket === 'failure')
            throw new Error('Sibling token read failed');
          entered.resolve();
          await release.promise;
          return super.getToken(provider, bucket);
        }
      }
      const store = new PausedStore();
      await store.saveToken('fake', makeToken('candidate'), 'candidate');
      const oauth = new OAuthManager(store, undefined, {
        config: built.config,
        messageBus: built.messageBus,
      });
      oauth.registerProvider({
        name: 'fake',
        initiateAuth: async () => {
          throw new Error('Unexpected auth');
        },
        getToken: async () => null,
        refreshToken: async () => null,
      });
      await oauth.toggleOAuthEnabled('fake');
      const agent = await fromConfig({
        oauthManager: oauth,
        providerFileLifecycle: built.runtime.providerFileLifecycle,
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      const ownerB = await fromConfig({
        settingsOwner: other.settingsOwner,
        settingsService: other.settingsService,
        providerManager: other.providerManager,
        config: other.config,
        mcpRuntime: other.mcpRuntime,
        messageBus: other.messageBus,
      });
      const client = built.agentClient;
      const before = agent.captureProfile();
      const notifications: unknown[] = [];
      const notice = (value: unknown): void => {
        notifications.push(value);
      };
      coreEvents.on(CoreEvent.ModelProfileChanged, notice);
      let disposed = false;
      const application = agent.profiles.applySnapshot({
        version: 1,
        provider: 'fake',
        model: 'must-not-publish',
        modelParams: {},
        ephemeralSettings: {},
        auth: {
          type: 'oauth',
          buckets: siblingFails ? ['candidate', 'failure'] : ['candidate'],
        },
      });
      const outcome = application.then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        await entered.promise;
        const disposal = agent.dispose().then(() => {
          disposed = true;
        });
        const otherEvents = [];
        for await (const event of ownerB.stream('while A cancels'))
          otherEvents.push(event);
        expect(otherEvents.some((event) => event.type === 'error')).toBe(false);
        expect(disposed).toBe(false);
        release.resolve();
        expect(await outcome).toBeInstanceOf(Error);
        await disposal;
        expect(agent.captureProfile()).toStrictEqual(before);
        expect(notifications).toStrictEqual([]);
        expect(built.sessionClient.getAgentClient()).toBe(client);
        const nextOwner = await fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          messageBus: built.messageBus,
        });
        try {
          const events = [];
          for await (const event of nextOwner.stream(
            'borrowed owner still usable',
          ))
            events.push(event);
          expect(events.some((event) => event.type === 'error')).toBe(false);
          await nextOwner.profiles.applySnapshot({
            ...before,
            model: 'retry-succeeds',
          });
          expect(nextOwner.getModel()).toBe('retry-succeeds');
        } finally {
          await nextOwner.dispose();
        }
      } finally {
        release.resolve();
        await outcome;
        coreEvents.off(CoreEvent.ModelProfileChanged, notice);
        await agent.dispose();
        await ownerB.dispose();
        await other.cleanup();
        await built.cleanup();
      }
    },
    30000,
  );
});
