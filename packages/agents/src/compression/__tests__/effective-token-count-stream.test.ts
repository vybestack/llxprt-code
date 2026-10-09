import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withSuffixFixture,
  suffixRow,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { computeEffectiveTokenCount } from '../effectiveTokenCount.js';
import { ChatSession } from '../../core/chatSession.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
} from '../../core/__tests__/chatSession-density-helpers.js';

function thinkingRow(index: number): IContent {
  const row = suffixRow(index);
  if (index % 4 !== 0) return row;
  return {
    ...row,
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'r'.repeat(index % 9),
        sourceField: 'reasoning_content',
      },
      { type: 'thinking', thought: 'second', sourceField: 'reasoning_content' },
    ],
  };
}

function reasoningContext(
  base: AgentRuntimeContext,
  include: boolean,
  policy: 'all' | 'allButLast' | 'none',
): AgentRuntimeContext {
  return {
    ...base,
    ephemerals: {
      ...base.ephemerals,
      reasoning: {
        ...base.ephemerals.reasoning,
        includeInContext: () => include,
        stripFromContext: () => policy,
      },
    },
  };
}

function strippedTokens(
  size: number,
  policy: 'all' | 'allButLast' | 'none',
): number {
  let sum = 0;
  let last = 0;
  for (let index = 0; index < size; index += 4) {
    last = Math.ceil((index % 9) / 4) + 2;
    sum += last;
  }
  return policy === 'allButLast' ? sum - last : sum;
}

describe('reasoning token accounting over the real curated journal', () => {
  for (const size of [512, 8192]) {
    for (const policy of ['all', 'allButLast', 'none'] as const) {
      it(`discounts ${policy} thinking at ${size} rows without eager history`, async () => {
        await withSuffixFixture(
          size,
          async (service, ownership, counters) => {
            service.setBaseTokenOffset(100000);
            const context = reasoningContext(
              buildRuntimeContext(service),
              false,
              policy,
            );
            const restoreMaterialization = forbidHistoryMaterializationForTest(
              service,
              'eager curated read',
            );
            try {
              const expected = 100000 - strippedTokens(size, policy);
              expect(await computeEffectiveTokenCount(service, context)).toBe(
                expected,
              );
              const chat = new ChatSession(
                context,
                buildMockContentGenerator(),
                { maxOutputTokens: 100 },
              );
              expect(await chat.getProjectedPromptBaseline()).toBe(expected);
              expect(await chat.shouldCompress()).toBe(false);
              expect(await chat.shouldCompress(100000)).toBe(true);
              expect(counters.snapshot().peakDecodedRows).toBe(1);
              expect(ownership.snapshot().liveRows).toBe(0);
            } finally {
              restoreMaterialization();
            }
          },
          0,
          thinkingRow,
        );
      }, 120_000);
    }
  }
});

describe('reasoning accounting policy boundaries', () => {
  it('treats a zero-token last thinking block as the preserved row and ignores invalid AI rows', async () => {
    await withSuffixFixture(0, async (service) => {
      await service.addBatch(
        [
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: 'valid' },
              { type: 'thinking', thought: '12345678' },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              { type: 'thinking', thought: 'invalid', sourceField: 'thinking' },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: 'last' },
              { type: 'thinking', thought: '' },
            ],
          },
          suffixRow(3),
        ],
        'test',
      );
      const baseline = service.getTotalTokens();
      const context = reasoningContext(
        buildRuntimeContext(service),
        false,
        'allButLast',
      );
      expect(await computeEffectiveTokenCount(service, context)).toBe(
        Math.max(0, baseline - 2),
      );
    });
  });

  it('does not open history when reasoning stays in context', async () => {
    await withSuffixFixture(
      512,
      async (service, ownership) => {
        service.setBaseTokenOffset(900);
        const context = reasoningContext(
          buildRuntimeContext(service),
          true,
          'all',
        );
        expect(await computeEffectiveTokenCount(service, context)).toBe(900);
        expect(ownership.snapshot().acquisitions).toBe(0);
      },
      0,
      thinkingRow,
    );
  });

  it('never discounts more than the available token count', async () => {
    await withSuffixFixture(
      12,
      async (service) => {
        service.setBaseTokenOffset(1);
        const context = reasoningContext(
          buildRuntimeContext(service),
          false,
          'all',
        );
        expect(await computeEffectiveTokenCount(service, context)).toBe(0);
      },
      0,
      thinkingRow,
    );
  });
});
