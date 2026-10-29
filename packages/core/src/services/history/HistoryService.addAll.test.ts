import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for HistoryService.addAll (issue #3109).
 *
 * `addAll` accepts `readonly IContent[]`, which makes `getRawHistory()` — the
 * accessor that hands out the backing array itself — a legal argument. `add`
 * appends to that same array, so iterating the caller's array live would let
 * the loop consume its own appends and never terminate. `addAll` therefore
 * iterates a snapshot.
 */

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it, expect } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

function makeEntry(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('HistoryService.addAll', () => {
  it('terminates and doubles the history when fed its own backing array', async () => {
    const service = new HistoryService();
    service.addAll([makeEntry('one'), makeEntry('two')]);

    service.addAll(await collectRawHistory(service));

    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all).toHaveLength(4);
      expect(all.map((entry) => entry.blocks[0])).toMatchObject([
        { text: 'one' },
        { text: 'two' },
        { text: 'one' },
        { text: 'two' },
      ]);
    });
  });

  it('appends every entry of an unrelated array in order', async () => {
    const service = new HistoryService();
    service.addAll([makeEntry('first')]);
    service.addAll([makeEntry('second'), makeEntry('third')]);

    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all.map((entry) => entry.blocks[0])).toMatchObject([
        { text: 'first' },
        { text: 'second' },
        { text: 'third' },
      ]);
    });
  });

  it('is a no-op for an empty array', async () => {
    const service = new HistoryService();
    service.addAll([makeEntry('only')]);

    service.addAll([]);

    await collectRowsForAssertions(service.streamRawHistory(), (all) => {
      expect(all).toHaveLength(1);
    });
  });
});
