/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import * as codec from './journalRowCodec.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { IContent } from './IContent.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('startup journal admission', () => {
  it('journals 8192 startup rows without retaining their drafts', async () => {
    const history = new HistoryService();
    const drafts: Array<WeakRef<RowDraft>> = [];
    const original = codec.encodeContentRow;
    const encode = spyOn(codec, 'encodeContentRow').mockImplementation(
      (...args) => {
        const draft = original(...args);
        drafts.push(new WeakRef(draft));
        return draft;
      },
    );
    try {
      for (let index = 0; index < 8192; index++) {
        history.add(row(`startup ${index}`));
        encode.mockClear();
      }
      expect(history.length()).toBe(8192);
      for (let turn = 0; turn < 8; turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        Bun.gc(true);
      }
      expect(
        drafts.filter((ref) => ref.deref() !== undefined).length,
      ).toBeLessThanOrEqual(2);
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      let count = 0;
      for await (const content of history.streamRawHistory()) {
        expect(content.blocks).toStrictEqual(row(`startup ${count++}`).blocks);
      }
      expect(count).toBe(8192);
    } finally {
      encode.mockRestore();
      await history.dispose();
    }
  });
});
