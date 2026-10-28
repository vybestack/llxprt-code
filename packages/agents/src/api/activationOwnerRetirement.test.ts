/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  retireActivationOwners,
  type ActivationOwnerRetirement,
} from './activationOwnerRetirement.js';

const barrier = () => new Promise<void>((done) => setTimeout(done, 20));

function held() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function recordingOwners(
  events: string[],
  overrides: Partial<ActivationOwnerRetirement> = {},
): ActivationOwnerRetirement {
  const step = (name: string) => async () => {
    events.push(name);
  };
  return {
    publicWork: Promise.resolve(),
    memory: Promise.resolve(),
    sessionClient: step('client'),
    afterClient: [
      step('definitions'),
      step('media'),
      step('trust'),
      step('filesystem'),
    ],
    settings: step('settings'),
    ...overrides,
  };
}

describe('retireActivationOwners', () => {
  it('starts the client only after public work and memory have settled', async () => {
    const events: string[] = [];
    const publicWork = held();
    const memory = held();
    const retiring = retireActivationOwners(
      recordingOwners(events, {
        publicWork: publicWork.promise,
        memory: memory.promise,
      }),
    );
    await barrier();
    expect(events).toStrictEqual([]);
    publicWork.resolve();
    await barrier();
    expect(events).toStrictEqual([]);
    memory.reject(new Error('memory failed'));
    await expect(retiring).rejects.toThrow('Activation owner cleanup failed');
    expect(events).toStrictEqual([
      'client',
      'definitions',
      'media',
      'trust',
      'filesystem',
      'settings',
    ]);
  });

  it('retires the session client exactly once when memory disposal fails', async () => {
    const events: string[] = [];
    const retiring = retireActivationOwners(
      recordingOwners(events, {
        memory: Promise.reject(new Error('Workspace memory is disposed')),
      }),
    );
    const error = await retiring.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.message).toBe('Activation owner cleanup failed');
    expect(aggregate.errors.map((entry: Error) => entry.message)).toStrictEqual(
      ['Workspace memory is disposed'],
    );
    expect(events.filter((event) => event === 'client')).toHaveLength(1);
  });

  it.each(['resolves', 'rejects'] as const)(
    'keeps definitions, media, trust and filesystem pending until the client step %s',
    async (outcome) => {
      const events: string[] = [];
      const client = held();
      const step = (name: string) => async () => {
        events.push(name);
      };
      const retiring = retireActivationOwners(
        recordingOwners(events, {
          sessionClient: () => {
            events.push('client');
            return client.promise;
          },
          afterClient: [
            step('definitions'),
            step('media'),
            step('trust'),
            step('filesystem'),
          ],
        }),
      );
      await barrier();
      expect(events).toStrictEqual(['client']);
      if (outcome === 'resolves') client.resolve();
      else client.reject(new Error('client cleanup control'));
      const [settled] = await Promise.allSettled([retiring]);
      expect(settled.status).toBe(
        outcome === 'resolves' ? 'fulfilled' : 'rejected',
      );
      expect(events).toStrictEqual([
        'client',
        'definitions',
        'media',
        'trust',
        'filesystem',
        'settings',
      ]);
    },
  );

  it('starts the remaining owners together', async () => {
    const events: string[] = [];
    const gates = [held(), held(), held(), held()];
    const names = ['definitions', 'media', 'trust', 'filesystem'];
    const retiring = retireActivationOwners(
      recordingOwners(events, {
        afterClient: names.map((name, index) => () => {
          events.push(name);
          return gates[index].promise;
        }),
      }),
    );
    await barrier();
    expect(events).toStrictEqual(['client', ...names]);
    for (const gate of gates) gate.resolve();
    await retiring;
  });

  it('aggregates failures as client, memory, remaining owners, then settings', async () => {
    const failure = (name: string) => new Error(name);
    const rejecting = (name: string) => () => Promise.reject(failure(name));
    const memory = Promise.reject(failure('memory'));
    const retiring = retireActivationOwners({
      publicWork: Promise.resolve(),
      memory,
      sessionClient: rejecting('client'),
      afterClient: [
        rejecting('definitions'),
        () => undefined,
        rejecting('trust'),
        rejecting('filesystem'),
      ],
      settings: rejecting('settings'),
    });
    const error = await retiring.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AggregateError);
    const aggregate = error as AggregateError;
    expect(aggregate.message).toBe('Activation owner cleanup failed');
    expect(aggregate.errors.map((entry: Error) => entry.message)).toStrictEqual(
      ['client', 'memory', 'definitions', 'trust', 'filesystem', 'settings'],
    );
  });

  it('retires settings after every other owner has settled', async () => {
    const events: string[] = [];
    const filesystem = held();
    const retiring = retireActivationOwners(
      recordingOwners(events, {
        afterClient: [
          async () => {
            events.push('media');
          },
          () => {
            events.push('filesystem');
            return filesystem.promise;
          },
        ],
        settings: async () => {
          events.push('settings');
        },
      }),
    );
    await barrier();
    expect(events).toStrictEqual(['client', 'media', 'filesystem']);
    filesystem.resolve();
    await retiring;
    expect(events).toStrictEqual(['client', 'media', 'filesystem', 'settings']);
  });

  it('completes without error when no step has anything to retire', async () => {
    const retiring = retireActivationOwners({
      publicWork: Promise.resolve(),
      memory: undefined,
      sessionClient: () => undefined,
      afterClient: [() => undefined],
      settings: () => undefined,
    });
    await expect(retiring).resolves.toBeUndefined();
  });
});
