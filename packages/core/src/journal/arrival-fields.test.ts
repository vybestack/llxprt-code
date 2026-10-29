/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { RECORD_KIND } from './recordKinds.js';
import { join } from 'node:path';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { JournalStore } from './journalStore.js';
import type { JournalReader } from './journalReader.js';
import type { TranscriptEntry } from './transcript-tree.js';
import { openJournalReadOnly } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function tail(path: string): Promise<unknown> {
  const file = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 1 });
    const row = await reader.readRow(entries[0]);
    return JSON.parse(new TextDecoder().decode(row.blocks[0]));
  } finally {
    await file.close();
  }
}

async function measureStreamedBlock(
  reader: TranscriptReader,
  entry: TranscriptEntry,
): Promise<{ count: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  for await (const item of reader.blocks(entry)) {
    for await (const piece of item.parts()) {
      expect(piece.length).toBeLessThanOrEqual(65536);
      bytes += piece.length;
    }
    count++;
  }
  return { count, bytes };
}
async function damagePiece(path: string, file: JournalReader): Promise<void> {
  let offset = JOURNAL_HEADER_BYTES;
  while (offset < (file.trailer?.durableEnd ?? 0)) {
    const head = await file.readRecordHead(offset);
    if (head.kind === RECORD_KIND.PIECE) {
      const writer = await open(path, 'r+');
      try {
        await writer.write(Uint8Array.of(0), 0, 1, head.bodyOffset);
      } finally {
        await writer.close();
      }
      return;
    }
    offset = head.endOffset;
  }
  throw new Error('Missing piece');
}

describe('arrival named fields', () => {
  const directory = useTempDir('arrival-fields-');
  it('records independent fields losslessly and accepts only snapshot suffixes', async () => {
    const path = join(directory(), 'fields.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 4);
      await recorder.appendText(block, 'thought', 'quote"\n\ud800', 'snapshot');
      await recorder.appendText(block, 'signature', 'sig');
      await recorder.appendText(block, 'thought', 'quote"\n\ud800', 'snapshot');
      expect(recorder.census.payloadBytes).toBe(18);
      await recorder.appendText(
        block,
        'thought',
        'quote"\n\ud800\udc00tail',
        'snapshot',
      );
      await recorder.flush();
      expect(await tail(path)).toStrictEqual({
        type: 'thinking',
        thought: 'quote"\n\ud800\udc00tail',
        signature: 'sig',
      });
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      expect(store.published?.rows).toBe(1);
      await recorder.close();
      expect(await store.compact()).toBe('swapped');
      expect(await tail(path)).toStrictEqual({
        type: 'thinking',
        thought: 'quote"\n\ud800\udc00tail',
        signature: 'sig',
      });
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('fails shrinking or changed snapshots without publishing the invalid suffix', async () => {
    const path = join(directory(), 'mismatch.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'a', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 4);
      await recorder.appendText(block, 'thought', 'prefix', 'snapshot');
      await expect(
        recorder.appendText(block, 'thought', 'changed', 'snapshot'),
      ).rejects.toThrow('snapshot prefix');
      expect(await tail(path)).toStrictEqual({
        type: 'thinking',
        thought: 'prefix',
      });
      expect(store.published?.rows).toBe(0);
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('validates raw argument fragments once complete and rejects incomplete calls', async () => {
    const path = join(directory(), 'arguments.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'tool', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 1);
      await recorder.appendText(block, 'id', 'call_1');
      await recorder.appendText(block, 'name', 'search');
      await recorder.appendText(block, 'parameters', '{"query":');
      await expect(recorder.endBlock(block)).rejects.toThrow(
        'Invalid tool call',
      );
      expect(store.published?.rows).toBe(0);
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('streams a large live block through bounded directory pieces', async () => {
    const path = join(directory(), 'stream.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'stream', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 0);
      for (let index = 0; index < 64; index++)
        await recorder.appendText(block, 'text', 'x'.repeat(8192));
      await recorder.flush();
      const file = await openJournalReadOnly(path);
      try {
        const reader = new TranscriptReader(file, sha256KeyHash);
        const entries = await reader.page({ direction: 'forward', limit: 1 });
        expect(await measureStreamedBlock(reader, entries[0])).toStrictEqual({
          count: 1,
          bytes: 64 * 8192 + '{"type":"text","text":""}'.length,
        });
      } finally {
        await file.close();
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  });
  it('streams binary media with base64 carry across arbitrary source boundaries', async () => {
    const path = join(directory(), 'media.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    const source = Buffer.from('one\u0000two🌙three');
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'media', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 3);
      await recorder.appendText(block, 'mimeType', 'image/png');
      await recorder.appendMedia(
        block,
        (async function* () {
          for (const byte of source) yield Uint8Array.of(byte);
        })(),
      );
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      expect(await tail(path)).toStrictEqual({
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: source.toString('base64'),
      });
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('publishes completed call id facts and argument values to context', async () => {
    const path = join(directory(), 'tool-facts.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'facts', submissionId: 's' },
      );
      const block = await recorder.beginNamedBlock(row, 1);
      await recorder.appendText(block, 'id', 'call_42');
      await recorder.appendText(block, 'name', 'search');
      await recorder.appendText(block, 'parameters', '{"query":"\ud800');
      await recorder.appendText(block, 'parameters', '\udc00"}');
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      const snapshot = await store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const ids = await snapshot.readIds(entry);
        expect(ids.rawIds).toStrictEqual(['call_42']);
        expect(entry.toolCallBlocks).toBe(1);
      } finally {
        await snapshot.close();
      }
      expect(await tail(path)).toStrictEqual({
        type: 'tool_call',
        id: 'call_42',
        name: 'search',
        parameters: { query: '\ud800\udc00' },
      });
    } finally {
      await recorder.close();
      await store.close();
    }
  });

  it('checks a selected piece before exposing its bytes', async () => {
    const path = join(directory(), 'corrupt-piece.llxj');
    const store = await JournalStore.create(path, storeDeps());
    const recorder = new JournalArrivalRecorder(store);
    try {
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: 'crc', submissionId: 's' },
      );
      const block = await recorder.beginBlock(row, 0);
      await recorder.appendField(
        block,
        new TextEncoder().encode('selected payload'),
      );
      await recorder.flush();
      const file = await openJournalReadOnly(path);
      try {
        await damagePiece(path, file);
        const reader = new TranscriptReader(file, sha256KeyHash);
        const entries = await reader.page({ direction: 'forward', limit: 1 });
        const selected = await reader.blocks(entries[0]).next();
        if (selected.done === true) throw new Error('Missing directory block');
        await expect(selected.value.parts().next()).rejects.toThrow('CRC');
      } finally {
        await file.close();
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  });
});
