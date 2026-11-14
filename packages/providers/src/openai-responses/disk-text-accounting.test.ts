/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

const bigText = 'retained context sentence. '.repeat(400);

function history(usage: boolean): readonly IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: bigText }] },
    {
      speaker: 'ai',
      metadata: {
        id: 'resp_parent',
        responsesStored: true,
        ...(usage
          ? {
              usage: {
                promptTokens: 10000,
                completionTokens: 0,
                totalTokens: 10000,
              },
            }
          : {}),
      },
      blocks: [{ type: 'text', text: bigText }],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  ];
}

describe('Responses source route stateful prompt accounting', () => {
  let harness: SourceRouteHarness;
  beforeEach(async () => {
    harness = await startSourceRouteHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  async function estimate(
    options: ReturnType<SourceRouteHarness['options']>,
  ): Promise<PromptEnvelopeEstimate> {
    const projection = await harness.project(options);
    try {
      return await estimatePromptEnvelope(
        'openai-responses',
        projection,
        harness.setup.factory,
      );
    } finally {
      await projection.releaseIfUnsent?.();
    }
  }

  for (const usage of [true, false]) {
    it(`estimates retained, incremental and effective tokens like the array route (${usage ? 'observed usage' : 'no observed usage'})`, async () => {
      const ephemerals = { 'responses-stateful': true };
      const baseline = await estimate(
        harness.arrayOptions(history(usage), ephemerals),
      );
      const source = await estimate(
        harness.options(history(usage), ephemerals),
      );
      expect(baseline.statefulParentUsed).toBe(true);
      expect(baseline.incrementalTokens).toBeLessThan(
        baseline.effectiveTokens ?? 0,
      );
      expect(source).toStrictEqual(baseline);
    }, 60000);
  }

  it('counts the observed retained context in the source effective tokens', async () => {
    const source = await estimate(
      harness.options(history(true), { 'responses-stateful': true }),
    );
    expect(source.retainedBaselineTokens).toBe(10000);
    expect(source.effectiveTokens).toBe(
      10000 + (source.incrementalTokens ?? 0),
    );
  }, 60000);
});
