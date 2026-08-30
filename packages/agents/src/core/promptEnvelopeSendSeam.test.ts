/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import {
  bindPreparedTransportSignal,
  createPromptEnvelopePreparer,
  enforceAndSendWithPromptEnvelopeRetries,
  prepareAtSendSeam,
  preparePromptEnvelopeAfterEnforcement,
  type PreparedPromptEnvelopeSend,
} from './promptEnvelopeSendSeam.js';

function buildPrepared(
  callerSignal: AbortSignal,
  transportToken: object,
): PreparedPromptEnvelopeSend {
  return {
    estimate: null,
    options: {
      contents: [],
      invocation: { signal: callerSignal },
      metadata: { abortSignal: callerSignal },
      promptEnvelopeTransportToken: transportToken,
    } as RuntimeGenerateChatOptions,
  };
}

describe('bindPreparedTransportSignal', () => {
  it('immutably binds the timeout signal while preserving prepared transport identity', () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const transportToken = Object.freeze({});
    const prepared = buildPrepared(callerSignal, transportToken);

    const bound = bindPreparedTransportSignal(prepared, timeoutSignal);

    expect(bound).not.toBe(prepared);
    expect(bound.options).not.toBe(prepared.options);
    expect(bound.options.invocation?.signal).toBe(timeoutSignal);
    expect(bound.options.metadata?.['abortSignal']).toBe(timeoutSignal);
    expect(bound.options.promptEnvelopeTransportToken).toBe(transportToken);
    expect(prepared.options.invocation?.signal).toBe(callerSignal);
    expect(prepared.options.metadata?.['abortSignal']).toBe(callerSignal);
  });
});

