/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { JournalSession } from './journalSession.js';
import { observeSealedRow } from './sealed-history-row.js';
import type { MediaReferenceBlock } from './IContent.js';

describe('sealed row reference stream', () => {
  const directory = useTempDir('sealed-row-media-');

  it('returns exact references without exposing text or inline media payloads', async () => {
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 4096,
    });
    const session = await JournalSession.create(
      join(directory(), 'session.llxj'),
    );
    try {
      const reference = await media.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'application/octet-stream',
        semanticMetadata: { label: 'quote " and 🌙' },
      });
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'unrelated text '.repeat(10000) },
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'audio/wav',
              data: 'aGVsbG8='.repeat(20000),
            },
            reference,
          ],
        },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const seen: MediaReferenceBlock[] = [];
        const receipt = await observeSealedRow(
          snapshot,
          async (_row, references) => {
            for await (const item of references) seen.push(item);
          },
        );
        expect(seen).toStrictEqual([reference]);
        expect(receipt.label).toBe((await snapshot.entryAt(0)).label);
        expect('blocks' in receipt).toBe(false);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
      await media.close();
    }
  });

  it('does not let a deferred reference reader outlive its snapshot', async () => {
    const session = await JournalSession.create(
      join(directory(), 'closed.llxj'),
    );
    try {
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
      ]);
      const snapshot = await session.store.snapshot();
      let saved: AsyncIterable<MediaReferenceBlock> | undefined;
      await observeSealedRow(snapshot, async (_row, references) => {
        saved = references;
      });
      await snapshot.close();
      if (saved === undefined) throw new Error('Missing reference reader');
      await expect(Array.fromAsync(saved)).rejects.toThrow(
        'after its pin was released',
      );
    } finally {
      await session.close();
    }
  });
});
