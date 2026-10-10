/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { getRequestSignal } from '@vybestack/llxprt-code-providers/utils/abortSignal.js';
import {
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PreparedSourcePromptEnvelopeSend,
} from './prompt-envelope-source-send.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import {
  buildTransportSourceOptions,
  preflightRuntime,
  preflightDisk,
  preflightEndpoint,
  preflightOracle,
  preflightInstructions,
  PreflightExporter,
  barrier,
} from './__tests__/support/source-preflight-fixture.js';

const root = sourceRootSetup();
type Fault = 'hold' | 'reject' | 'abort' | 'no-ack';
type Publication = Awaited<ReturnType<typeof publication>>;
async function publication(large: boolean, fault: Fault) {
  const fixture = await preflightDisk(root(), large);
  const http = preflightEndpoint(fault === 'hold');
  const setup = preflightRuntime(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    true,
  );
  const oracle = await preflightOracle(setup, large);
  await shutdownTelemetry(setup.config);
  const exporter = new PreflightExporter(
    join(root(), 'preflight.jsonl'),
    fault === 'abort' ? 'hold' : fault,
  );
  initializeTelemetry(setup.config, exporter);
  const directory = join(root(), 'artifacts');
  await mkdir(directory);
  return {
    fixture,
    http,
    setup,
    oracle,
    exporter,
    directory,
    controller: new AbortController(),
    state: { callbacks: 0, retries: 0, success: 0, active: 0 },
    artifactIds: new Array<string>(),
    estimates: new Array<object>(),
    transactions: new Array<Promise<void>>(),
  };
}
async function publish(
  input: Publication,
  prepared: PreparedSourcePromptEnvelopeSend,
  index: number,
): Promise<void> {
  input.state.callbacks++;
  input.state.active++;
  try {
    const signal = getRequestSignal(prepared.options);
    const source = await stageTurnRequestArtifact(
      input.directory,
      { [Symbol.asyncIterator]: () => prepared.source.openReader(signal) },
      signal,
    );
    input.artifactIds.push(source.artifact_id);
    input.estimates.push(prepared.estimate);
    try {
      await createTelemetryAdapterFromConfig(input.setup.config).logApiRequest({
        model: 'gpt-5.6',
        promptId: `preflight-${index}`,
        requestArtifact: {
          schema_version: 3,
          serialization: 'independent-safe-json-rows-v1',
          source,
        },
        signal,
      });
    } finally {
      await rm(source.artifact_path);
    }
  } finally {
    input.state.active--;
  }
}
async function start(input: Publication, fault: Fault) {
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider: input.setup.provider,
    source: input.fixture.source,
    signal: input.controller.signal,
    buildOptions: (source) =>
      buildTransportSourceOptions(
        source,
        undefined,
        input.setup.context,
        input.setup.invocation,
        { requestId: 'source-preflight' },
        preflightInstructions,
      ),
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    onPrepared: (prepared, index): Promise<void> => {
      const operation = publish(input, prepared, index);
      input.transactions.push(operation);
      return operation;
    },
    shouldRetryOnError: (error) => {
      input.state.retries++;
      return (
        fault !== 'hold' ||
        (error instanceof Error && 'status' in error && error.status === 503)
      );
    },
  });
  const pending = (async (): Promise<void> => {
    for await (const _row of stream) input.state.success++;
  })();
  return {
    stream,
    pending,
    settled: pending.then(
      () => 'sent',
      () => 'failed',
    ),
  };
}
async function heldAttempts(
  input: Publication,
  send: Awaited<ReturnType<typeof start>>,
): Promise<void> {
  await Bun.sleep(75);
  expect(input.http.bodies).toHaveLength(0);
  expect(input.state.success).toBe(0);
  expect(input.exporter.completions).toBe(0);
  input.exporter.releases[0].release();
  expect(
    await Promise.race([
      input.exporter.pauses[1].wait.then(() => 'prepared'),
      send.settled,
    ]),
  ).toBe('prepared');
  await Bun.sleep(75);
  expect(input.http.bodies).toStrictEqual([input.oracle.body]);
  expect(input.state.success).toBe(0);
  input.exporter.releases[1].release();
  await send.pending;
  expect(input.http.bodies).toStrictEqual([
    input.oracle.body,
    input.oracle.body,
  ]);
  expect(input.state.callbacks).toBe(2);
  expect(new Set(input.artifactIds).size).toBe(2);
  expect(input.estimates).toStrictEqual([
    input.oracle.estimate,
    input.oracle.estimate,
  ]);
  expect(input.exporter.completions).toBe(2);
  expect(input.state.success).toBeGreaterThan(0);
}
async function rejectedAttempt(
  input: Publication,
  send: Awaited<ReturnType<typeof start>>,
  fault: Fault,
): Promise<void> {
  if (fault === 'abort') {
    input.controller.abort(new Error('preflight cancelled'));
    input.exporter.releaseAll();
  }
  const outcome = await send.pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (fault === 'abort')
    expect(outcome).toMatchObject({
      name: 'AbortError',
      cause: input.controller.signal.reason,
    });
  else
    expect(outcome).toMatchObject({
      message: expect.stringContaining(
        fault === 'reject' ? 'preflight exporter rejected' : 'acknowledgement',
      ),
    });
  const transaction = await input.transactions[0].then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(transaction).toBeInstanceOf(Error);
  expect(input.http.bodies).toHaveLength(0);
  expect(input.state.success).toBe(0);
  expect(input.state.callbacks).toBe(1);
  expect(input.state.retries).toBe(0);
  expect(input.exporter.completions).toBe(0);
}
async function runPublication(large: boolean, fault: Fault): Promise<number> {
  const input = await publication(large, fault);
  const send = await start(input, fault);
  try {
    expect(
      await Promise.race([
        input.exporter.pauses[0].wait.then(() => 'prepared'),
        send.settled,
      ]),
    ).toBe('prepared');
    if (fault === 'hold') await heldAttempts(input, send);
    else await rejectedAttempt(input, send, fault);
    expect(input.state.active).toBe(0);
    expect(await readdir(input.directory)).toStrictEqual([]);
    expect(input.fixture.state.active).toBe(0);
    expect(input.fixture.state.closed).toBe(1);
    expect(activeRequestBodyCount()).toBe(0);
    const evidence = process.env.ISSUE854_LOGGING_EVIDENCE;
    if (evidence !== undefined)
      await writeFile(
        join(evidence, `${fault}-${large}.json`),
        JSON.stringify(
          {
            ...input.state,
            artifactIds: input.artifactIds,
            estimates: input.estimates,
            oracle: input.oracle,
            bodies: input.http.bodies,
            completions: input.exporter.completions,
            fixture: input.fixture.state,
          },
          null,
          2,
        ),
      );
    return input.http.bodies.length;
  } finally {
    input.controller.abort(new Error('test cleanup'));
    input.exporter.releaseAll();
    await send.settled;
    await send.stream.return?.();
    await input.http.server.stop(true);
    await shutdownTelemetry(input.setup.config);
    await input.setup.config.dispose();
  }
}

