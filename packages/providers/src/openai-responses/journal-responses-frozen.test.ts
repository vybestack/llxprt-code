/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  caseOf,
  formatById,
  SEEDS_PER_FORMAT,
  type FrozenSettings,
} from '../__tests__/support/frozenWire/frozenCases.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from './journal-responses-length.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';
import { indexedResponsesInput } from './journal-responses.test-helper.js';
import {
  analyzeResponses,
  FULL_STATELESS_SEND,
} from './__tests__/support/lengthModel/responsesLengthModel.js';

const TIME = 1_780_000_000_123;
function formatSettings(input: FrozenSettings): RowFormatSettings {
  return {
    formatId: 'responses',
    formatRev: 1,
    model: input.model,
    endpoint: 'https://example.test/v1',
    isOAuth: false,
    toolNameTransform: 'none',
    supportsUrlImages: true,
    reasoningEnabled: false,
    reasoningFieldName: 'reasoning_content',
    mediaPdfEnabled: input.ephemerals['media.pdf.enabled'] !== false,
    unsupportedMedia: 'notice',
    outputLimits: null,
  };
}

async function checkSeed(route: string, seed: number): Promise<void> {
  const frozen = await caseOf(formatById(route), seed);
  const rows = await normalizedRows(frozen.rows.filter(isCuratedContent));
  const settings = formatSettings(frozen.settings);
  const session = await JournalSession.createUnlinked();
  try {
    await session.append(frozen.rows);
    await session.registerRowFormat(responsesLengthRegistration(settings));
    const selected =
      frozen.settings.ephemerals['reasoning.includeInContext'] === false
        ? 1
        : 0;
    const context = {
      includeReasoningInContext: selected === 0,
      outputLimits: parseOutputLimits({}),
      debug: () => undefined,
      mediaPdfEnabled: settings.mediaPdfEnabled,
      reasoningIdTime: TIME,
    };
    const input = buildOpenAIResponsesInput(rows, context);
    const request: OpenAIResponsesRequest = {
      model: settings.model,
      input: [],
      stream: true,
      instructions: frozen.settings.systemInstruction ?? undefined,
    };
    const expected = Buffer.from(JSON.stringify({ ...request, input }));
    const pin = await session.store.snapshot();
    const query = await IndexedJournalRequestSnapshot.create(pin);
    try {
      const nativeInput = await indexedResponsesInput(query, context);
      expect({
        route,
        seed,
        bytes: Buffer.from(JSON.stringify({ ...request, input: nativeInput })),
      }).toStrictEqual({ route, seed, bytes: expected });
      const plan = planStoredResponsesRequest(
        pin,
        settings,
        selected,
        request,
        TIME,
      );
      expect({ route, seed, bytes: plan.contentLength }).toStrictEqual({
        route,
        seed,
        bytes: expected.byteLength,
      });
      expect(plan.inputBytes).toBe(
        analyzeResponses(
          rows,
          {
            includeReasoning: selected === 0,
            pdfEnabled: settings.mediaPdfEnabled,
            reasoningIdTime: TIME,
          },
          FULL_STATELESS_SEND,
          seed,
        ).predicted,
      );
      expect(plan.items).toBe(input.length);
    } finally {
      await query.close();
      await pin.close();
    }
  } finally {
    await session.close();
  }
}

for (const route of ['openai-responses', 'openai-responses-via-openai'])
  describe(`native Responses format on unchanged ${route} corpus inputs`, () => {
    let matched = 0;
    for (let first = 0; first < SEEDS_PER_FORMAT; first += 500)
      it(`full normalized request bytes and declared lengths for seeds ${first}..${first + 499}`, async () => {
        for (let seed = first; seed < first + 500; seed++) {
          await checkSeed(route, seed);
          matched++;
        }
        expect(matched).toBe(first + 500);
      });
    it('accounts for all 5000 inputs without exclusions or fixture changes', () => {
      expect(matched).toBe(SEEDS_PER_FORMAT);
      process.stdout.write(
        `Native Responses frozen ${JSON.stringify({ route, matched, unsupported: 0 })}\n`,
      );
    });
  });
