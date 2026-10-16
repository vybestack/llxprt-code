/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { MIB } from '../../journal/__tests__/support/streamedBody.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/** Settled heap may rise this far above its start once the row has been written or read and dropped. */
const RETAINED_BOUND = 4 * MIB;
/** A row this big read into the control must show in the same measurement. */
const CONTROL_FLOOR_FRACTION = 0.5;
const PIECE_BYTES = MIB;

/** 1 MiB of ASCII that differs per piece, so a row of any size is not one repeated string. */
function piece(index: number): string {
  return (
    `${index.toString(36).padStart(6, '0')}`.repeat(PIECE_BYTES / 6) +
    'x'.repeat(PIECE_BYTES % 6)
  );
}

function rowText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += PIECE_BYTES, index++) {
    pieces.push(piece(index).slice(0, Math.min(PIECE_BYTES, bytes - at)));
  }
  return pieces.join('');
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function textRow(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

/** Builds the row inside this frame so that nothing of it outlives the call but the digest. */
async function applyRow(
  store: JournalHistoryStore,
  bytes: number,
): Promise<string> {
  const text = rowText(bytes);
  store.apply({ kind: 'content', content: textRow(text, 1) });
  await store.waitForDurable();
  return digestOf(text);
}

async function readDigest(
  store: JournalHistoryStore,
): Promise<{ digest: string; length: number }> {
  let found: { digest: string; length: number } | undefined;
  for await (const content of store.streamRows()) {
    const block = content.blocks[0];
    if (block.type !== 'text') throw new Error('expected a text block');
    found = { digest: digestOf(block.text), length: block.text.length };
  }
  if (found === undefined) throw new Error('the history holds no row');
  return found;
}

describe('rows of 17, 40 and 200 MiB through the journal history store (defect 5)', () => {
  const directory = useTempDir('journal-history-large-');

  for (const mebibytes of [17, 40, 200] as const) {
    it(`applies, reopens and streams a ${mebibytes} MiB row, and holds none of it afterwards`, async () => {
      const file = path.join(directory(), `row-${mebibytes}.llxj`);
      const bytes = mebibytes * MIB;
      const baseline = await settledHeap();
      const store = new JournalHistoryStore(await JournalSession.create(file));

      const written = await applyRow(store, bytes);
      const afterWrite = await settledHeap();
      await store.dispose();

      const reopened = new JournalHistoryStore(await JournalSession.open(file));
      const read = await readDigest(reopened);
      const afterRead = await settledHeap();
      await reopened.dispose();

      expect(read.length).toBe(bytes);
      expect(read.digest).toBe(written);
      expect(afterWrite - baseline).toBeLessThan(RETAINED_BOUND);
      expect(afterRead - baseline).toBeLessThan(RETAINED_BOUND);
    });
  }

  it('control: a caller that keeps the row it applied shows the row in the same measurement', async () => {
    const store = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), 'control.llxj')),
    );
    const bytes = 40 * MIB;
    const baseline = await settledHeap();

    const kept = [textRow(rowText(bytes), 1)];
    store.apply({ kind: 'content', content: kept[0] });
    await store.waitForDurable();
    const withRow = await settledHeap();
    await store.dispose();

    expect(kept).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(bytes * CONTROL_FLOOR_FRACTION);
  });
});
