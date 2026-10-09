/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { StreamProcessor } from './StreamProcessor.js';
import { ConversationManager } from './ConversationManager.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
} from './__tests__/support/streamprocessor-source-fixture.js';
import {
  preflightEndpoint,
  barrier,
} from './__tests__/support/source-preflight-fixture.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';

const root = sourceRootSetup();
type Mode = 'release' | 'reject' | 'abort';
async function request(mode: Mode) {
  const http = preflightEndpoint();
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    false,
    64,
  );
  const arrived = barrier();
  const held = barrier();
  const controller = new AbortController();
  const events: string[] = [];
  const runtime = {
    ...setup.runtime,
    telemetry: {
      ...setup.runtime.telemetry,
      async logApiRequest(
        event: Parameters<typeof setup.runtime.telemetry.logApiRequest>[0],
      ): Promise<void> {
        setup.requests.push(event);
        events.push('request');
        arrived.release();
        await held.wait;
        controller.signal.throwIfAborted();
        if (mode === 'reject') throw new Error('source scalar rejected');
        events.push('ack');
      },
      logApiResponse(): void {
        events.push('success');
      },
      logApiError(): void {
        events.push('error');
      },
    },
  };
  const processor = new StreamProcessor(
    runtime,
    new ConversationManager(setup.history, runtime),
    setup.compression,
    () => setup.provider,
    (_source, metadata) => ({ ...runtime.providerRuntime, metadata }),
    setup.history,
    setup.generation,
  );
  const pending = (async (): Promise<void> => {
    const stream = await processor.makeApiCallAndProcessStream(
      {
        message: 'Answer',
        config: {
          requestHistorySource: 'responses-disk-text',
          abortSignal: controller.signal,
        },
      },
      'source-scalar-preflight',
      sourcePending,
    );
    for await (const _chunk of stream) {
      /* Consume the actual response. */
    }
  })();
  return {
    setup,
    http,
    arrived,
    held,
    controller,
    events,
    runtime,
    processor,
    pending,
    outcome: pending.then(
      () => 'sent',
      () => 'failed',
    ),
  };
}
async function beforeAck(
  input: Awaited<ReturnType<typeof request>>,
): Promise<void> {
  await input.arrived.wait;
  await Bun.sleep(75);
  expect(input.http.bodies).toHaveLength(0);
  expect(input.events).toStrictEqual(['request']);
  expect(input.setup.requests).toHaveLength(1);
  expect(input.setup.requests[0]).toMatchObject({
    model: 'gpt-5.6',
    promptId: 'source-scalar-preflight',
    sessionId: input.setup.config.getSessionId(),
    runtimeId: input.runtime.state.runtimeId,
    provider: input.setup.provider.name,
  });
  expect(Object.keys(input.setup.requests[0]).sort()).toStrictEqual([
    'model',
    'promptId',
    'provider',
    'runtimeId',
    'sessionId',
    'timestamp',
  ]);
}
async function afterAck(
  input: Awaited<ReturnType<typeof request>>,
  mode: Mode,
): Promise<void> {
  if (mode === 'abort')
    input.controller.abort(new Error('source scalar aborted'));
  input.held.release();
  const outcome = await input.outcome;
  expect(outcome).toBe(mode === 'release' ? 'sent' : 'failed');
  expect(input.http.bodies).toStrictEqual(
    mode === 'release' ? [sourceWireOracle(false)] : [],
  );
  expect(input.events.includes('success')).toBe(mode === 'release');
  expect(input.processor.getPromptEnvelopeEstimate() === null).toBe(
    mode !== 'release',
  );
  expect(input.setup.history.owners.every((owner) => owner.closed)).toBe(true);
  expect(activeRequestBodyCount()).toBe(0);
}
describe('actual StreamProcessor awaited disabled-source scalar telemetry', () => {
  it.each(['release', 'reject', 'abort'] as const)(
    'awaits %s without changing scalar values or admitting early HTTP',
    async (mode) => {
      const input = await request(mode);
      try {
        await beforeAck(input);
        await afterAck(input, mode);
        expect(input.events.indexOf('success')).toBe(
          mode === 'release' ? 2 : -1,
        );
      } finally {
        input.controller.abort(new Error('test cleanup'));
        input.held.release();
        await input.outcome;
        input.setup.history.dispose();
        await input.http.server.stop(true);
        await input.setup.config.dispose();
      }
    },
    60000,
  );
});
