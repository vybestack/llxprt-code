/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { SourceCandidate } from '../source-candidate.js';

async function textLength(
  selection: ProviderRequestSelection,
): Promise<number> {
  let length = 0;
  for await (const row of selection.openReader())
    for (const block of row.blocks)
      if (block.type === 'text') length += block.text.length;
  return length;
}

describe('pinned source candidate reuse', () => {
  it('keeps unchanged selections but invalidates history and pending edits', async () => {
    await withSuffixFixture(8, async (history) => {
      let pending: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
      ];
      const opened = new Set<ProviderRequestSelection>();
      const open = async (): Promise<ProviderRequestSelection> => {
        const selection =
          await history.prepareCuratedForProviderSnapshot(pending);
        opened.add(selection);
        return selection;
      };
      const original = await open();
      const candidate = new SourceCandidate(
        original,
        textLength,
        open,
        {
          read: async () => pending,
          replace: (rows) => {
            pending = rows;
          },
        },
        () => history.historyMutationGuard(),
      );
      try {
        const before = await candidate.estimate();
        await candidate.replace();
        expect(candidate.value).toBe(original);
        expect(await candidate.estimateWithPending([...pending])).toBe(before);
        expect(candidate.value).toBe(original);
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'added' }],
        });
        await history.waitForTokenUpdates();
        await candidate.replace();
        expect(candidate.value).not.toBe(original);
        expect(await candidate.estimate()).toBe(before + 'added'.length);
        const afterHistory = candidate.value;
        expect(
          await candidate.estimateWithPending([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'new pending' }],
            },
          ]),
        ).toBe(before + 'added'.length + 'new '.length);
        expect(candidate.value).not.toBe(afterHistory);
      } finally {
        for (const selection of opened) await selection.close();
      }
    });
  });
});
