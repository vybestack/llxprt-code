import { observeHistorySynchronouslyForTest } from '../../test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { DebugLogger } from '../../debug/index.js';
import { HistoryService } from './HistoryService.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import type { IContent } from './IContent.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { providerFixtureRow } from './provider-curated-test-helpers.js';

class CursorOnlyProviderHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager provider preparation');
  }
}

describe('journal materialization guard', () => {
  it('CursorOnlyProviderHistory rejects journal eager materialization', () => {
    const history = new CursorOnlyProviderHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'eager provider preparation',
      );
    } finally {
      history.dispose();
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
      await withSuffixFixture(
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
      history.dispose();
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
      history.dispose();
    }
  });
});
