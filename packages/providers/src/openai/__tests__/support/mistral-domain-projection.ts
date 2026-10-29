/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { NormalizedGenerateChatOptions } from '../../../BaseProvider.js';
import type { UnitCase } from '../../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { rowsSelection } from '../../../__tests__/support/wireBodyCapture.js';
import { projectOpenAIChatPromptEnvelope } from '../../../runtime/promptEnvelopeProjections.js';
import { prepareRequest } from '../../OpenAIRequestPreparation.js';
import {
  prepareRequestBody,
  readPreparedChatBody,
} from './prepareRequestBody.js';
import {
  oldMistralUnitTokens,
  type MistralStrip,
} from './mistral-unit-token-oracle.js';

interface DomainFixture {
  withHistory(
    rows: readonly IContent[],
    consume: (
      history: HistoryService,
      counter: { reads: number },
    ) => Promise<void>,
  ): Promise<void>;
  estimate(
    rows: ProviderRequestSelection,
    model: string,
    policy: Record<string, unknown>,
  ): Promise<number>;
  options(
    rows: ProviderRequestSelection,
    model: string,
    policy: Record<string, unknown>,
  ): NormalizedGenerateChatOptions;
}
export async function assertMistralDomain(
  input: UnitCase,
  strip: MistralStrip,
  fixture: DomainFixture,
): Promise<void> {
  const model = 'mistral-large-latest';
  const logger = new DebugLogger('mistral-domain-projection');
  const policy = {
    'reasoning.includeInContext': true,
    'reasoning.stripFromContext': strip,
  };
  const units = await oldTailUnits(input.rows, input.tail);
  const old = await prepareRequestBody(
    fixture.options(rowsSelection(units), model, policy),
    model,
    undefined,
    logger,
    'openai',
  );
  const envelope = await projectOpenAIChatPromptEnvelope({
    model,
    messages: [{ role: 'system', content: 'system 雪' }],
  }).legacyEstimate();
  const expectedTokens = envelope + (await oldMistralUnitTokens(units, strip));
  await fixture.withHistory(input.rows, async (history) => {
    const baseline = await history.prepareCuratedForProviderSnapshot([], {});
    try {
      const before = await fixture.estimate(baseline, model, policy);
      const selected = await history.prepareCuratedForProviderSnapshot(
        input.tail,
        {},
      );
      try {
        const prepared = await prepareRequest(
          fixture.options(selected, model, policy),
          model,
          undefined,
          logger,
          'openai',
        );
        try {
          expect(await readPreparedChatBody(prepared.spool)).toStrictEqual(
            old.requestBody,
          );
        } finally {
          await prepared.release();
        }
        expect(await fixture.estimate(selected, model, policy)).toBe(
          expectedTokens,
        );
        expect(await fixture.estimate(baseline, model, policy)).toBe(before);
      } finally {
        await selected.close();
      }
    } finally {
      await baseline.close();
    }
  });
}
