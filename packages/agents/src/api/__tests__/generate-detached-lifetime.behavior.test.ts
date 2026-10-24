/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { withOwners } from './turn-revision-capture.fixture.js';
import { useRecordingPrompts } from './helpers/recording-owner-lifetime-fixture.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import {
  withGenerationOwner,
  generationGate,
} from './helpers/generation-owner-fixture.js';

const leaves = (error: unknown): unknown[] =>
  error instanceof AggregateError || error instanceof AggregateDisposeError
    ? error.errors.flatMap(leaves)
    : [error];

describe('Agent.generate lifetimes', () => {
  useRecordingPrompts();
  it('reports an accepted generation cancellation to its caller only and lets shutdown fulfill', async () => {
    const entered = generationGate();
    const held = generationGate();
    let rejectedWork: unknown;
    const cleanup = await withGenerationOwner(
      async (owner, _clients, provider) => {
        provider.generating = async () => {
          entered.release();
          await held.promise;
        };
        const pending = owner
          .generate('cancel the accepted generation')
          .catch((error: unknown) => {
            rejectedWork = error;
          });
        await entered.promise;
        const closing = owner.dispose();
        const settled = Promise.allSettled([closing]);
        held.release();
        await pending;
        await settled;
      },
    );
    expect(rejectedWork).toBeInstanceOf(Error);
    expect(cleanup).toStrictEqual([]);
  });
  it.each(['request', 'cleanup'])(
    'joins accepted Gemini %s work through temporary release before shutdown settles',
    async (stage) => {
      const entered = generationGate();
      const held = generationGate();
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          if (stage === 'request')
            provider.generating = async () => {
              entered.release();
              await held.promise;
            };
          const pending = owner.generate('held temporary lifetime', undefined);
          const result = pending.then(
            () => 'completed',
            () => 'cancelled',
          );
          await entered.promise;
          let disposed = false;
          const closing = owner.dispose().then(
            () => {
              disposed = true;
            },
            () => {
              disposed = true;
            },
          );
          try {
            expect(disposed).toBe(false);
            expect(clients[1].disposed).toBe(0);
            await expect(owner.generate('late admission')).rejects.toThrow(
              'closed',
            );
            held.release();
            expect(await result).toBe(
              stage === 'request' ? 'cancelled' : 'completed',
            );
            await closing;
            expect(clients[2].disposed).toBe(1);
            expect(clients[2].initialized).toBe(1);
            expect(provider.requests).toHaveLength(1);
          } finally {
            held.release();
          }
        },
        'gemini',
        (client, index) => {
          if (index === 2 && stage === 'cleanup')
            client.disposing = async () => {
              entered.release();
              await held.promise;
            };
        },
      );
      expect(cleanup).toStrictEqual([]);
    },
  );
  describe('Agent.generate temporary ownership', () => {
    it('releases a failed temporary while the borrowed primary survives facade shutdown', async () => {
      const initializationFailure = new Error(
        'borrowed temporary initialization failed',
      );
      const cleanup = await withGenerationOwner(
        async (agent, clients, provider) => {
          const primary = clients[1];
          await expect(agent.generate('borrowed temporary')).rejects.toBe(
            initializationFailure,
          );
          const temporary = clients[2];
          expect(temporary).not.toBe(primary);
          expect(temporary.mediaStore).toBe(primary.mediaStore);
          expect(temporary.initialized).toBe(1);
          expect(temporary.disposed).toBe(1);
          expect(provider.requests).toStrictEqual([]);
          await agent.dispose();
          expect(primary.disposed).toBe(0);
          await primary.startChat();
          await primary.addHistory({
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'borrowed primary still accepts history' },
            ],
          });
          expect((await primary.getHistory())[0].blocks).toStrictEqual([
            { type: 'text', text: 'borrowed primary still accepts history' },
          ]);
          expect(temporary.disposed).toBe(1);
        },
        'gemini',
        (client, index) => {
          if (index === 2)
            client.initializing = async () => {
              throw initializationFailure;
            };
        },
        undefined,
        true,
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('writes Gemini output to the admitted primary without discarding its deferred history', async () => {
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          const primary = clients[1];
          await primary.storeHistoryForLaterUse([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'deferred primary seed' }],
            },
          ]);
          expect(
            await owner.generate('append on primary', {
              readHistory: true,
              writeHistory: true,
              model: 'written-model',
            }),
          ).toBe('turn one reply');
          expect(
            (await primary.getHistory()).map((turn) => ({
              speaker: turn.speaker,
              blocks: turn.blocks,
            })),
          ).toStrictEqual([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'deferred primary seed' }],
            },
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'append on primary' }],
            },
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'turn one reply' }],
            },
          ]);
          expect(provider.requests[0].resolved?.model).toBe('written-model');
          expect(clients[2].disposed).toBe(1);
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('rejects pre-aborted temporary work without tokenizer, acquisition, network or history effects', async () => {
      let preparations = 0;
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          const controller = new AbortController();
          controller.abort(new Error('cancelled before temporary setup'));
          await expect(
            owner.generate('no setup', {
              signal: controller.signal,
              writeHistory: true,
            }),
          ).rejects.toThrow('cancelled before temporary setup');
          expect(preparations).toBe(0);
          expect(clients).toHaveLength(2);
          expect(provider.requests).toStrictEqual([]);
          expect(await clients[1].getHistory()).toStrictEqual([]);
        },
        'gemini',
        undefined,
        async () => {
          preparations += 1;
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('propagates caller cancellation to the provider and allows another operation afterward without partial history', async () => {
      const entered = generationGate();
      const held = generationGate();
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          provider.generating = async () => {
            entered.release();
            await held.promise;
          };
          const controller = new AbortController();
          const pending = owner.generate('cancel network', {
            signal: controller.signal,
            writeHistory: true,
          });
          const result = pending.then(
            () => undefined,
            (failure: unknown) => failure,
          );
          await entered.promise;
          try {
            controller.abort();
            expect(provider.requests[0].invocation?.signal?.aborted).toBe(true);
            held.release();
            expect(await result).toMatchObject({ name: 'AbortError' });
            expect(await clients[1].getHistory()).toStrictEqual([]);
            provider.generating = undefined;
            expect(await owner.generate('next request', undefined)).toBe(
              'turn two reply',
            );
            expect(clients[1].disposed).toBe(0);
          } finally {
            held.release();
          }
        },
        'fake',
      );
      expect(cleanup).toStrictEqual([]);
    });

    it.each(['request', 'initialization'])(
      'keeps %s failure before temporary cleanup failure and releases the temporary once',
      async (stage) => {
        const primaryFailure = new Error(`${stage} failed`);
        const cleanupFailure = new Error('temporary cleanup failed');
        const cleanup = await withGenerationOwner(
          async (owner, clients, provider) => {
            if (stage === 'request')
              provider.generating = async () => {
                throw primaryFailure;
              };
            const failure = await owner
              .generate('failure path', undefined)
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            if (!(failure instanceof AggregateError))
              throw new Error('Expected generation and cleanup errors');
            expect(failure.errors).toStrictEqual([
              primaryFailure,
              cleanupFailure,
            ]);
            expect(clients[2].disposed).toBe(1);
            expect(clients[2].initialized).toBe(1);
            expect(clients[1].disposed).toBe(0);
            expect(await clients[1].getHistory()).toStrictEqual([]);
          },
          'gemini',
          (client, index) => {
            if (index !== 2) return;
            if (stage === 'initialization')
              client.initializing = async () => {
                throw primaryFailure;
              };
            client.disposing = async () => {
              throw cleanupFailure;
            };
          },
        );
        expect(cleanup.flatMap(leaves)).toStrictEqual([cleanupFailure]);
      },
    );

    it.each([undefined, new Error('same failure')])(
      'retains undefined and repeated primary-first cleanup leaves %j',
      async (failure) => {
        const cleanup = await withGenerationOwner(
          async (owner, clients) => {
            const result = await owner
              .generate('repeat failure', undefined)
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            if (!(result instanceof AggregateError))
              throw new Error('Expected both failure leaves');
            expect(result.errors).toStrictEqual([failure, failure]);
            expect(clients[2].disposed).toBe(1);
          },
          'gemini',
          (client, index) => {
            if (index === 2) {
              client.initializing = async () => {
                throw failure;
              };
              client.disposing = async () => {
                throw failure;
              };
            }
          },
        );
        expect(cleanup.flatMap(leaves)).toStrictEqual([failure]);
      },
    );
  });

  describe('Agent.generate accepted lifetime', () => {
    it('rejects pre-aborted text without a request and keeps the owner usable', async () => {
      await withOwners(async (agent, _peer, transport) => {
        transport.release();
        const controller = new AbortController();
        controller.abort(new Error('cancel before admission'));
        await expect(
          agent.generate('Must never reach transport', {
            signal: controller.signal,
            writeHistory: true,
          }),
        ).rejects.toThrow('cancel before admission');
        expect(transport.requests()).toStrictEqual([]);
        expect(await agent.getHistory()).toStrictEqual([]);
        expect(await agent.generate('Still usable')).toBe(
          'Transport completed.',
        );
        expect(transport.requests()).toHaveLength(1);
      });
    });

    it('cancels accepted text on shutdown, rejects later work and preserves an equal-label peer', async () => {
      await expect(
        withOwners(async (agent, peer, transport, peerTransport) => {
          const pending = agent.generate('Held text', { writeHistory: true });
          const settled = pending.then(
            () => 'unexpected success',
            () => 'cancelled',
          );
          await transport.entered;
          const closing = agent.dispose();
          const closed = closing.then(
            () => undefined,
            (failure: unknown) => failure,
          );
          await expect(agent.generate('Too late')).rejects.toThrow('closed');
          await expect(agent.generateEmbedding(['Too late'])).rejects.toThrow(
            'closed',
          );
          expect(await peer.generate('Independent peer')).toBe(
            'Transport completed.',
          );
          transport.release();
          expect(await settled).toBe('cancelled');
          await closed;
          expect(peerTransport.requests()).toHaveLength(1);
          expect(await peer.getHistory()).toStrictEqual([]);
        }),
      ).resolves.toBeUndefined();
    });

    it('keeps an admitted primary alive across model replacement and uses the replacement for later requests', async () => {
      const entered = generationGate();
      const held = generationGate();
      const ready = generationGate();
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider, settings) => {
          provider.generating = async () => {
            entered.release();
            await held.promise;
            expect(clients[1].disposed).toBe(0);
          };
          const pending = owner.generate('old admission', undefined);
          await entered.promise;
          try {
            settings.chooseModel('replacement-model');
            const replacement = owner.sessionClient.refreshAuth();
            await ready.promise;
            held.release();
            expect(await pending).toBe('turn one reply');
            await replacement;
            provider.generating = undefined;
            expect(await owner.generate('next admission', undefined)).toBe(
              'turn two reply',
            );
            expect(
              provider.requests.map((request) => request.resolved?.model),
            ).toStrictEqual(['primary-model', 'replacement-model']);
            expect(clients[1].disposed).toBe(1);
          } finally {
            held.release();
          }
        },
        'fake',
        (client, index) => {
          if (index === 2) client.initializedEffect = ready.release;
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('isolates Gemini text in one initialized temporary and releases it before returning while the primary stays usable', async () => {
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          const primary = clients[1];
          await primary.startChat();
          await primary.addHistory({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'primary seed' }],
          });
          expect(
            await owner.generate('temporary request', { readHistory: true }),
          ).toBe('turn one reply');
          expect(clients).toHaveLength(3);
          expect(clients[2].mediaStore).toBe(primary.mediaStore);
          expect(clients[2].initialized).toBe(1);
          expect(clients[2].disposed).toBe(1);
          expect(primary.disposed).toBe(0);
          expect(
            provider.requests[0].contents.map(({ speaker, blocks }) => ({
              speaker,
              blocks,
            })),
          ).toStrictEqual([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'primary seed' }],
            },
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'temporary request' }],
            },
          ]);
          expect(
            (await primary.getHistory()).map((turn) => turn.blocks),
          ).toStrictEqual([[{ type: 'text', text: 'primary seed' }]]);
          await owner.dispose();
          await owner.dispose();
          expect(clients[2].disposed).toBe(1);
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it.each(['synchronous', 'asynchronous'])(
      'preserves preparation rejection identity and the usable primary after %s failure before temporary acquisition',
      async (kind) => {
        const failure = new Error(`Preparation ${kind} failed`);
        let rejectPreparation = true;
        const cleanup = await withGenerationOwner(
          async (owner, clients, provider) => {
            const primary = clients[1];
            await primary.startChat();
            await primary.addHistory({
              speaker: 'human',
              blocks: [{ type: 'text', text: 'retained primary seed' }],
            });
            const history = await primary.getHistory();
            await expect(
              owner.generate('rejected preparation', { readHistory: true }),
            ).rejects.toBe(failure);
            expect(clients).toHaveLength(2);
            expect(provider.requests).toHaveLength(0);
            expect(await primary.getHistory()).toStrictEqual(history);
            expect(primary.disposed).toBe(0);
            rejectPreparation = false;
            expect(
              await owner.generate('later usable primary', {
                readHistory: true,
              }),
            ).toBe('turn one reply');
            expect(clients).toHaveLength(3);
            expect(clients[2].disposed).toBe(1);
            expect(primary.disposed).toBe(0);
            expect(await primary.getHistory()).toStrictEqual(history);
          },
          'gemini',
          undefined,
          () => {
            if (rejectPreparation) {
              if (kind === 'synchronous') throw failure;
              return Promise.reject(failure);
            }
            return Promise.resolve();
          },
        );
        expect(cleanup).toStrictEqual([]);
      },
    );

    it('stops admission during held tokenizer preparation and joins it without acquiring a temporary or starting a request', async () => {
      const entered = generationGate();
      const held = generationGate();
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          const pending = owner.generate('held acquisition', undefined);
          const result = pending.then(
            () => 'unexpected success',
            () => 'cancelled',
          );
          await entered.promise;
          try {
            let disposed = false;
            const closing = owner.dispose().then(
              () => {
                disposed = true;
              },
              () => {
                disposed = true;
              },
            );
            await expect(owner.generate('late')).rejects.toThrow('closed');
            expect(disposed).toBe(false);
            expect(clients).toHaveLength(2);
            held.release();
            expect(await result).toBe('cancelled');
            await closing;
            expect(clients).toHaveLength(2);
            expect(provider.requests).toStrictEqual([]);
          } finally {
            held.release();
          }
        },
        'gemini',
        undefined,
        async () => {
          entered.release();
          await held.promise;
        },
      );
      expect(cleanup).toStrictEqual([]);
    });

    it('joins held temporary initialization and cleanup before session disposal settles', async () => {
      const entered = generationGate();
      const initialized = generationGate();
      const releasing = generationGate();
      const released = generationGate();
      const cleanup = await withGenerationOwner(
        async (owner, clients, provider) => {
          const pending = owner.generate('held initialization', undefined);
          const result = pending.then(
            () => 'unexpected success',
            () => 'cancelled',
          );
          await entered.promise;
          let disposed = false;
          const closing = owner.dispose().then(
            () => {
              disposed = true;
            },
            () => {
              disposed = true;
            },
          );
          expect(disposed).toBe(false);
          initialized.release();
          await releasing.promise;
          expect(disposed).toBe(false);
          expect(provider.requests).toStrictEqual([]);
          released.release();
          expect(await result).toBe('cancelled');
          await closing;
          expect(clients[2].initialized).toBe(1);
          expect(clients[2].disposed).toBe(1);
        },
        'gemini',
        (client, index) => {
          if (index !== 2) return;
          client.initializing = async () => {
            entered.release();
            await initialized.promise;
          };
          client.disposing = async () => {
            releasing.release();
            await released.promise;
          };
        },
      );
      expect(cleanup).toStrictEqual([]);
    });
  });
});
