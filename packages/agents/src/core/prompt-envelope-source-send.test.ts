/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectedWithin } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { describe, expect, it } from 'bun:test';
import {
  assertInstanceOf,
  errorMessage,
} from '@vybestack/llxprt-code-test-utils';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createSourcePromptEnvelopePreparer,
  prepareSourcePromptEnvelopeAfterEnforcement,
  enforceAndStreamSourcePromptEnvelopeRetries,
} from './promptEnvelopeSendSeam.js';
import { bindSourceSignal } from './prompt-envelope-source-send.js';
import {
  diskSource,
  digest,
  lifecycleProvider,
  sourceRootSetup,
} from './__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const responseExitModes: ReadonlyArray<'complete' | 'return' | 'abort'> = [
  'complete',
  'return',
  'abort',
];
const coldExitModes: ReadonlyArray<'return' | 'abort'> = ['return', 'abort'];
const responseRow: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'response' }],
};

describe('source-backed prompt envelope seam', () => {
  it(
    'reopens the same 64-row disk candidate including a valid row above 10MiB and reuses its projection',
    testSource1,
  );

  it(
    'discharges changed projections before estimating compressed candidates and closes discarded owners',
    testSource2,
  );

  it(
    'releases unsent projection and owner on enforcement rejection',
    testSource3,
  );

  it(
    'fails explicitly when source-backed projection is unavailable instead of skipping enforcement',
    testSource4,
  );

  it(
    'rebuilds mutated options with a fresh attempt token and keeps retry metadata and disk identity',
    testSource5,
    10000,
  );

  it.each([...responseExitModes])(
    'owns the disk through first and last response chunks and releases on %s',
    testSource6,
  );

  it.each([...coldExitModes])(
    'releases an unsent cold prepared stream on %s',
    testSource7,
  );

  it(
    'releases a projected candidate when cancellation occurs during enforcement',
    testSource8,
  );
});

async function testSource1(): Promise<void> {
  const fixture = await diskSource(root(), 64, true);
  const { provider, events, buildOptions } = lifecycleProvider();
  const expected = await digest(fixture.source);
  const preparer = createSourcePromptEnvelopePreparer(provider, buildOptions);
  try {
    const prepared = await preparer.prepare(fixture.source);
    expect(prepared).toBe(await preparer.prepare(fixture.source));
    expect(prepared.options.requestRows).toBe(fixture.source);
    expect(prepared.options.contentCount).toBe(64);
    expect(prepared.estimatedPromptTokens).toBeGreaterThan(10 * 1024 * 1024);
    expect(events[0].digest).toBe(expected);
    expect(await digest(prepared.options.requestRows)).toBe(expected);
    expect(fixture.state.active).toBe(0);
    expect(events).toHaveLength(1);
  } finally {
    await preparer.releaseUnused();
  }
  expect(fixture.state.closed).toBe(1);
  expect(events[0].released).toBe(1);
}

async function testSource2(): Promise<void> {
  const full = await diskSource(root());
  const reduced = await diskSource(root(), 2);
  const { provider, events, buildOptions } = lifecycleProvider();
  const estimates: number[] = [];
  const result = await prepareSourcePromptEnvelopeAfterEnforcement({
    provider,
    source: full.source,
    buildOptions,
    enforce: async (_source, estimate) => {
      estimates.push(await estimate(full.source));
      estimates.push(await estimate(reduced.source));
      expect(events[0].released).toBe(1);
      return reduced.source;
    },
  });
  expect(estimates[0]).toBeGreaterThan(estimates[1]);
  expect(result.source).toBe(reduced.source);
  expect(events.map((event) => event.released)).toStrictEqual([1, 0]);
  expect(full.state.closed).toBe(1);
  expect(reduced.state.closed).toBe(0);
  await result.preparer.releaseUnused();
  expect(reduced.state.closed).toBe(1);
}

async function testSource3(): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, events, buildOptions } = lifecycleProvider();
  await expect(
    prepareSourcePromptEnvelopeAfterEnforcement({
      provider,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        throw new Error('context limit');
      },
    }),
  ).rejects.toThrow('context limit');
  expect(events[0].released).toBe(1);
  expect(fixture.state.closed).toBe(1);
}

