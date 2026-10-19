/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryService } from './HistoryService.js';
import type { HistoryBackend } from './historyBackendSelect.js';
import type { IContent } from './IContent.js';

const backends: HistoryBackend[] = ['old', 'journal'];
const row = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
  metadata: { chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1 } },
});

describe.each(backends)('compression public promises on %s', (backend) => {
  it('keeps clear pending until release and applies it between its FIFO neighbors', async () => {
    const history = new HistoryService({ backend });
    try {
      await history.addBatch([row('initial')]);
      history.startCompression();
      history.add(row('before clear'));
      let settled = false;
      const cleared = history.clear().then(() => {
        settled = true;
      });
      history.add(row('after clear'));
      await Promise.resolve();
      expect(settled).toBe(false);
      history.endCompression();
      await cleared;
      await history.waitForPendingOperations();
      expect(settled).toBe(true);
      expect(await collectRawHistory(history)).toStrictEqual([
        row('after clear'),
      ]);
    } finally {
      await history.dispose();
    }
  });

  it('keeps validation pending until its compression FIFO position is reached', async () => {
    const history = new HistoryService({ backend });
    try {
      await history.addBatch([row('initial')]);
      history.startCompression();
      const orphan: IContent = {
        speaker: 'ai',
        metadata: row('unused').metadata,
        blocks: [
          {
            type: 'tool_call',
            id: 'queued-call',
            name: 'probe',
            parameters: {},
          },
        ],
      };
      history.add(orphan);
      let settled = false;
      const validated = history.validateAndFix().then(() => {
        settled = true;
      });
      history.add(row('after validation'));
      await setImmediate();
      expect(settled).toBe(false);
      history.endCompression();
      await validated;
      const rows = await collectRawHistory(history);
      expect(rows[0]).toStrictEqual(row('initial'));
      expect(rows[1]).toStrictEqual(orphan);
      expect(rows[2].speaker).toBe('tool');
      expect(rows[2].blocks[0]).toMatchObject({
        type: 'tool_response',
        callId: 'queued-call',
      });
      expect(rows[3]).toStrictEqual(row('after validation'));
      expect(rows).toHaveLength(4);
    } finally {
      history.endCompression();
      await history.dispose();
    }
  });
});