describe('preparePromptEnvelopeAfterEnforcement', () => {
  it('estimates candidates without provider preparation and prepares only the selected history', async () => {
    const firstCandidate: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
    ];
    const selectedCandidate: IContent[] = [
      ...firstCandidate,
      { speaker: 'ai', blocks: [{ type: 'text', text: 'selected' }] },
    ];
    const projectedContents: IContent[][] = [];
    const provider: IProvider = {
      name: 'candidate-estimation-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope(
        options: GenerateChatOptions,
      ): Promise<PromptEnvelopeProjection> {
        projectedContents.push(options.contents);
        return Promise.resolve({
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken: Object.freeze({}),
          finalizedProjection: options.contents,
          legacyEstimate: () => Promise.resolve(options.contents.length),
        });
      },
    };
    const runtime = createChatSessionRuntime({ provider });
    const candidateEstimates: number[] = [];

    const result = await preparePromptEnvelopeAfterEnforcement({
      provider,
      contents: firstCandidate,
      buildOptions: (contents) => ({ contents, config: runtime.config }),
      enforce: async (_contents, estimate) => {
        candidateEstimates.push(await estimate(firstCandidate));
        candidateEstimates.push(await estimate(selectedCandidate));
        return selectedCandidate;
      },
      fallbackEstimate: (contents) => Promise.resolve(contents.length),
    });

    expect(candidateEstimates).toEqual([1, 2]);
    expect(projectedContents).toEqual([selectedCandidate]);
    expect(result.contents).toBe(selectedCandidate);
    expect(result.prepared.options.contents).toBe(selectedCandidate);
  });

  it('awaits projection cleanup before an estimation failure escapes', async () => {
    const cleanupEvents: string[] = [];
    const provider: IProvider = {
      name: 'failing-estimate-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: () =>
        Promise.resolve({
          model: '',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken: Object.freeze({}),
          finalizedProjection: [],
          legacyEstimate: () => Promise.resolve(1),
          releaseIfUnsent: async () => {
            await Promise.resolve();
            cleanupEvents.push('released');
          },
        }),
    };
    const runtime = createChatSessionRuntime({ provider });

    const error = await prepareAtSendSeam(provider, {
      contents: [],
      config: runtime.config,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(cleanupEvents).toEqual(['released']);
  });

  it('does not prepare or send when enforcement rejects', async () => {
    let projectionCount = 0;
    let sendCount = 0;
    const provider: IProvider = {
      name: 'enforcement-failure-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: () => {
        projectionCount += 1;
        return Promise.resolve(undefined);
      },
    };

    await expect(
      enforceAndSendWithPromptEnvelopeRetries({
        provider,
        contents: [],
        buildOptions: (contents) => ({ contents }),
        enforce: () => Promise.reject(new Error('enforcement failed')),
        fallbackEstimate: () => Promise.resolve(0),
        send: () => {
          sendCount += 1;
          return Promise.resolve('sent');
        },
        shouldRetryOnError: () => false,
      }),
    ).rejects.toThrow('enforcement failed');

    expect(projectionCount).toBe(0);
    expect(sendCount).toBe(0);
  });

  it('does not release a projection consumed by a successful send', async () => {
    let releaseCount = 0;
    const provider: IProvider = {
      name: 'successful-send-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: (options) =>
        Promise.resolve({
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken: Object.freeze({}),
          finalizedProjection: options.contents,
          legacyEstimate: () => Promise.resolve(options.contents.length),
          releaseIfUnsent: () => {
            releaseCount += 1;
            return Promise.resolve();
          },
        }),
    };
    const runtime = createChatSessionRuntime({ provider });

    const result = await enforceAndSendWithPromptEnvelopeRetries({
      provider,
      contents: [],
      buildOptions: (contents) => ({ contents, config: runtime.config }),
      enforce: (contents) => Promise.resolve(contents),
      fallbackEstimate: () => Promise.resolve(0),
      send: () => Promise.resolve('sent'),
      shouldRetryOnError: () => false,
    });

    expect(result).toBe('sent');
    expect(releaseCount).toBe(0);
  });

  it('prepares a fresh projection for a retry and releases the prior unsent projection', async () => {
    const transportTokens: object[] = [];
    const releasedTokens: object[] = [];
    const provider: IProvider = {
      name: 'retry-projection-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: (options) => {
        const transportToken = Object.freeze({
          sequence: transportTokens.length,
        });
        transportTokens.push(transportToken);
        return Promise.resolve({
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken,
          finalizedProjection: options.contents,
          legacyEstimate: () => Promise.resolve(options.contents.length),
          releaseIfUnsent: () => {
            releasedTokens.push(transportToken);
            return Promise.resolve();
          },
        });
      },
    };
    const runtime = createChatSessionRuntime({ provider });
    const observedAttempts: Array<{
      readonly attemptIndex: number;
      readonly transportToken: object | undefined;
    }> = [];

    const result = await enforceAndSendWithPromptEnvelopeRetries({
      provider,
      contents: [],
      buildOptions: (contents) => ({ contents, config: runtime.config }),
      enforce: (contents) => Promise.resolve(contents),
      fallbackEstimate: () => Promise.resolve(0),
      send: (_contents, prepared, attemptIndex) => {
        observedAttempts.push({
          attemptIndex,
          transportToken: prepared.options.promptEnvelopeTransportToken,
        });
        return attemptIndex === 0
          ? Promise.reject(
              Object.assign(new Error('retry once'), { status: 429 }),
            )
          : Promise.resolve('sent');
      },
      shouldRetryOnError: (error) =>
        error instanceof Error && error.message === 'retry once',
    });

    expect(result).toBe('sent');
    expect(observedAttempts).toEqual([
      { attemptIndex: 0, transportToken: transportTokens[0] },
      { attemptIndex: 1, transportToken: transportTokens[1] },
    ]);
    expect(transportTokens[1]).not.toBe(transportTokens[0]);
    expect(releasedTokens).toEqual([transportTokens[0]]);
  }, 10_000);

  it('releases every unsent projection and aggregates cleanup failures', async () => {
    const cleanupFailures = [
      new Error('first cleanup failed'),
      new Error('second cleanup failed'),
    ];
    let projectionIndex = 0;
    const provider: IProvider = {
      name: 'aggregate-cleanup-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: (options) => {
        const cleanupFailure = cleanupFailures[projectionIndex++];
        return Promise.resolve({
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken: Object.freeze({}),
          finalizedProjection: options.contents,
          legacyEstimate: () => Promise.resolve(options.contents.length),
          releaseIfUnsent: () => Promise.reject(cleanupFailure),
        });
      },
    };
    const runtime = createChatSessionRuntime({ provider });
    const preparer = createPromptEnvelopePreparer(provider, (contents) => ({
      contents,
      config: runtime.config,
    }));
    await preparer.prepare([]);
    await preparer.prepare([
      { speaker: 'human', blocks: [{ type: 'text', text: 'candidate' }] },
    ]);

    const thrown = await preparer
      .releaseUnused()
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(AggregateError);
    if (!(thrown instanceof AggregateError)) {
      throw new Error('Expected aggregate cleanup failure');
    }
    expect(
      thrown.errors.map((error) =>
        error instanceof Error ? error.message : String(error),
      ),
    ).toEqual(['first cleanup failed', 'second cleanup failed']);
  });

  it('prepares a fresh projection after releasing the prior projection for the same contents', async () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'candidate' }] },
    ];
    const projectionStates: Array<{ released: boolean }> = [];
    const provider: IProvider = {
      name: 'projection-reuse-provider',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
      projectPromptEnvelope: (options) => {
        const state = { released: false };
        projectionStates.push(state);
        return Promise.resolve({
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken: Object.freeze({ state }),
          finalizedProjection: options.contents,
          legacyEstimate: () => Promise.resolve(options.contents.length),
          releaseIfUnsent: () => {
            state.released = true;
            return Promise.resolve();
          },
        });
      },
    };
    const runtime = createChatSessionRuntime({ provider });
    const preparer = createPromptEnvelopePreparer(provider, (candidate) => ({
      contents: candidate,
      config: runtime.config,
    }));

    const first = await preparer.prepare(contents);
    await preparer.releaseUnused();
    const second = await preparer.prepare(contents);

    expect(projectionStates).toEqual([{ released: true }, { released: false }]);
    expect(second.options.promptEnvelopeTransportToken).not.toBe(
      first.options.promptEnvelopeTransportToken,
    );
  });
});