async function testSource4(): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, buildOptions } = lifecycleProvider();
  const unsupported = {
    ...provider,
    projectPromptEnvelope: async () => undefined,
  };
  await expect(
    prepareSourcePromptEnvelopeAfterEnforcement({
      provider: unsupported,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
    }),
  ).rejects.toThrow(
    'Source-backed prompt preparation requires provider projection',
  );
  expect(fixture.state.closed).toBe(1);
}

async function testSource5(): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, events, buildOptions } = lifecycleProvider();
  const retryContext = { requestId: 'retry-source', observedTokens: 27 };
  let temperature = 0;
  const attempts: number[] = [];
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider,
    source: fixture.source,
    buildOptions: (source) => ({
      ...buildOptions(source),
      resolved: { temperature },
      metadata: { _retryRequestContext: retryContext },
    }),
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    shouldRetryOnError: (error) =>
      error instanceof Error && error.message === 'retry source',
    async *send(prepared, attemptIndex) {
      attempts.push(attemptIndex);
      expect(prepared.options.requestRows).toBe(fixture.source);
      expect(prepared.options.metadata?.['_retryRequestContext']).toBe(
        retryContext,
      );
      expect(prepared.options.resolved?.temperature).toBe(attemptIndex);
      if (attemptIndex === 0) {
        temperature = 1;
        throw new Error('retry source');
      }
      expect(events[0].released).toBe(1);
      yield responseRow;
    },
  });
  expect((await stream.next()).value).toStrictEqual(responseRow);
  expect(attempts).toStrictEqual([0, 1]);
  expect(events[1].token).not.toBe(events[0].token);
  expect(events[1].digest).toBe(events[0].digest);
  expect(fixture.state.closed).toBe(0);
  await stream.return?.();
  expect(fixture.state.closed).toBe(1);
}

async function testSource6(
  mode: 'complete' | 'return' | 'abort',
): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, buildOptions } = lifecycleProvider();
  const controller = new AbortController();
  let responseClosed = false;
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider,
    source: fixture.source,
    buildOptions,
    signal: controller.signal,
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    shouldRetryOnError: () => false,
    async *send() {
      try {
        yield responseRow;
        yield responseRow;
      } finally {
        responseClosed = true;
      }
    },
  });
  await stream.next();
  expect(fixture.state.closed).toBe(0);
  expect((await digest(fixture.source)).length).toBe(64);
  const outcome = await finishResponse(
    mode,
    stream,
    controller,
    () => fixture.state.closed,
  );
  expect(outcome).toStrictEqual({
    closedBeforeLast: 0,
    done: mode !== 'abort',
    error: mode === 'abort' ? 'cancel response' : undefined,
  });
  expect(fixture.state.closed).toBe(1);
  expect(responseClosed).toBe(true);
}

async function testSource7(
  mode: 'complete' | 'return' | 'abort',
): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, events, buildOptions } = lifecycleProvider();
  const controller = new AbortController();
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider,
    source: fixture.source,
    buildOptions,
    signal: controller.signal,
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    shouldRetryOnError: () => false,
  });
  const outcome = await finishResponse(
    mode,
    stream,
    controller,
    () => fixture.state.closed,
  );
  expect(outcome.error).toBe(mode === 'abort' ? 'cancel response' : undefined);
  expect(fixture.state.closed).toBe(1);
  expect(events[0].released).toBe(1);
}

async function testSource8(): Promise<void> {
  const fixture = await diskSource(root());
  const { provider, events, buildOptions } = lifecycleProvider();
  const controller = new AbortController();
  await expect(
    prepareSourcePromptEnvelopeAfterEnforcement({
      provider,
      source: fixture.source,
      buildOptions,
      signal: controller.signal,
      enforce: async (source, estimate) => {
        await estimate(source);
        controller.abort(new Error('cancel enforce'));
        return source;
      },
    }),
  ).rejects.toThrow('cancel enforce');
  expect(fixture.state.closed).toBe(1);
  expect(events[0].released).toBe(1);
}

