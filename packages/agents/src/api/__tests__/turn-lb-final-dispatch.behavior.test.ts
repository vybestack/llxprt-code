/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import {
  ProfileManager,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { successful, withOwners } from './turn-revision-capture.fixture.js';
import { usePromptFixture } from './helpers/prompt-fixture.js';
import {
  InMemoryProviderKeyStorage,
  OwnedCredentialFixture,
} from './helpers/owned-credential-fixture.js';

function barrier(): {
  entered: Promise<void>;
  release(): void;
  wait(): Promise<void>;
} {
  let enter = (): void => {
    throw new Error('Uninitialized barrier');
  };
  let release = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await held;
    },
  };
}

const HELD_KEY = 'held-member-key';

/**
 * The key storage behind the agent's credential authority. The second read of
 * the member key waits for the test; with `revokeAfterHeldRead` the key is
 * gone for every later read.
 */
class HeldSecondRead extends InMemoryProviderKeyStorage {
  private reads = 0;

  constructor(
    private readonly held: { wait(): Promise<void> },
    private readonly revokeAfterHeldRead: boolean,
  ) {
    super();
  }

  override async getKey(name: string): Promise<string | null> {
    this.reads++;
    if (this.reads !== 2) return super.getKey(name);
    await this.held.wait();
    const value = await super.getKey(name);
    if (this.revokeAfterHeldRead) await this.deleteKey(name);
    return value;
  }
}

async function openHeldCredentials(
  held: { wait(): Promise<void> },
  revokeAfterHeldRead: boolean,
): Promise<OwnedCredentialFixture> {
  const storage = new HeldSecondRead(held, revokeAfterHeldRead);
  await storage.saveKey(HELD_KEY, 'old-resolved-secret');
  return OwnedCredentialFixture.create(undefined, storage);
}

const lb = (policy: 'roundrobin' | 'failover'): LoadBalancerProfile => ({
  version: 1,
  type: 'loadbalancer',
  provider: '',
  model: '',
  modelParams: {},
  ephemeralSettings: {},
  policy,
  profiles:
    policy === 'failover'
      ? ['same-label-held-member', 'spare-held-member']
      : ['same-label-held-member'],
});

async function saveOriginalMembers(
  profiles: ProfileManager,
  policy: 'roundrobin' | 'failover',
  url: string,
): Promise<void> {
  await profiles.saveProfile('same-label-held-member', {
    version: 1,
    provider: 'openai',
    model: 'held-original',
    modelParams: {},
    ephemeralSettings: { 'base-url': url, 'auth-key-name': HELD_KEY },
  });
  if (policy === 'failover') {
    await profiles.saveProfile('spare-held-member', {
      version: 1,
      provider: 'openai',
      model: 'spare-original',
      modelParams: {},
      ephemeralSettings: {
        'base-url': url,
        'auth-key': 'spare-original-secret',
      },
    });
  }
}

async function saveReplacementMembers(
  profiles: ProfileManager,
  policy: 'roundrobin' | 'failover',
  url: string,
): Promise<void> {
  await profiles.saveProfile('same-label-held-member', {
    version: 1,
    provider: 'openai',
    model: 'held-replacement',
    modelParams: {},
    ephemeralSettings: { 'base-url': url, 'auth-key': 'replacement-secret' },
  });
  if (policy === 'failover') {
    await profiles.saveProfile('spare-held-member', {
      version: 1,
      provider: 'openai',
      model: 'spare-replacement',
      modelParams: {},
      ephemeralSettings: {
        'base-url': url,
        'auth-key': 'spare-replacement-secret',
      },
    });
  }
}

describe('Final LB delegate authorization after asynchronous member authentication', () => {
  usePromptFixture();

  for (const policy of ['roundrobin', 'failover'] as const) {
    it(`rejects active ${policy} replacement and preserves admitted members independently of a same-label sibling`, async () => {
      const held = barrier();
      const credentials = await openHeldCredentials(held, false);
      try {
        await withOwners(
          async (a, b, oldEndpoint, newEndpoint, start) => {
            const profiles = new ProfileManager();
            await saveOriginalMembers(profiles, policy, oldEndpoint.url);
            await a.profiles.applySnapshot(lb(policy));
            try {
              const admission = start(a, 'Held LB authorization');
              await held.entered;
              await saveReplacementMembers(profiles, policy, newEndpoint.url);
              await expect(
                a.profiles.applySnapshot(lb(policy)),
              ).rejects.toBeInstanceOf(AgentBusyError);
              const sibling = start(b, 'Same-label independent sibling');
              held.release();
              oldEndpoint.release();
              successful(await sibling);
              successful(await admission);
              expect(
                oldEndpoint.requests().map(({ model }) => model),
              ).toStrictEqual(['held-original']);
              await a.profiles.applySnapshot(lb(policy));
              successful(await start(a, 'New LB member admission'));
              expect(
                newEndpoint.requests().map(({ model }) => model),
              ).toStrictEqual(['capture-b', 'held-replacement']);
            } finally {
              held.release();
            }
          },
          false,
          false,
          1,
          0,
          false,
          413,
          'Transport completed.',
          credentials.authority,
        );
      } finally {
        held.release();
        await credentials.dispose();
      }
    }, 30_000);
  }

  it('blocks a revoked external member key after an asynchronous lookup without replacing the owner route', async () => {
    const held = barrier();
    const credentials = await openHeldCredentials(held, true);
    try {
      await withOwners(
        async (a, _b, oldEndpoint, _newEndpoint, start) => {
          const profiles = new ProfileManager();
          await profiles.saveProfile('same-label-held-member', {
            version: 1,
            provider: 'openai',
            model: 'held-original',
            modelParams: {},
            ephemeralSettings: {
              'base-url': oldEndpoint.url,
              'auth-key-name': HELD_KEY,
            },
          });
          await a.profiles.applySnapshot(lb('roundrobin'));
          try {
            const admission = start(a, 'Held key revocation');
            await held.entered;
            held.release();
            oldEndpoint.release();
            expect(
              (await admission).events.some((event) => event.type === 'error'),
            ).toBe(true);
            expect(oldEndpoint.requests()).toHaveLength(0);
          } finally {
            held.release();
          }
        },
        false,
        false,
        1,
        0,
        false,
        413,
        'Transport completed.',
        credentials.authority,
      );
    } finally {
      held.release();
      await credentials.dispose();
    }
  }, 30_000);
});
