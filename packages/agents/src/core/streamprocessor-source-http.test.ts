/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import {
  projectionEndpoint,
  projectionInstructions,
} from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { observeDiskBody } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-body-observer.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
  sourceWireOracle,
  largestSourceRowBytes,
} from './__tests__/support/streamprocessor-source-fixture.js';
import {
  sourceHeap,
  warmSourceProcessor,
  measureSourceUpload,
} from './__tests__/support/streamprocessor-source-measurements.js';

const root = sourceRootSetup();
async function nativeEstimate(
  setup: Awaited<ReturnType<typeof processorFixture>>,
  large: boolean,
) {
  const projection = await setup.provider.projectPromptEnvelope({
    contents: {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 64; index++)
          yield diskTextRow(index, large);
        yield sourcePending;
      },
    },
    config: setup.config,
    runtime: setup.runtime.providerRuntime,
    settings: setup.settings,
    systemInstruction: projectionInstructions,
  });
  try {
    return await estimatePromptEnvelope(
      setup.provider.name,
      projection,
      setup.nativeFactory,
    );
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

async function acceptance(large: boolean) {
  await warmSourceProcessor(root());
  const http = projectionEndpoint(true);
  const setup = await processorFixture(
    root(),
    `http://127.0.0.1:${http.server.port}/v1`,
    large,
  );
  const oracle = await nativeEstimate(setup, large);
  const observer = observeDiskBody();
  const baseline = await sourceHeap();
  const idleLive = setup.history.references.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const idleInputLive = setup.history.inputReferences.filter(
    (row) => row.deref() !== undefined,
  ).length;
  const selection = { requestHistorySource: 'responses-disk-text' as const };
  const started = setup.processor.makeApiCallAndProcessStream(
    {
      message: 'Answer the history.',
      config:
        process.env.ISSUE854_ORIGINAL_STREAM_PATH === '1' ? {} : selection,
    },
    'stream-source-http',
    sourcePending,
  );
  void started.catch(() => undefined);
  try {
    const measurements = await measureSourceUpload(
      started,
      http,
      observer,
      setup.history,
    );
    const facts = {
      large,
      retainRows: process.env.ISSUE854_RETAIN_STREAM_ROWS === '1',
      originalArrayRoute: process.env.ISSUE854_ORIGINAL_STREAM_PATH === '1',
      oracle,
      estimate: setup.processor.getPromptEnvelopeEstimate(),
      baseline,
      idleLive,
      idleInputLive,
      ...measurements,
      ownersFinal: setup.history.owners,
      originalRowReads: setup.history.references.length,
      projections: setup.provider.tokens.length,
      distinctRetryTokens:
        setup.provider.tokens.length >= 3 &&
        setup.provider.tokens[setup.provider.tokens.length - 1] !==
          setup.provider.tokens[setup.provider.tokens.length - 2],
      largestRowBytes: largestSourceRowBytes(large),
      logPrompts: setup.config.getTelemetryLogPromptsEnabled(),
      telemetryEnabled: setup.config.getTelemetryEnabled(),
      finalDemand: observer.state,
      requests: setup.requests,
      bodies: http.bodies,
      expected: sourceWireOracle(large),
      activeBodies: activeRequestBodyCount(),
    };
    const evidence = process.env.ISSUE854_STREAM_EVIDENCE;
    if (evidence !== undefined)
      writeFileSync(
        join(evidence, `acceptance-${large}-${process.pid}.json`),
        JSON.stringify(facts, null, 2),
      );
    return facts;
  } finally {
    observer.resume.release();
    http.readBody.release();
    http.respond.release();
    const stream = await started.catch(() => undefined);
    await stream?.return(undefined);
    observer.restore();
    setup.history.dispose();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}
function assertAcceptance(facts: Awaited<ReturnType<typeof acceptance>>): void {
  expect(facts.output).toBe('finished');
  expect(facts.estimate).toStrictEqual(facts.oracle);
  expect(facts.bodies).toStrictEqual([facts.expected, facts.expected]);
  expect(facts.idleInputLive).toBe(0);
  expect(facts.inputLiveFirst).toBe(0);
  expect(facts.inputLiveLast).toBe(0);
  expect(facts.idleLive).toBe(0);
  expect(facts.liveFirst).toBe(0);
  expect(facts.liveLast).toBe(0);
  expect(facts.largestRowBytes).toBeGreaterThan(
    facts.large ? 10 * 1024 * 1024 : 500,
  );
  expect(facts.originalRowReads).toBe(130);
  expect(facts.projections).toBe(3);
  expect(facts.distinctRetryTokens).toBe(true);
  expect(facts.ownersFinal.map((owner) => owner.count)).toStrictEqual([65, 65]);
  expect(facts.telemetryEnabled).toBe(true);
  expect(facts.logPrompts).toBe(false);
  expect(
    facts.requests.some((request) => request.requestText !== undefined),
  ).toBe(false);
  expect(
    Math.max(
      facts.firstHeap,
      facts.receiverHeap,
      facts.lastHeap,
      facts.finalHeap,
    ) - facts.baseline,
  ).toBeLessThanOrEqual(1024 * 1024);
  expect(facts.ownersFinal.every((owner) => owner.closed)).toBe(true);
  expect(facts.activeBodies).toBe(0);
  expect(facts.requests.map((event) => event.promptId)).toStrictEqual([
    'stream-source-http',
    'stream-source-http',
  ]);
}

describe('actual StreamProcessor disk history HTTP ownership', () => {
  it.each(process.env.ISSUE854_STREAM_LARGE === '1' ? [false, true] : [false])(
    'sends exact finalized rows and releases original owners at BODY pauses, oversized=%s',
    async (large) => {
      const facts = await acceptance(large);
      expect(facts.expected.bytes).toBeGreaterThan(37_000);
      assertAcceptance(facts);
    },
    600000,
  );
  it('rejects array-only logging before HTTP rather than omitting enabled logs', async () => {
    const http = projectionEndpoint(false);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
    );
    setup.config.updateTelemetrySettings({ enabled: true, logPrompts: true });
    http.readBody.release();
    http.respond.release();
    try {
      await expect(
        setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: { requestHistorySource: 'responses-disk-text' },
          },
          'logging',
          sourcePending,
        ),
      ).rejects.toThrow('source request logging');
      expect(http.bodies).toHaveLength(0);
    } finally {
      setup.history.dispose();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 60000);
  it('applies existing context policy and rejects required array compression before HTTP', async () => {
    const http = projectionEndpoint(false);
    const setup = await processorFixture(
      root(),
      `http://127.0.0.1:${http.server.port}/v1`,
    );
    setup.settings.set('context-limit', 4000);
    http.readBody.release();
    http.respond.release();
    try {
      await expect(
        setup.processor.makeApiCallAndProcessStream(
          {
            message: 'Answer',
            config: { requestHistorySource: 'responses-disk-text' },
          },
          'overflow',
          sourcePending,
        ),
      ).rejects.toThrow('source compression');
      expect(http.bodies).toHaveLength(0);
      expect(setup.history.owners.every((owner) => owner.closed)).toBe(true);
    } finally {
      setup.history.dispose();
      await http.server.stop(true);
      await setup.config.dispose();
    }
  }, 60000);
});