describe('source prompt cancellation and ownership', () => {
  it('propagates cancellation to disk projection readers rather than draining the candidate', async () => {
    const fixture = await diskSource(root());
    const setup = lifecycleProvider();
    const controller = new AbortController();
    const provider = {
      ...setup.provider,
      async projectPromptEnvelope(
        options: Parameters<
          NonNullable<typeof setup.provider.projectPromptEnvelope>
        >[0],
      ) {
        for await (const _row of options.contents) {
          controller.abort(new Error('cancel projection'));
        }
        return setup.provider.projectPromptEnvelope?.(options);
      },
    };
    await expect(
      prepareSourcePromptEnvelopeAfterEnforcement({
        provider,
        source: fixture.source,
        buildOptions: setup.buildOptions,
        signal: controller.signal,
        enforce: async (source, estimate) => {
          await estimate(source);
          return source;
        },
      }),
    ).rejects.toThrow('cancel projection');
    expect(fixture.state.pulled).toBeLessThan(64);
    expect(fixture.state.active).toBe(0);
    expect(fixture.state.closed).toBe(1);
  });

  it('does not retain projected disk rows while the source lease is alive', async () => {
    const fixture = await diskSource(root(), 64, true);
    const { provider, buildOptions } = lifecycleProvider();
    const preparer = createSourcePromptEnvelopePreparer(provider, buildOptions);
    try {
      const prepared = await preparer.prepare(fixture.source);
      await Promise.all(
        fixture.references.map((reference) => collectedWithin(reference)),
      );
      expect(
        fixture.references.filter(
          (reference) => reference.deref() !== undefined,
        ),
      ).toHaveLength(0);
      expect(prepared.options.requestRows.count).toBe(64);
      expect(fixture.state.closed).toBe(0);
    } finally {
      await preparer.releaseUnused();
    }
  });

  it('releases owner and projection after a non-retryable first-chunk failure', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: () => false,
      async *send() {
        await Promise.reject(new Error('send rejected'));
        yield responseRow;
      },
    });
    await expect(stream.next()).rejects.toThrow('send rejected');
    expect(fixture.state.closed).toBe(1);
    expect(events[0].released).toBe(1);
  });
});

async function finishResponse(
  mode: 'complete' | 'return' | 'abort',
  stream: AsyncIterableIterator<IContent>,
  controller: AbortController,
  closed: () => number,
): Promise<{
  closedBeforeLast: number;
  done: boolean;
  error: string | undefined;
}> {
  if (mode === 'complete') {
    await stream.next();
    const closedBeforeLast = closed();
    const result = await stream.next();
    return { closedBeforeLast, done: result.done === true, error: undefined };
  }
  const closedBeforeLast = closed();
  if (mode === 'return') {
    const result = await stream.return?.();
    return { closedBeforeLast, done: result?.done === true, error: undefined };
  }
  controller.abort(new Error('cancel response'));
  const error = await stream.next().then(
    () => undefined,
    (reason: unknown) => errorMessage(reason),
  );
  return { closedBeforeLast, done: false, error };
}

/**
 * Source-route equivalents of the issue #3507 cleanup and retry assertions
 * that guarded the array preparer (bindPreparedTransportSignal,
 * preparePromptEnvelopeAfterEnforcement, enforceAndSendWithPromptEnvelopeRetries
 * and createPromptEnvelopePreparer). The array functions are gone; the source
 * preparer owns the disk selection and the projection instead.
 */
