/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { errorMessage } from '@vybestack/llxprt-code-test-utils';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createSourcePromptEnvelopePreparer,
  prepareSourcePromptEnvelopeAfterEnforcement,
  enforceAndStreamSourcePromptEnvelopeRetries,
} from './promptEnvelopeSendSeam.js';
import {
  diskSource,
  digest,
  lifecycleProvider,
  sourceRootSetup,
} from './prompt-envelope-source-test-helpers.js';

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
    expect(prepared.estimate.estimatedPromptTokens).toBeGreaterThan(
      10 * 1024 * 1024,
    );
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
      await Bun.sleep(0);
      Bun.gc(true);
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
