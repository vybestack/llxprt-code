/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, spyOn } from 'bun:test';

import {
  createAgent,
  fromConfig,
  AgentBusyError,
  type Agent,
  type AgentEvent,
  type TurnOptions,
} from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers';
import { FakeProvider, OpenAIProvider } from '@vybestack/llxprt-code-providers';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Gate has not been initialized');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface Observation {
  readonly events: readonly AgentEvent[];
  readonly rejection?: unknown;
}

async function collect(
  agent: Agent,
  input: string,
  options: TurnOptions,
): Promise<Observation> {
  return collectIterable(agent.stream(input, options));
}

async function collectIterable(
  stream: AsyncIterable<AgentEvent>,
): Promise<Observation> {
  const events: AgentEvent[] = [];
  try {
    for await (const event of stream) {
      events.push(event);
    }
    return { events };
  } catch (rejection) {
    return { events, rejection };
  }
}

function expectSuccessful(observation: Observation): void {
  expect(observation.rejection).toBeUndefined();
  expect(
    observation.events.filter((event) => event.type === 'error'),
  ).toStrictEqual([]);
  expect(
    observation.events.filter((event) => event.type === 'done'),
  ).toStrictEqual([{ type: 'done', reason: 'stop' }]);
}

async function beforeNextIO<T>(pending: Promise<T>): Promise<T | 'pending'> {
  let handle: ReturnType<typeof setImmediate> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<'pending'>((resolve) => {
        handle = setImmediate(() => resolve('pending'));
      }),
    ]);
  } finally {
    if (handle !== undefined) clearImmediate(handle);
  }
}

function expectTypedBusy(observation: Observation | 'pending'): void {
  expect(observation).not.toBe('pending');
  if (observation === 'pending') return;
  const errorEvent = observation.events.find((event) => event.type === 'error');
  expect(observation.rejection ?? errorEvent?.error).toBeInstanceOf(
    AgentBusyError,
  );
  expect(observation.rejection ?? errorEvent?.error).toMatchObject({
    code: 'busy',
  });
}

async function withAgent(run: (agent: Agent) => Promise<void>): Promise<void> {
  const agent = await createAgent({
    provider: 'openai',
    model: 'admission-model',
    auth: { apiKey: 'local-test-key', baseUrl: 'http://127.0.0.1:1/v1' },
    workingDir: process.cwd(),
    sessionId: 'admission-owner',
  });
  try {
    await run(agent);
  } finally {
    await agent.dispose();
  }
}

interface ModelBoundary {
  readonly entered: Promise<void>;
  readonly release: () => void;
  readonly requests: () => readonly string[];
  readonly start: (
    agent: Agent,
    input: string,
    options?: TurnOptions,
  ) => Promise<Observation>;
}

async function withModelBoundary(
  run: (boundary: ModelBoundary) => Promise<void>,
  failFirst = false,
  provider: 'openai' | 'fake' = 'openai',
): Promise<void> {
  const entered = gate();
  const blocked = gate();
  let requests: readonly string[] = [];
  const pending: Array<Promise<Observation>> = [];
  const model = spyOn(
    provider === 'fake' ? FakeProvider.prototype : OpenAIProvider.prototype,
    'generateChatCompletion',
  ).mockImplementation(async function* (
    options: GenerateChatOptions | IContent[],
  ): AsyncIterableIterator<IContent> {
    const contents = Array.isArray(options) ? options : options.contents;
    requests = [
      ...requests,
      contents
        .flatMap((content) => content.blocks)
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    ];
    if (requests.length === 1) {
      entered.release();
      await blocked.promise;
      if (failFirst) {
        throw Object.assign(new Error('Injected model request failure'), {
          status: 400,
        });
      }
    }
    yield { speaker: 'ai', blocks: [{ type: 'text', text: 'complete' }] };
  });
  try {
    await run({
      entered: entered.promise,
      release: blocked.release,
      requests: () => requests,
      start: (agent, input, options = { mcpDiscovery: 'skip' }) => {
        const result = collect(agent, input, options);
        pending.push(result);
        return result;
      },
    });
  } finally {
    blocked.release();
    entered.release();
    await Promise.all(pending);
    model.mockRestore();
  }
}

