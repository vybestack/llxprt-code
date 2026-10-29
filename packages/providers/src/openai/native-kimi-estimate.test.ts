/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { kimiHistories } from '../__tests__/support/kimi-native-histories.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../runtime/promptEnvelopeProjections.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import { prepareRequestBody } from './__tests__/support/prepareRequestBody.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

const logger = new DebugLogger('native-kimi-estimate-test');
const model = 'unregistered-kimi-compatible';

function options(
  rows: ProviderRequestSelection,
  strip: string,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: rows,
    contentCount: rows.count,
    metadata: {},
    systemInstruction: 'system 雪',
    invocation: createRuntimeInvocationContext({
      fetch: (input, init) => globalThis.fetch(input, init),
      runtimeId: 'native-kimi-estimate',
      providerName: 'kimi',
      ephemeralsSnapshot: {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      },
    }),
    resolved: { model, baseURL: 'https://api.kimi.test/v1', authToken: 'test' },
  };
}

// The history that repeats a call id is left out: the plain OpenAI route
// estimates it one token above the old body as well, so it does not isolate
// anything Kimi does.
const estimated = kimiHistories.filter(
  (history) => history.name !== 'two digit ordinals with later duplicates',
);

describe('native Kimi estimates through production preparation', () => {
  it.each(
    estimated.flatMap((history) =>
      ['none', 'all', 'allButLast'].map((strip) => ({ history, strip })),
    ),
  )(
    'estimates $history.name/$strip as the old Kimi body does',
    async ({ history, strip }) => {
      const old = await prepareRequestBody(
        options(
          rowsSelection(
            await normalizedRows([...history.rows, ...history.pending]),
          ),
          strip,
        ),
        model,
        undefined,
        logger,
        'kimi',
      );
      const expected = await projectOpenAIChatPromptEnvelope(
        old.requestBody,
      ).legacyEstimate();
      const fixture = await journalSendFixture(history.rows, history.pending, {
        directory: 'tmp/kimi-native/fixtures',
      });
      try {
        const prepared = await prepareRequest(
          options(fixture.selection, strip),
          model,
          undefined,
          logger,
          'kimi',
          undefined,
          {},
          true,
        );
        try {
          const projected = prepared.estimate;
          if (projected === undefined)
            throw new Error('Missing mandatory native estimate');
          const projection = projectOpenAIChatPromptEnvelopeFromSource(
            projected.projection,
            { model, releaseIfUnsent: async () => undefined },
          );
          const actual = await estimatePromptEnvelope(
            'openai',
            projection,
            createRuntimeTokenizerFactory(),
          );
          expect(actual.estimatedPromptTokens).toBe(expected);
        } finally {
          await prepared.estimate?.projection.dispose();
          await prepared.release();
        }
      } finally {
        await fixture.close();
      }
    },
  );
});
