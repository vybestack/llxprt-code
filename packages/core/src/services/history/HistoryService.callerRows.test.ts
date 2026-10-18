/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { HISTORY_BACKEND_ENV } from './historyBackendSelect.js';
import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

/**
 * Rows a caller hands to the service are copied, never stamped in place: the
 * chronology marker belongs to the stored row.
 */
describe.each(['old', 'journal'] as const)(
  'rows handed in by the caller (%s store)',
  (backend) => {
    const saved = process.env[HISTORY_BACKEND_ENV];
    let history: HistoryService;
    beforeEach(() => {
      process.env[HISTORY_BACKEND_ENV] = backend;
      history = new HistoryService();
    });
    afterEach(async () => {
      if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
      else process.env[HISTORY_BACKEND_ENV] = saved;
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
