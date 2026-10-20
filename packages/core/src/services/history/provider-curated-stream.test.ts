import { observeHistorySynchronouslyForTest } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { DebugLogger } from '../../debug/index.js';
import { HistoryService } from './HistoryService.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import type { IContent } from './IContent.js';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import { providerFixtureRow } from './__tests__/support/provider-curated-test-helpers.js';

import { providerCurationRuleCases } from './__tests__/support/provider-curated-rule-cases.js';
import { buildCuratedHistory } from './historyCuration.js';
class CursorOnlyProviderHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager provider preparation');
  }

  async eagerRowsForTest(): Promise<IContent[]> {
    return this.journal.materialize();
  }
}

describe('journal materialization guard', () => {
  it('preserves the synchronous old materialization trap', async () => {
    const history = new CursorOnlyProviderHistory({ backend: 'old' });
    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager provider preparation',
      );
    } finally {
      await history.dispose();
    }
  });

  it('CursorOnlyProviderHistory rejects journal eager materialization', async () => {
    const history = new CursorOnlyProviderHistory();

    try {
      await expect(history.eagerRowsForTest()).rejects.toThrow(
        'eager provider preparation',
      );
    } finally {
      await history.dispose();
    }
  });
});

async function digest(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<string> {
  const hash = createHash('sha256');

  for await (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

const logger = new DebugLogger('test:provider-curated-stream');

describe('journal-backed provider normalization', () => {
  for (const size of [512, 8192]) {
    it(`matches old provider bytes for ${size} mixed tool/media rows without eager history`, async () => {
      const input = Array.from({ length: size }, (_, index) =>
        providerFixtureRow(index),
      );
      const oracle = buildProviderContent(
        input.filter((row) => row.speaker !== 'ai' || row.blocks.length > 0),
        [],
        logger,
      );
      await withCoreSuffixFixture(
        size,
        async (history, owners, counters) => {
          expect(await digest(history.getCuratedForProviderStream())).toBe(
            await digest(oracle),
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
          expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
            8 * 1024 * 1024,
          );
          expect(counters.snapshot().peakDecodedRows).toBe(1);
        },
        2048,
        providerFixtureRow,
        undefined,
        (options) => new CursorOnlyProviderHistory(options),
      );
    }, 120_000);
  }

  it('preserves adjacent cache-anchor metadata and cyclic payload wire serialization', async () => {
    const history = new CursorOnlyProviderHistory();
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    const tail: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c', name: 't', parameters: cycle }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c',
            toolName: 't',
            result: undefined,
          },
        ],
        metadata: { cacheAnchor: true, id: 'anchor' },
      },
    ];
    try {
      expect(await digest(history.getCuratedForProviderStream(tail))).toBe(
        await digest(buildProviderContent([], tail, logger)),
      );
      expect(cycle.self).toBe(cycle);
    } finally {
      await history.dispose();
    }
  });
});

describe('pending block identity during adjacency', () => {
  it('keeps adjacent metadata when an earlier row shares the same response block', async () => {
    const response: IContent['blocks'][number] = {
      type: 'tool_response',
      callId: 'shared',
      toolName: 't',
      result: 1,
    };
    const tail: IContent[] = [
      {
        speaker: 'human',
        blocks: [response, { type: 'text', text: 'before' }],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'shared', name: 't', parameters: {} },
        ],
      },
      { speaker: 'tool', blocks: [response], metadata: { cacheAnchor: true } },
    ];
    const history = new CursorOnlyProviderHistory();
    try {
      expect(await digest(history.getCuratedForProviderStream(tail))).toBe(
        await digest(buildProviderContent([], tail, logger)),
      );
      const distinct: IContent[] = tail.map((row) =>
        row.speaker === 'tool' ? { ...row, blocks: [{ ...response }] } : row,
      );
      expect(await digest(history.getCuratedForProviderStream(distinct))).toBe(
        await digest(buildProviderContent([], distinct, logger)),
      );
    } finally {
      await history.dispose();
    }
  });
});

describe('committed provider curation rules R1 through R8', () => {
  for (const rule of providerCurationRuleCases) {
    it(`${rule.name}`, async () => {
      const expected = buildProviderContent(
        buildCuratedHistory(logger, rule.rows, false),
        [],
        logger,
      );
      await withCoreSuffixFixture(
        rule.rows.length,
        async (history, owners, counters) => {
          const snapshot = await history.prepareCuratedForProviderSnapshot();
          try {
            expect(snapshot.count).toBe(expected.length);
            expect(await digest(snapshot.openReader())).toBe(
              await digest(expected),
            );
            expect(await digest(snapshot.openReader())).toBe(
              await digest(expected),
            );
            for (let index = 0; index < snapshot.count; index++) {
              expect(snapshot.readAt(index)).toStrictEqual(expected[index]);
              expect(snapshot.isPending(index)).toBe(false);
            }
            expect(snapshot.pending).toStrictEqual({
              inputCount: 0,
              firstOutputIndex: undefined,
            });
            expect(owners.snapshot().liveRows).toBe(0);
            expect(counters.snapshot().peakDecodedRows).toBeLessThanOrEqual(1);
          } finally {
            snapshot.close();
          }
        },
        0,
        (index) => rule.rows[index],
        undefined,
        (options) => new CursorOnlyProviderHistory(options),
      );
    });
  }
});