describe('awaited source prepared preflight with actual Responses and validated FileLogExporter', () => {
  it.each([false, true])(
    'awaits each 503 attempt ACK and preserves complete native estimate and HTTP bytes, oversized=%s',
    async (large) => {
      expect(await runPublication(large, 'hold')).toBe(2);
    },
    600000,
  );
  it.each(['reject', 'abort', 'no-ack'] as const)(
    'rejects %s before HTTP without retry or success and closes source/artifact ownership',
    async (fault) => {
      expect(await runPublication(false, fault)).toBe(0);
    },
    90000,
  );
  it('cancels a never-resolving prepared callback without waiting for its acknowledgement', async () => {
    const input = await publication(false, 'hold');
    const arrived = barrier();
    const held = barrier();
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: input.setup.provider,
      source: input.fixture.source,
      signal: input.controller.signal,
      buildOptions: (source) =>
        buildTransportSourceOptions(
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
      onPrepared: (): Promise<void> => {
        input.state.callbacks++;
        arrived.release();
        return held.wait;
      },
      shouldRetryOnError: () => {
        input.state.retries++;
        return true;
      },
    });
    const next = stream.next();
    try {
      expect(
        await Promise.race([
          arrived.wait.then(() => 'prepared'),
          next.then(() => 'sent'),
        ]),
      ).toBe('prepared');
      input.controller.abort(new Error('no acknowledgement'));
      await expect(next).rejects.toMatchObject({
        name: 'AbortError',
        cause: input.controller.signal.reason,
      });
      expect(input.http.bodies).toHaveLength(0);
      expect(input.fixture.state.closed).toBe(1);
      expect(input.fixture.state.active).toBe(0);
      expect(activeRequestBodyCount()).toBe(0);
      expect(input.state.callbacks).toBe(1);
      expect(input.state.retries).toBe(0);
    } finally {
      held.release();
      await stream.return?.();
      await input.http.server.stop(true);
      await shutdownTelemetry(input.setup.config);
      await input.setup.config.dispose();
    }
  }, 30000);
});