describe('source prompt envelope cleanup and retry (issue 3507 equivalents)', () => {
  it('immutably binds the timeout signal while preserving the prepared projection and disk identity', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const preparer = createSourcePromptEnvelopePreparer(provider, buildOptions);
    try {
      const prepared = await preparer.prepare(fixture.source);
      const callerSignal = new AbortController().signal;
      const timeoutSignal = new AbortController().signal;
      const callerBound = bindSourceSignal(prepared, callerSignal);
      const bound = bindSourceSignal(callerBound, timeoutSignal);

      expect(bound).not.toBe(callerBound);
      expect(bound.options.invocation?.signal).toBe(timeoutSignal);
      expect(bound.options.metadata?.abortSignal).toBe(timeoutSignal);
      expect(callerBound.options.metadata?.abortSignal).toBe(callerSignal);
      expect(prepared.options.metadata?.abortSignal).toBeUndefined();
      expect(bound.options.promptEnvelopeTransportToken).toBe(events[0].token);
      expect(bound.source).toBe(fixture.source);
      expect(bound.options.requestRows).toBe(fixture.source);
      expect(bound.estimatedPromptTokens).toBe(prepared.estimatedPromptTokens);
    } finally {
      await preparer.releaseUnused();
    }
  });

  it('uses the contents-only fallback estimate when the provider cannot project an envelope', async () => {
    const fixture = await diskSource(root());
    const { provider, buildOptions } = lifecycleProvider();
    const withoutProjection = { ...provider, projectPromptEnvelope: undefined };
    const fallbackSources: unknown[] = [];
    const result = await prepareSourcePromptEnvelopeAfterEnforcement({
      provider: withoutProjection,
      source: fixture.source,
      buildOptions,
      fallbackEstimate: async (source) => {
        fallbackSources.push(source);
        return 901;
      },
      enforce: async (source, estimate) => {
        expect(await estimate(source)).toBe(901);
        return source;
      },
    });

    expect(result.prepared.estimate).toBeNull();
    expect(result.prepared.estimatedPromptTokens).toBe(901);
    expect(fallbackSources).toStrictEqual([fixture.source]);
    expect(fixture.state.closed).toBe(0);
    await result.preparer.releaseUnused();
    expect(fixture.state.closed).toBe(1);
  });

  it('uses the contents-only fallback estimate when the provider resolves an undefined projection', async () => {
    const fixture = await diskSource(root());
    const { provider, buildOptions } = lifecycleProvider();
    const unprojected = {
      ...provider,
      projectPromptEnvelope: async () => undefined,
    };
    const result = await prepareSourcePromptEnvelopeAfterEnforcement({
      provider: unprojected,
      source: fixture.source,
      buildOptions,
      fallbackEstimate: async () => 902,
      enforce: async (source) => source,
    });

    expect(result.prepared.estimate).toBeNull();
    expect(result.prepared.estimatedPromptTokens).toBe(902);
    await result.preparer.releaseUnused();
    expect(fixture.state.closed).toBe(1);
  });

  it('keeps the selected projection reserved for transport and reuses it on the first attempt', async () => {
    const full = await diskSource(root());
    const reduced = await diskSource(root(), 2);
    const { provider, events, buildOptions } = lifecycleProvider();
    const result = await prepareSourcePromptEnvelopeAfterEnforcement({
      provider,
      source: full.source,
      buildOptions,
      enforce: async (_source, estimate) => {
        await estimate(full.source);
        await estimate(reduced.source);
        return reduced.source;
      },
    });

    expect(events.map((event) => event.released)).toStrictEqual([1, 0]);
    expect(await result.preparer.prepare(reduced.source)).toBe(result.prepared);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.released)).toStrictEqual([1, 0]);
    await result.preparer.releaseUnused();
  });

  it('awaits projection cleanup before an enforcement failure escapes', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const cleanupEvents: string[] = [];
    const slowRelease = {
      ...provider,
      projectPromptEnvelope: async (
        options: Parameters<
          NonNullable<typeof provider.projectPromptEnvelope>
        >[0],
      ) => {
        const projection = await provider.projectPromptEnvelope?.(options);
        if (projection === undefined) throw new Error('Expected projection');
        return {
          ...projection,
          releaseIfUnsent: async () => {
            await Promise.resolve();
            await projection.releaseIfUnsent?.();
            cleanupEvents.push('released');
          },
        };
      },
    };

    const error = await prepareSourcePromptEnvelopeAfterEnforcement({
      provider: slowRelease,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        throw new Error('enforcement failed');
      },
    }).catch((reason: unknown) => reason);

    expect(errorMessage(error)).toBe('enforcement failed');
    expect(cleanupEvents).toStrictEqual(['released']);
    expect(events[0].released).toBe(1);
    expect(fixture.state.closed).toBe(1);
  });

  it('does not project or send when enforcement rejects before estimating', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    let sendCount = 0;

    await expect(
      enforceAndStreamSourcePromptEnvelopeRetries({
        provider,
        source: fixture.source,
        buildOptions,
        enforce: () => Promise.reject(new Error('enforcement failed')),
        shouldRetryOnError: () => false,
        async *send() {
          sendCount += 1;
          yield responseRow;
        },
      }),
    ).rejects.toThrow('enforcement failed');

    expect(events).toHaveLength(0);
    expect(sendCount).toBe(0);
    expect(fixture.state.closed).toBe(1);
  });

  it('keeps the projection reserved while a send is consuming it and discharges it once afterwards', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: () => false,
      async *send(prepared) {
        expect(prepared.options.promptEnvelopeTransportToken).toBe(
          events[0].token,
        );
        yield responseRow;
        yield responseRow;
      },
    });

    await stream.next();
    expect(events[0].released).toBe(0);
    await stream.next();
    expect((await stream.next()).done).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].released).toBe(1);
    expect(fixture.state.closed).toBe(1);
  });

  it('hands each retry attempt a fresh projection and releases only the prior unsent one', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const observedAttempts: Array<{
      readonly attemptIndex: number;
      readonly transportToken: object | undefined;
      readonly priorReleased: number | undefined;
    }> = [];
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider,
      source: fixture.source,
      buildOptions,
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: (error) =>
        error instanceof Error && error.message === 'retry once',
      async *send(prepared, attemptIndex) {
        observedAttempts.push({
          attemptIndex,
          transportToken: prepared.options.promptEnvelopeTransportToken,
          priorReleased: events[attemptIndex - 1]?.released,
        });
        if (attemptIndex === 0) {
          throw new Error('retry once');
        }
        yield responseRow;
      },
    });

    expect((await stream.next()).value).toStrictEqual(responseRow);
    expect(observedAttempts).toStrictEqual([
      {
        attemptIndex: 0,
        transportToken: events[0].token,
        priorReleased: undefined,
      },
      { attemptIndex: 1, transportToken: events[1].token, priorReleased: 1 },
    ]);
    expect(events[1].token).not.toBe(events[0].token);
    expect(events.map((event) => event.released)).toStrictEqual([1, 0]);
    await stream.return?.();
    expect(events.map((event) => event.released)).toStrictEqual([1, 1]);
    expect(fixture.state.closed).toBe(1);
  }, 10_000);

  it('prepares a fresh projection after discarding the prior projection for the same source', async () => {
    const fixture = await diskSource(root());
    const { provider, events, buildOptions } = lifecycleProvider();
    const preparer = createSourcePromptEnvelopePreparer(provider, buildOptions);
    try {
      const first = await preparer.prepare(fixture.source);
      await preparer.discardProjection();
      const second = await preparer.prepare(fixture.source);

      expect(events.map((event) => event.released)).toStrictEqual([1, 0]);
      expect(second).not.toBe(first);
      expect(second.options.promptEnvelopeTransportToken).not.toBe(
        first.options.promptEnvelopeTransportToken,
      );
      expect(fixture.state.closed).toBe(0);
    } finally {
      await preparer.releaseUnused();
    }
  });

  it('releases every unsent projection and owner and aggregates cleanup failures', async () => {
    const fixture = await diskSource(root());
    const { provider, buildOptions } = lifecycleProvider();
    const failingRelease = {
      ...provider,
      projectPromptEnvelope: async (
        options: Parameters<
          NonNullable<typeof provider.projectPromptEnvelope>
        >[0],
      ) => {
        const projection = await provider.projectPromptEnvelope?.(options);
        if (projection === undefined) throw new Error('Expected projection');
        return {
          ...projection,
          releaseIfUnsent: () =>
            Promise.reject(new Error('projection cleanup failed')),
        };
      },
    };
    const closeFailure = new Error('source cleanup failed');
    const failingClose = {
      ...fixture.source,
      close: () => {
        fixture.source.close();
        throw closeFailure;
      },
    };
    const preparer = createSourcePromptEnvelopePreparer(
      failingRelease,
      buildOptions,
    );
    await preparer.prepare(failingClose);

    const thrown = await preparer
      .releaseUnused()
      .catch((error: unknown) => error);

    assertInstanceOf(
      thrown,
      AggregateError,
      'Expected aggregate cleanup failure',
    );
    expect(thrown.errors.map((error) => errorMessage(error))).toStrictEqual([
      'projection cleanup failed',
      'source cleanup failed',
    ]);
    expect(fixture.state.closed).toBe(1);
  });
});
