/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import {
  ProfileManager,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { createProviderKeyStorage } from '@vybestack/llxprt-code-providers/auth.js';
import { successful, withOwners } from './turn-revision-capture.fixture.js';

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

describe('Final LB delegate authorization after asynchronous member authentication', () => {
  for (const policy of ['roundrobin', 'failover'] as const) {
    it(`blocks the ${policy} stale member HTTP request and admits its replacement independently of a same-label sibling`, async () => {
      await withOwners(async (a, b, oldEndpoint, newEndpoint, start) => {
        const profiles = new ProfileManager();
        await profiles.saveProfile('same-label-held-member', {
          version: 1,
          provider: 'openai',
          model: 'held-original',
          modelParams: {},
          ephemeralSettings: {
            'base-url': oldEndpoint.url,
            'auth-key-name': 'held-member-key',
          },
        });
        if (policy === 'failover') {
          await profiles.saveProfile('spare-held-member', {
            version: 1,
            provider: 'openai',
            model: 'spare-original',
            modelParams: {},
            ephemeralSettings: {
              'base-url': oldEndpoint.url,
              'auth-key': 'spare-original-secret',
            },
          });
        }
        await a.profiles.applySnapshot(lb(policy));
        const held = barrier();
        let reads = 0;
        const storage = vi
          .spyOn(createProviderKeyStorage(), 'getKey')
          .mockImplementation(async () => {
            reads++;
            if (reads === 2) await held.wait();
            return 'old-resolved-secret';
          });
        try {
          const admission = start(a, 'Held LB authorization');
          await held.entered;
          await profiles.saveProfile('same-label-held-member', {
            version: 1,
            provider: 'openai',
            model: 'held-replacement',
            modelParams: {},
            ephemeralSettings: {
              'base-url': newEndpoint.url,
              'auth-key': 'replacement-secret',
            },
          });
          if (policy === 'failover') {
            await profiles.saveProfile('spare-held-member', {
              version: 1,
              provider: 'openai',
              model: 'spare-replacement',
              modelParams: {},
              ephemeralSettings: {
                'base-url': newEndpoint.url,
                'auth-key': 'spare-replacement-secret',
              },
            });
          }
          await a.profiles.applySnapshot(lb(policy));
          const sibling = start(b, 'Same-label independent sibling');
          held.release();
          oldEndpoint.release();
          successful(await sibling);
          expect(
            (await admission).events.some((event) => event.type === 'error'),
          ).toBe(true);
          expect(oldEndpoint.requests()).toHaveLength(0);
          successful(await start(a, 'New LB member admission'));
          expect(
            newEndpoint.requests().map(({ model }) => model),
          ).toStrictEqual(['capture-b', 'held-replacement']);
        } finally {
          held.release();
          storage.mockRestore();
        }
      });
    }, 30_000);
  }

  it('blocks a revoked external member key after an asynchronous lookup without replacing the owner route', async () => {
    await withOwners(async (a, _b, oldEndpoint, _newEndpoint, start) => {
      const profiles = new ProfileManager();
      await profiles.saveProfile('same-label-held-member', {
        version: 1,
        provider: 'openai',
        model: 'held-original',
        modelParams: {},
        ephemeralSettings: {
          'base-url': oldEndpoint.url,
          'auth-key-name': 'held-member-key',
        },
      });
      await a.profiles.applySnapshot(lb('roundrobin'));
      const held = barrier();
      let reads = 0;
      const storage = vi
        .spyOn(createProviderKeyStorage(), 'getKey')
        .mockImplementation(async () => {
          reads++;
          if (reads === 2) await held.wait();
          return reads <= 2 ? 'old-resolved-secret' : null;
        });
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
        storage.mockRestore();
      }
    });
  }, 30_000);
});
