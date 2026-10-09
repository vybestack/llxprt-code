/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  getRequestSignal,
  raceWithAbort,
} from '@vybestack/llxprt-code-providers/utils/abortSignal.js';
import {
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PreparedSourcePromptEnvelopeSend,
} from './prompt-envelope-source-send.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import {
  preflightDisk,
  preflightRuntime,
  preflightEndpoint,
  preflightInstructions,
  barrier,
} from './source-preflight-fixture.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';

const root = sourceRootSetup();
async function fixture() {
  const disk = await preflightDisk(root(), false);
  const http = preflightEndpoint();
  const setup = preflightRuntime(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
  );
  const directory = join(root(), 'writing');
  await mkdir(directory);
  return {
    disk,
    http,
    setup,
    directory,
    controller: new AbortController(),
    arrived: barrier(),
    held: barrier(),
    cleaned: barrier(),
    state: { callbacks: 0, retries: 0, writerActive: 0 },
  };
}
async function write(
  input: Awaited<ReturnType<typeof fixture>>,
  prepared: PreparedSourcePromptEnvelopeSend,
): Promise<void> {
  input.state.callbacks++;
  input.state.writerActive++;
  const signal = getRequestSignal(prepared.options);
  try {
    await stageTurnRequestArtifact(
      input.directory,
      {
        async *[Symbol.asyncIterator]() {
          for await (const row of prepared.source.openReader(signal)) {
            yield row;
            input.arrived.release();
            await raceWithAbort(input.held.wait, signal);
          }
        },
      },
      signal,
    );
  } finally {
    input.state.writerActive--;
    input.cleaned.release();
  }
}
async function start(input: Awaited<ReturnType<typeof fixture>>) {
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider: input.setup.provider,
    source: input.disk.source,
    signal: input.controller.signal,
    buildOptions: (source) =>
      buildSourceProviderChatOptions(
        source,
        undefined,
        input.setup.context,
        input.setup.invocation,
        undefined,
        preflightInstructions,
      ),
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    onPrepared: (prepared) => write(input, prepared),
    shouldRetryOnError: () => {
      input.state.retries++;
      return true;
    },
  });
  return {
    stream,
    outcome: stream.next().then(
      () => 'sent',
      () => 'failed',
    ),
  };
}
describe('source prepared preflight cancellation during actual artifact writing', () => {
  it.each(['abort', 'return'] as const)(
    'closes artifact writer and source reader before HTTP on %s',
    async (mode) => {
      const input = await fixture();
      const send = await start(input);
      try {
        await input.arrived.wait;
        expect(input.disk.state.active).toBe(1);
        expect((await readdir(input.directory)).length).toBe(1);
        if (mode === 'abort')
          input.controller.abort(new Error('writer cancelled'));
        else await send.stream.return?.();
        expect(await send.outcome).toBe('failed');
        await input.cleaned.wait;
        expect(input.state.writerActive).toBe(0);
        expect(await readdir(input.directory)).toStrictEqual([]);
        expect(input.disk.state.active).toBe(0);
        expect(input.disk.state.closed).toBe(1);
        expect(input.http.bodies).toHaveLength(0);
        expect(input.state.callbacks).toBe(1);
        expect(input.state.retries).toBe(0);
        expect(activeRequestBodyCount()).toBe(0);
      } finally {
        input.controller.abort();
        input.held.release();
        await send.outcome;
        await send.stream.return?.();
        await input.http.server.stop(true);
        await input.setup.config.dispose();
      }
    },
    30000,
  );
});
