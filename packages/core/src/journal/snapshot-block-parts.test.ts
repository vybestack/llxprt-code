/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import type { DirectoryBlock } from './row-directory.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';

async function digest(blocks: AsyncIterable<DirectoryBlock>): Promise<string> {
  const hash = createHash('sha256');
  for await (const block of blocks) {
    let length = 0;
    for await (const part of block.parts()) {
      expect(part.byteLength).toBeLessThanOrEqual(65536);
      expect(part.buffer.byteLength).toBeLessThanOrEqual(65536);
      length += part.byteLength;
      hash.update(part);
    }
    expect(length).toBe(block.length);
  }
  return hash.digest('hex');
}

async function firstBlock(
  blocks: AsyncIterable<DirectoryBlock>,
): Promise<DirectoryBlock> {
  for await (const block of blocks) return block;
  throw new Error('Missing test block');
}

describe('snapshot bounded block parts', () => {
  const directory = useTempDir('snapshot-block-parts-');

  it('streams an arrival directory without rereading its block descriptor', async () => {
    const counter = { reads: 0 };
    const store = await JournalStore.create(
      join(directory(), 'read-cost.llxj'),
      storeDeps({
        seams: testJournalSeams({ readCounter: counter }, 1, false),
      }),
    );
    const recorder = new JournalArrivalRecorder(store);
    const payload = new TextEncoder().encode('streamed payload');
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'read-cost', submissionId: 'prompt' },
      );
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(block, payload);
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      const snapshot = await store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const before = counter.reads;
        expect(await digest(snapshot.blocks(entry))).toBe(
          createHash('sha256').update(payload).digest('hex'),
        );
        expect(counter.reads - before).toBeLessThanOrEqual(10);
      } finally {
        await snapshot.close();
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('reads a large ordinary block without retaining its complete backing buffer', async () => {
    const store = await JournalStore.create(
      join(directory(), 'ordinary.llxj'),
      storeDeps(),
    );
    const text = 'ordinary 🌙 quote"\n'.repeat(20000);
    await store.commit([{ kind: 'append', rows: [draftRow({ text })] }]);
    const snapshot = await store.snapshot();
    try {
      const entry = await snapshot.entryAt(0);
      expect(await digest(snapshot.blocks(entry))).toBe(
        createHash('sha256').update(text).digest('hex'),
      );
    } finally {
      await snapshot.close();
      await store.close();
    }
  });

  it('keeps sealed arrival parts pinned when the live context removes the row', async () => {
    const store = await JournalStore.create(
      join(directory(), 'arrival.llxj'),
      storeDeps(),
    );
    const recorder = new JournalArrivalRecorder(store);
    const chunk = 'arriving \u{1f319} quote"\n'.repeat(40);
    const text = chunk.repeat(300);
    const expected = JSON.stringify({ type: 'text', text });
    const row = await recorder.beginRow(
      { ...draftRow(), blocks: [] },
      { id: 'attempt', submissionId: 'prompt' },
    );
    const block = await recorder.beginNamedBlock(row, 0);
    for (let index = 0; index < 300; index++)
      await recorder.appendTextDelta(block, chunk);
    await recorder.endBlock(block);
    await recorder.sealRow(row);
    await recorder.close();
    const snapshot = await store.snapshot();
    try {
      const entry = await snapshot.entryAt(0);
      await store.commit([{ kind: 'clear' }]);
      expect(await digest(snapshot.blocks(entry))).toBe(
        createHash('sha256').update(expected).digest('hex'),
      );
    } finally {
      await snapshot.close();
      await store.close();
    }
  });

  it('refuses both deferred directories and already obtained parts after the pin closes', async () => {
    const store = await JournalStore.create(
      join(directory(), 'closed.llxj'),
      storeDeps(),
    );
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'x'.repeat(200000) })] },
    ]);
    const snapshot = await store.snapshot();
    try {
      const entry = await snapshot.entryAt(0);
      const deferred = snapshot.blocks(entry);
      const block = await firstBlock(snapshot.blocks(entry));
      const parts = block.parts();
      expect((await parts.next()).done).toBe(false);
      await snapshot.close();
      await expect(deferred.next()).rejects.toThrow('released');
      await expect(parts.next()).rejects.toThrow('released');
      await expect(block.parts().next()).rejects.toThrow('released');
    } finally {
      await store.close();
    }
  });

  it('rejects corruption in an ordinary block after checking its streamed checksum', async () => {
    const path = join(directory(), 'corrupt.llxj');
    const store = await JournalStore.create(path, storeDeps());
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'x'.repeat(200000) })] },
    ]);
    const snapshot = await store.snapshot();
    try {
      const entry = await snapshot.entryAt(0);
      const stored = await snapshot.readIds(entry);
      const head = stored.head;
      if (head === undefined) throw new Error('Missing stored frame');
      const file = await open(path, 'r+');
      try {
        await file.write(
          Uint8Array.of(0),
          0,
          1,
          head.bodyOffset + stored.header.blocks[0].offset + 100000,
        );
      } finally {
        await file.close();
      }
      await expect(digest(snapshot.blocks(entry))).rejects.toThrow('CRC');
    } finally {
      await snapshot.close();
      await store.close();
    }
  });
});
