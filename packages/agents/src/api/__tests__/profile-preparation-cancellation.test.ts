/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import type { Agent } from '../agent.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { openRouteAAgent } from './helpers/route-a-agent.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import {
  MemoryTokenStore,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

/** The authority a host passes when it owns the token store its agent reads. */
function authorityOverTokenStore(store: TokenStore): CredentialAuthority {
  return new (class extends CredentialAuthority {
    override createTokenStore(): TokenStore {
      return store;
    }
  })();
}

/**
 * An agent built through the foreground preflight route over a host-supplied
 * token store. `subscribeModelChanges` is the preflight's public read of the
 * model-change notifications the agent's profile applications publish.
 */
async function openAgentOverTokenStore(store: TokenStore): Promise<{
  readonly agent: Agent;
  readonly settings: SettingsService;
  readonly subscribeModelChanges: (
    listener: (profile: unknown) => void,
  ) => () => void;
  readonly close: () => Promise<void>;
}> {
  const route = await openRouteBPreflight({
    authority: authorityOverTokenStore(store),
  });
  let agent: Agent | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([() => agent?.dispose(), () => route.close()]);
  try {
    await route.prepare();
    agent = await route.createAgent();
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  return {
    agent,
    settings: route.settings,
    subscribeModelChanges: (listener) =>
      route.preflight.subscribeModelChanges(listener),
    close,
  };
}

/** What the host's own settings store holds for the profile, readable after the agent is disposed. */
function readHostProfile(settings: SettingsService): unknown {
  return structuredClone({
    activeProvider: settings.get('activeProvider'),
    providerSettings: settings.getProviderSettings('fake'),
    ephemeralSettings: settings.getAllGlobalSettings(),
  });
}

async function streamWithoutError(agent: Agent, text: string): Promise<void> {
  for await (const event of agent.stream(text)) {
    if (event.type === 'error') throw new Error(event.error.message);
  }
}

describe('profile-preparation-cancellation', () => {
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

  const useReplay = useFakeResponsesReplay('multi-turn-text.jsonl');
  const otherCredentials = useOwnedCredentials();
  beforeEach(async () => {
    const home = process.env.LLXPRT_CONFIG_HOME;
    if (home === undefined) throw new Error('Missing temporary config home');
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { fake: true } }),
    );
  });

  it.each([false, true])(
    'disposal joins all profile token reads without late publication (sibling fails: %s)',
    async (siblingFails) => {
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
      const owner = await openAgentOverTokenStore(store);
      const { agent } = owner;
      useReplay('plain-text.jsonl');
      const other = await openRouteAAgent({
        authority: otherCredentials().authority,
      });
      const ownerB = other.agent;
      const notifications: unknown[] = [];
      const unsubscribe = owner.subscribeModelChanges((value) => {
        notifications.push(value);
      });
      let outcome: Promise<unknown> | undefined;
      try {
        await streamWithoutError(agent, 'start A chat');
        const before = agent.captureProfile();
        const hostBefore = readHostProfile(owner.settings);
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
        outcome = application.then(
          () => undefined,
          (error: unknown) => error,
        );
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
        expect(readHostProfile(owner.settings)).toStrictEqual(hostBefore);
        expect(notifications).toStrictEqual([]);
        const retry = await openAgentOverTokenStore(store);
        try {
          await retry.agent.profiles.applySnapshot({
            ...before,
            model: 'retry-succeeds',
          });
          expect(retry.agent.getModel()).toBe('retry-succeeds');
        } finally {
          await retry.close();
        }
      } finally {
        release.resolve();
        await outcome;
        unsubscribe();
        await runCleanupSteps([() => owner.close(), () => other.close()]);
      }
    },
    30000,
  );
});
