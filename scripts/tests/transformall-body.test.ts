import { observeHistorySynchronouslyForTest } from '../../packages/core/src/test-utils/synchronous-history-test-observation.js';
import { forbidHistoryMaterializationForTest } from '../../packages/core/src/test-utils/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { exactTokenizer } from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import {
  providerFarFixtureRow,
  providerPendingFixture,
} from '../../packages/core/src/services/history/provider-curated-test-helpers.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';

class DiskOnlyTransformHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'Public transform eagerly materialized history',
    );
  }
}

describe('journal materialization guard', () => {
  it('DiskOnlyTransformHistory rejects journal eager materialization', () => {
    const history = new DiskOnlyTransformHistory();

    try {
      expect(() => observeHistorySynchronouslyForTest(history)).toThrow(
        'Public transform eagerly materialized history',
      );
    } finally {
      history.dispose();
    }
  });
});

function expectedRow(index: number): IContent {
  const row = providerFarFixtureRow(index);
  if (index !== 0) return row;
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'text'
        ? { ...block, text: 'transformed first row' }
        : block,
    ),
  };
}

async function compareBodies(
  history: HistoryService,
  size: number,
): Promise<void> {
  const pending = providerPendingFixture();
  const actualRows = await recomposeFixture(history, pending);
  const expectedRows = buildProviderContent(
    Array.from({ length: size }, (_, index) => expectedRow(index)).filter(
      (row) => row.speaker !== 'ai' || row.blocks.length > 0,
    ),
    pending,
    new DebugLogger('test:transformall-body'),
  );
  for (const provider of ['anthropic', 'openai-responses', 'gemini']) {
    for (const caching of [false, true]) {
      const actual = await captureCuratedBody(
        provider,
        actualRows,
        caching,
        true,
        true,
      );
      const expected = await captureCuratedBody(
        provider,
        expectedRows,
        caching,
      );
      const output = process.env.TRANSFORMALL_BODY_OUTPUT;
      if (output !== undefined) {
        const name = `${provider}-${size}-${caching}`;
        writeFileSync(join(output, `${name}-actual.json`), actual);
        writeFileSync(join(output, `${name}-expected.json`), expected);
      }
      expect(actual).toBe(expected);
      if (caching && provider === 'anthropic')
        expect(actual).toContain('"cache_control"');
    }
  }
}

describe('public transform provider BODY BYTES', () => {
  for (const size of [512, 8192]) {
    it(`preserves ${size} raw tool/media rows through all providers and retry bodies`, async () => {
      await withSuffixFixture(
        size,
        async (history) => {
          history.setTokenizerFactory(exactTokenizer());
          let traversed = 0;
          await history.transformAll(async (source, sink) => {
            for await (const { row } of source.streamRows()) {
              if (traversed === 0) sink.appendDetached(expectedRow(0));
              else sink.appendRetained(traversed, row);
              traversed++;
            }
          });
          expect(traversed).toBe(size);
          await compareBodies(history, size);
        },
        2048,
        providerFarFixtureRow,
        undefined,
        (options) => new DiskOnlyTransformHistory(options),
      );
    }, 120_000);
  }
});