describe('Agent admission ownership (#2616 S2/C)', () => {
  it('does not reserve admission for a never-started iterator and releases it on return', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const unused = agent.stream('Never advanced', { mcpDiscovery: 'skip' });
        model.release();
        const iterator = agent
          .stream('Returned early', { mcpDiscovery: 'skip' })
          [Symbol.asyncIterator]();
        try {
          expect((await iterator.next()).done).toBe(false);
          expectTypedBusy(await model.start(agent, 'Busy until return'));
        } finally {
          await iterator.return?.();
        }
        expectSuccessful(await model.start(agent, 'After return'));
        expectSuccessful(await collectIterable(unused));
      });
    });
  }, 30_000);

  it('preserves the internally signalled active run after rejecting a competing model command', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Internal controller run');
        await model.entered;
        await expect(
          agent.setModel('admission-model-next'),
        ).rejects.toBeInstanceOf(AgentBusyError);
        agent.injectSteer('Continue the original internally signalled run');
        expectTypedBusy(await beforeNextIO(model.start(agent, 'Still busy')));
        model.release();
        const result = await first;
        expect(result.rejection).toBeUndefined();
        expect(
          result.events.filter((event) => event.type === 'error'),
        ).toStrictEqual([]);
        expect(model.requests()).toHaveLength(2);
        expect(model.requests()[1]).toContain(
          'Continue the original internally signalled run',
        );
        await agent.setModel('admission-model-next');
        expectSuccessful(await model.start(agent, 'After rebuilt run'));
      });
    });
  }, 30_000);

  it.each([false, true])(
    'dispose cancels the captured run after a competing command is rejected (caller signal: %s)',
    async (callerSignal) => {
      await withAgent(async (agent) => {
        await withModelBoundary(async (model) => {
          const caller = new AbortController();
          const first = model.start(agent, 'Disposed run', {
            mcpDiscovery: 'skip',
            ...(callerSignal ? { signal: caller.signal } : {}),
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          await agent.dispose();
          model.release();
          const result = await first;
          expect(result.events).toContainEqual({
            type: 'done',
            reason: 'aborted',
          });
          expect(caller.signal.aborted).toBe(false);
        });
      });
    },
    30_000,
  );
  it('completes sequential public streams through the real agent assembly', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        model.release();
        expectSuccessful(await model.start(agent, 'First ordinary turn'));
        expectSuccessful(await model.start(agent, 'Second ordinary turn'));
        expect(model.requests()).toHaveLength(2);
      });
    });
  }, 30_000);

  it('rejects a second ordinary stream with typed busy while the first model request is blocked', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Admitted turn');
        await model.entered;
        const second = model.start(agent, 'Must not reach the model');
        const rejection = await beforeNextIO(second);
        expect(model.requests()).toHaveLength(1);
        expectTypedBusy(rejection);
        model.release();
        expectSuccessful(await first);
      });
    });
  }, 30_000);

  it.each(['complete', 'fail', 'abort'])(
    'owns admission before discovery and releases after %s',
    async (outcome) => {
      const built = await buildCliStyleConfig('plain-text.jsonl');
      let agent: Agent | undefined;
      try {
        const adopted = await fromConfig({
          settingsOwner: built.settingsOwner,
          settingsService: built.settingsService,
          agentClient: built.agentClient,
          providerManager: built.providerManager,
          config: built.config,
          mcpRuntime: built.mcpRuntime,
          messageBus: built.messageBus,
        });

        agent = adopted;
        await withModelBoundary(
          async (model) => {
            model.release();
            expectSuccessful(
              await model.start(adopted, 'Sequential discovery baseline', {}),
            );
            const discoveryEntered = gate();
            const discoveryRelease = gate();
            let discoveryWaits = 0;
            const abort = new AbortController();
            const discoveryError = new Error('Injected discovery failure');
            const discovery = spyOn(
              built.mcpRuntime,
              'awaitDiscovery',
            ).mockImplementation(
              async (): Promise<ReadonlyMap<string, string>> => {
                discoveryWaits += 1;
                discoveryEntered.release();
                await discoveryRelease.promise;
                if (outcome === 'fail') throw discoveryError;
                return new Map();
              },
            );
            try {
              const first = model.start(adopted, 'Waiting for discovery', {
                signal: abort.signal,
              });
              const second = model.start(
                adopted,
                'Must be rejected before discovery',
                {},
              );
              if (
                (await beforeNextIO(discoveryEntered.promise)) === 'pending'
              ) {
                throw new Error(
                  'Setup: the first stream did not reach the external discovery boundary',
                );
              }
              const rejection = await beforeNextIO(second);
              expect(model.requests()).toHaveLength(1);
              expectTypedBusy(rejection);
              expect(discoveryWaits).toBe(1);
              if (outcome === 'abort') abort.abort();
              discoveryRelease.release();
              const result = await first;
              expect(result.rejection).toBe(
                outcome === 'fail' ? discoveryError : undefined,
              );
              const reason = outcome === 'abort' ? 'aborted' : 'stop';
              const expectedDone = (
                outcome === 'fail' ? [] : [{ type: 'done', reason }]
              ) satisfies AgentEvent[];
              expect(
                result.events.filter((event) => event.type === 'done'),
              ).toStrictEqual(expectedDone);
              expect(
                result.events.filter((event) => event.type === 'error'),
              ).toStrictEqual([]);
              expect(model.requests()).toHaveLength(
                outcome === 'complete' ? 2 : 1,
              );
              discovery.mockRestore();
              expectSuccessful(
                await model.start(adopted, 'After discovery turn', {}),
              );
            } finally {
              discoveryRelease.release();
              discoveryEntered.release();
              discovery.mockRestore();
            }
          },
          false,
          'fake',
        );
      } finally {
        try {
          await agent?.dispose();
        } finally {
          await built.cleanup();
        }
      }
    },
    30_000,
  );

  it('releases admission after cancellation so the next ordinary stream completes', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Cancelled turn', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          abort.abort();
          model.release();
          const cancelled = await first;
          expect(cancelled.events).toContainEqual({
            type: 'done',
            reason: 'aborted',
          });
          expectSuccessful(await model.start(agent, 'Turn after cancellation'));
          expect(model.requests()).toHaveLength(2);
        } finally {
          abort.abort();
        }
      });
    });
  }, 30_000);

  it.each([false, true])(
    'releases admission after a model failure (command conflicted: %s)',
    async (rebuild) => {
      await withAgent(async (agent) => {
        await withModelBoundary(async (model) => {
          const first = model.start(agent, 'Failed turn');
          await model.entered;
          const commandConflicted = rebuild
            ? await agent.setModel('admission-model-next').then(
                () => false,
                (error: unknown) => error instanceof AgentBusyError,
              )
            : false;
          expect(commandConflicted).toBe(rebuild);
          model.release();
          const failed = await first;
          expect(failed.events.some((event) => event.type === 'error')).toBe(
            true,
          );
          expectSuccessful(await model.start(agent, 'Turn after failure'));
          expect(model.requests()).toHaveLength(2);
        }, true);
      });
    },
    30_000,
  );

  it('lets two agents with the same session label execute independently', async () => {
    await withAgent(async (firstAgent) => {
      await withAgent(async (secondAgent) => {
        await withModelBoundary(async (model) => {
          expect(firstAgent.getRuntimeId()).toBe(secondAgent.getRuntimeId());
          const first = model.start(firstAgent, 'First agent stays blocked');
          await model.entered;
          expectSuccessful(
            await model.start(secondAgent, 'Second agent completes'),
          );
          expect(model.requests()).toHaveLength(2);
          model.release();
          expectSuccessful(await first);
        });
      });
    });
  }, 30_000);

  it('delivers steering to the admitted run without a configuration change', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const first = model.start(agent, 'Ordinary turn');
        await model.entered;
        agent.injectSteer('Include the admission follow-up');
        model.release();
        const completed = await first;
        expect(completed.rejection).toBeUndefined();
        expect(
          completed.events.filter((event) => event.type === 'error'),
        ).toStrictEqual([]);
        expect(model.requests()).toHaveLength(2);
        expect(model.requests()[1]).toContain(
          'Include the admission follow-up',
        );
      });
    });
  }, 30_000);

  it('keeps steering addressed to the admitted run after a rejected model change', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Run admitted before model change', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          expect(agent.getModel()).not.toBe('admission-model-next');
          agent.injectSteer('Keep this follow-up on the admitted run');
          model.release();
          const completed = await first;
          expect(completed.rejection).toBeUndefined();
          expect(
            completed.events.filter((event) => event.type === 'error'),
          ).toStrictEqual([]);
          expect(model.requests()).toHaveLength(2);
          expect(model.requests()[1]).toContain(
            'Keep this follow-up on the admitted run',
          );
        } finally {
          abort.abort();
        }
      });
    });
  }, 30_000);

  it('does not admit another ordinary stream after rejecting a competing rebuild', async () => {
    await withAgent(async (agent) => {
      await withModelBoundary(async (model) => {
        const abort = new AbortController();
        try {
          const first = model.start(agent, 'Run admitted before rebuild', {
            signal: abort.signal,
            mcpDiscovery: 'skip',
          });
          await model.entered;
          await expect(
            agent.setModel('admission-model-next'),
          ).rejects.toBeInstanceOf(AgentBusyError);
          expect(agent.getModel()).not.toBe('admission-model-next');
          const second = model.start(
            agent,
            'Must not enter a replacement loop',
          );
          const rejection = await beforeNextIO(second);
          expect(model.requests()).toHaveLength(1);
          expectTypedBusy(rejection);
          model.release();
          expectSuccessful(await first);
        } finally {
          abort.abort();
        }
      });
    });
  }, 30_000);
});
