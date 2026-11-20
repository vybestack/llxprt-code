import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { copyDeps } from '../../journal/__tests__/support/copyFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { NativeTranscriptIndex } from '../../journal/native-transcript-index.js';
import { readStoredRow } from '../../journal/rowReads.js';
import { compactionCopy } from '../../journal/versionTransfer.js';
import { NamedWriterOwnership } from '../../journal/named-writer-ownership.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import type { DetachedHistoryTransform } from './detachedHistoryMutation.js';
import { describeDroppedMedia } from './droppedMediaText.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { openOwnedJournal, type OwnedJournal } from './journalOwnedFixture.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { JournalSession } from './journalSession.js';
const historyScratchRoots = createTestScratchOwner();

const IMAGE_PATH = '/workspace/screens/shot.png';

/** Every transcript row in admission order, read the way the pager reads them. */
async function transcriptRows(file: string): Promise<IContent[]> {
  const reader = await openJournalReadOnly(file);
  try {
    const index = new NativeTranscriptIndex(reader);
    await index.initialize();
    const rows: IContent[] = [];
    for (let ordinal = 0; ordinal < index.rows; ordinal++) {
      const entry = await index.entryAt(ordinal);
      rows.push(decodeStoredRow(await readStoredRow(reader, entry)));
    }
    return rows;
  } finally {
    await reader.close();
  }
}

/** The transcript line of each dropped image and the content id of each stored one. */
function mediaLines(rows: readonly IContent[]): string[] {
  return rows.flatMap((row) =>
    row.blocks.flatMap((block) => {
      if (block.type === 'media_dropped') return [describeDroppedMedia(block)];
      if (block.type === 'media' && block.encoding === 'reference')
        return [`stored ${block.contentId}`];
      return [];
    }),
  );
}

describe('compression drops the transcript copy of a removed image to its reference', () => {
  const directory = useTempDir('compression-transcript-media-');
  let mediaRoot: string;
  let media: LocalMediaStore;
  let owner: HistoryMediaOwnership;
  let ownership: RowOwnership;
  let image: MediaReferenceBlock;

  const imageRow = (): IContent => ({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'look at this' }, image],
  });
  const textRow = (text: string): IContent => ({
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  });

  async function openSeeded(name: string): Promise<OwnedJournal> {
    const journal = await openOwnedJournal(
      path.join(directory(), name),
      [{ content: imageRow() }, { content: textRow('seen') }],
      { mediaOwner: owner, ownership },
    );
    await owner.reconcile([], () => [imageRow()]);
    return journal;
  }

  /** A compression that writes a summary and carries the first `kept` source rows over. */
  async function compress(journal: OwnedJournal, kept: number): Promise<void> {
    const transform: DetachedHistoryTransform = async (source, sink) => {
      await sink.appendValue(textRow('summary'));
      let ordinal = 0;
      for await (const row of source.streamRows()) {
        if (ordinal >= kept) break;
        await sink.appendDerived(ordinal++, row);
      }
    };
    await journal.store.publishDetached(
      { transform },
      journal.host,
      undefined,
      {},
    );
  }

  beforeEach(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'compression-media-store-'));
    media = new LocalMediaStore({ rootDirectory: mediaRoot, quotaBytes: 8192 });
    owner = new HistoryMediaOwnership(media, historyScratchRoots);
    ownership = new RowOwnership();
    const admitted = await media.admit({
      bytes: new Uint8Array(2048).fill(7),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    image = {
      ...admitted,
      origin: {
        kind: 'file',
        path: IMAGE_PATH,
        readAt: '2026-11-20T10:00:00.000Z',
      },
    };
  });

  afterEach(async () => {
    await owner.releaseAll();
    await media.close();
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('shows the dropped reference and lets reclaim delete the blob no row references', async () => {
    const journal = await openSeeded('dropped.llxj');
    const file = path.join(directory(), 'dropped.llxj');
    try {
      expect(mediaLines(await transcriptRows(file))).toStrictEqual([
        `stored ${image.contentId}`,
      ]);
      await compress(journal, 0);
      const lines = mediaLines(await transcriptRows(file));
      expect(lines).toStrictEqual([
        `[image dropped: ${IMAGE_PATH}, image/png, 2 KB]`,
      ]);
      expect(await media.hasReservations(image.contentId)).toBe(false);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      await journal.dispose();
    }
  });

  it('keeps the blob while a carried-over row still references it', async () => {
    const journal = await openSeeded('kept.llxj');
    const file = path.join(directory(), 'kept.llxj');
    try {
      await compress(journal, 1);
      expect(mediaLines(await transcriptRows(file))).toStrictEqual([
        `[image dropped: ${IMAGE_PATH}, image/png, 2 KB]`,
        `stored ${image.contentId}`,
      ]);
      expect(await media.hasReservations(image.contentId)).toBe(true);
      expect(
        (await media.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
    } finally {
      await journal.dispose();
    }
  });

  it('keeps the dropped reference across resume and compaction', async () => {
    const file = path.join(directory(), 'resumed.llxj');
    const journal = await openSeeded('resumed.llxj');
    try {
      await compress(journal, 0);
    } finally {
      await journal.dispose();
    }
    const dropped = [`[image dropped: ${IMAGE_PATH}, image/png, 2 KB]`];
    const session = await JournalSession.open(file, {
      namedWriters: new NamedWriterOwnership(),
    });
    let compacted: string;
    try {
      expect(mediaLines(await transcriptRows(file))).toStrictEqual(dropped);
      const pin = await session.store.openRead();
      try {
        if (pin.version === undefined) throw new Error('missing version');
        compacted = (
          await compactionCopy(
            pin.access,
            pin.version,
            path.join(directory(), 'compacted.llxj'),
            copyDeps(),
          )
        ).path;
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
    expect(mediaLines(await transcriptRows(compacted))).toStrictEqual(dropped);
  });
});
