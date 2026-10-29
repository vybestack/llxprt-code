/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { RequestShapeTracker } from './tokenUsageRequestShape.js';

function result(id: string, text: string): IContent {
  return {
    speaker: 'tool',
    metadata: { id },
    blocks: [
      { type: 'tool_response', callId: id, toolName: 'read', result: text },
    ],
  };
}

for (const route of ['array', 'source']) {
  describe(`caller-owned ${route} classification`, () => {
    async function send(
      memory: RequestShapeTracker,
      rows: readonly IContent[],
    ) {
      const input = {
        tools: [],
        instructionsText: undefined,
        countTokens: (text: string): number => text.length,
      };
      if (route === 'array')
        return memory.recordRequestShape({ ...input, requestContents: rows });
      const source = callerOwnedRawProviderSource(rows);
      const selection = await source.openProviderRequest();
      try {
        return await memory.recordSourceRequestShape({
          ...input,
          requestRows: selection,
        });
      } finally {
        await selection.close();
      }
    }

    it('carries an unchanged prefix and marks only appended results new', async () => {
      const memory = new RequestShapeTracker();
      const first = result('first', 'old result');
      const second = result('second', 'new result');
      const before = await send(memory, [first]);
      const after = await send(memory, [first, second]);
      expect(after.carriedToolResultTokens).toBe(before.newToolResultTokens);
      expect(after.newToolResultTokens).toBe(
        after.historyTokens - before.historyTokens,
      );
    });

    it('starts a new ordered-request lineage when a caller replaces a row', async () => {
      const memory = new RequestShapeTracker();
      await send(memory, [result('old', 'old result')]);
      const after = await send(memory, [
        result('replacement', 'replacement result'),
      ]);
      expect(after.newToolResultTokens).toBe(after.historyTokens);
      expect(after.carriedToolResultTokens).toBe(0);
      const repeated = await send(memory, [
        result('replacement', 'replacement result'),
      ]);
      expect(repeated.carriedToolResultTokens).toBe(after.historyTokens);
      expect(repeated.newToolResultTokens).toBe(0);
    });

    it('marks an append after a shortened caller request as new', async () => {
      const memory = new RequestShapeTracker();
      const first = result('first', 'first result');
      const removed = result('removed', 'removed result');
      await send(memory, [first, removed]);
      await send(memory, [first]);
      const before = await send(memory, [first]);
      const after = await send(memory, [first, result('new', 'new result')]);
      expect(after.carriedToolResultTokens).toBe(before.historyTokens);
      expect(after.newToolResultTokens).toBe(
        after.historyTokens - before.historyTokens,
      );
    });

    it('starts a new lineage when rows are reordered', async () => {
      const memory = new RequestShapeTracker();
      const first = result('first', 'first result');
      const second = result('second', 'second result');
      await send(memory, [first, second]);
      const after = await send(memory, [second, first]);
      expect(after.newToolResultTokens).toBe(after.historyTokens);
      expect(after.carriedToolResultTokens).toBe(0);
    });

    it('detects changed bodies even with reused ids and equal token counts', async () => {
      const memory = new RequestShapeTracker();
      await send(memory, [result('same', 'aaaa')]);
      const after = await send(memory, [result('same', 'bbbb')]);
      expect(after.newToolResultTokens).toBe(after.historyTokens);
      expect(after.carriedToolResultTokens).toBe(0);
    });
  });
}
