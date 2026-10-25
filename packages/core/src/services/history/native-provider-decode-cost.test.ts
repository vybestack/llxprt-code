/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

describe('native provider row decoding', () => {
  it('parses each stored metadata and block only once per streaming pass', async () => {
    await withSuffixFixture(64, async (history) => {
      const snapshot = await history.prepareCuratedForProviderSnapshot();
      const parse = JSON.parse;
      let parses = 0;
      const observer = spyOn(JSON, 'parse').mockImplementation(
        (text, reviver) => {
          parses++;
          return parse(text, reviver);
        },
      );
      try {
        let count = 0;
        for await (const row of snapshot.openReader()) {
          expect(row.blocks[0]).toStrictEqual({
            type: 'text',
            text: `${count}:`,
          });
          row.blocks.length = 0;
          count++;
        }
        expect(count).toBe(64);
        expect(parses).toBeLessThanOrEqual(2 * count);
        observer.mockRestore();
        expect((await snapshot.readAt(0)).blocks).toStrictEqual([
          { type: 'text', text: '0:' },
        ]);
      } finally {
        observer.mockRestore();
        await snapshot.close();
      }
    });
  });
});
