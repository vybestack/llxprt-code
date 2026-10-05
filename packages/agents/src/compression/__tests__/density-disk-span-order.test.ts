/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ContextRange } from '@vybestack/llxprt-code-core/services/history/historyEventTypes.js';
import {
  collectDensitySpans,
  mergeRemovedInteriorSpans,
} from '@vybestack/llxprt-code-core/services/history/contextRange.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  densityConfig,
  densityHandler,
  densityRow,
} from './density-disk-helpers.js';
function row(index: number): IContent {
  const original = densityRow(index);
  return {
    ...original,
    metadata: {
      ...original.metadata,
      chronology: {
        seq: index === 0 ? 3 : index + 1,
        userTurn: 1,
        step: index,
        recordedAt: 0,
      },
    },
  };
}
describe('density span equal-position precedence', () => {
  it('keeps removals before replacements when chronology positions overlap', async () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index));
    const result = new HighDensityStrategy().optimize(rows, densityConfig());
    const expected = mergeRemovedInteriorSpans(
      collectDensitySpans(rows, result),
    );
    await withSuffixFixture(
      12,
      async (history) => {
        let range: ContextRange | undefined;
        history.on('contextRangeChanged', (value) => {
          range = value;
        });
        await densityHandler(history).ensureDensityOptimized();
        expect(range?.removedInterior).toStrictEqual(expected);
      },
      2048,
      row,
    );
  });
});
