/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

/**
 * Rows a caller hands to the service are copied, never stamped in place: the
 * chronology marker belongs to the stored row.
 */
describe.each(['journal'] as const)(
  'rows handed in by the caller (%s store)',
  () => {
    let history: HistoryService;
    beforeEach(() => {
      history = new HistoryService();
    });
    afterEach(async () => {
      await history.dispose();
    });

    it('leaves a replacement row without the marker the stored row got', async () => {
      const row = createUserMessage('replacement');
      await history.replaceAll([row]);
      await history.waitForCommit();

      const stored: unknown[] = [];
      for await (const stream of history.streamRawHistory())
        stored.push(stream.metadata?.chronology?.seq);
      expect(stored).toStrictEqual([1]);
      expect(row.metadata).toBeUndefined();
    });

    it('keeps the marker a replacement row already carries', async () => {
      const row = createUserMessage('marked');
      row.metadata = {
        chronology: { seq: 7, userTurn: 3, step: 2, recordedAt: 5 },
      };
      await history.replaceAll([row]);
      await history.waitForCommit();

      for await (const stored of history.streamRawHistory())
        expect(stored.metadata?.chronology).toStrictEqual(
          row.metadata.chronology,
        );
    });
  },
);
