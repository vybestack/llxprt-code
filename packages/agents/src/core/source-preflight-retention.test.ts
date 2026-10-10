/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PreparedSourcePromptEnvelopeSend,
} from './prompt-envelope-source-send.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  preflightEndpoint,
  preflightDisk,
  preflightRuntime,
  preflightInstructions,
  barrier,
} from './__tests__/support/source-preflight-fixture.js';
import { sourceHeap } from './__tests__/support/streamprocessor-source-measurements.js';

const root = sourceRootSetup();
const retained: Array<
  () => { prepared: PreparedSourcePromptEnvelopeSend; row: IContent }
> = [];
const weakPrepared: Array<WeakRef<PreparedSourcePromptEnvelopeSend>> = [];
const weakRows: Array<WeakRef<IContent>> = [];
async function prepareCycle(large: boolean, trap: boolean): Promise<void> {
  const fixture = await preflightDisk(root(), large);
  const http = preflightEndpoint();
  const setup = preflightRuntime(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    'gpt-5.6',
  );
  const arrived = barrier();
  const held = barrier();
  const controller = new AbortController();
  let callbacks = 0;
  const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
    provider: setup.provider,
    source: fixture.source,
    signal: controller.signal,
    buildOptions: (source) =>
      buildSourceProviderChatOptions(
        source,
        undefined,
        setup.context,
        setup.invocation,
        undefined,
        preflightInstructions,
      ),
    enforce: async (source, estimate) => {
      await estimate(source);
      return source;
    },
    async onPrepared(
      prepared: PreparedSourcePromptEnvelopeSend,
    ): Promise<void> {
      callbacks++;
      weakPrepared.push(new WeakRef(prepared));
      for await (const row of prepared.source.openReader(controller.signal)) {
        weakRows.push(new WeakRef(row));
        if (trap) retained.push(() => ({ prepared, row }));
      }
      arrived.release();
      await held.wait;
      controller.signal.throwIfAborted();
    },
    shouldRetryOnError: () => false,
  });
  const pending = stream.next();
  const outcome = pending.then(
    () => 'sent',
    () => 'failed',
  );
  try {
    expect(
      await Promise.race([arrived.wait.then(() => 'prepared'), outcome]),
    ).toBe('prepared');
    expect(http.bodies).toHaveLength(0);
    controller.abort(new Error('retention cancel'));
    held.release();
    expect(await outcome).toBe('failed');
    expect(callbacks).toBe(1);
    expect(fixture.state.active).toBe(0);
    expect(fixture.state.closed).toBe(1);
    expect(activeRequestBodyCount()).toBe(0);
  } finally {
    held.release();
    await stream.return?.();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}
async function measureRetention(trap: boolean) {
  retained.length = 0;
  weakPrepared.length = 0;
  weakRows.length = 0;
  await prepareCycle(false, false);
  await sourceHeap();
  weakPrepared.length = 0;
  weakRows.length = 0;
  const baseline = await sourceHeap();
  await prepareCycle(true, trap);
  const settled = await sourceHeap();
  return {
    baseline,
    settled,
    delta: settled - baseline,
    livePrepared: weakPrepared.filter((ref) => ref.deref() !== undefined)
      .length,
    liveRows: weakRows.filter((ref) => ref.deref() !== undefined).length,
    retainedClosures: retained.length,
    activeBodies: activeRequestBodyCount(),
  };
}
function expectReleased(facts: Awaited<ReturnType<typeof measureRetention>>) {
  expect(facts.delta).toBeLessThan(1_048_576);
  expect(facts.livePrepared).toBe(0);
  expect(facts.liveRows).toBe(0);
  expect(facts.retainedClosures).toBe(0);
}
describe('source preflight retained callback ownership', () => {
  it('releases prepared callback closures and rows below the unchanged 1MiB gate', async () => {
    const facts = await measureRetention(false);
    expectReleased(facts);
    expect(facts.activeBodies).toBe(0);
  }, 90000);
  it('trap: deliberately retained prepared closures fail the release gate', async () => {
    const facts = await measureRetention(true);
    expect(() => expectReleased(facts)).toThrow('expect(received)');
  }, 90000);
});
