/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OffsetAudit } from '../../journal/__tests__/support/offsetAudit.js';
import { RetiredJournalError } from '../../journal/errors.js';
import { readFrameHead, type FrameHead } from '../../journal/frame.js';
import { createFileHandleReader } from '../../journal/positionalFile.js';
import { decodeRowHeader } from '../../journal/rowRecord.js';
import { scanJournalRecording } from '../../recording/journal-recording-scan.js';
import { JournalSession } from './journalSession.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import {
  encodeSessionFact,
  SESSION_KEYS,
} from '../../recording/sessionMetaKeys.js';

const CONTENT: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'unselected'.repeat(100000) },
    {
      type: 'tool_response',
      callId: 'range-id',
      toolName: 'lookup',
      result: 'selected',
    },
  ],
  metadata: { model: 'range-lifecycle' },
};

async function headAt(path: string, offset: number): Promise<FrameHead> {
  const handle = await open(path, 'r');
  try {
    return await readFrameHead(
      createFileHandleReader(handle),
      offset,
      (await handle.stat()).size,
    );
  } finally {
    await handle.close();
  }
}

async function verifyRanges(session: JournalSession): Promise<void> {
  const snapshot = await session.store.snapshot();
  try {
    const entry = await snapshot.entryAt(0);
    const metadata = await snapshot.readMetadata(entry);
    const blocks = await Promise.all(
      CONTENT.blocks.map((_, index) => snapshot.readBlock(entry, index)),
    );
    expect(decodeStoredRow({ ...metadata, blocks })).toStrictEqual(CONTENT);
    expect(metadata.rawIds).toStrictEqual(['range-id']);
    expect(entry.owner).toBe(7);
  } finally {
    await snapshot.close();
  }
  const read = await session.store.openRead();
  try {
    if (read.version === undefined) throw new Error('Missing version');
    await new OffsetAudit(read.access).walkVersion(read.version);
  } finally {
    await read.close();
  }
}

describe('version 8 ROW range lifecycle', () => {
  const directory = useTempDir('journal-range-lifecycle-');

  it('reads exactly one selected payload and its checksum, never the unselected block or whole ROW', async () => {
    const path = `${directory()}/budget.llxj`;
    const reads: Array<{ position: number; length: number }> = [];
    const base = testJournalSeams({}, 1, false).dependencies;
    const session = await JournalSession.create(path, {
      journal: {
        ...base,
        open: async (file, flags) => {
          const handle = await base.open(file, flags);
          return {
            ...handle,
            read: async (buffer, offset, length, position) => {
              reads.push({ position, length });
              return handle.read(buffer, offset, length, position);
            },
          };
        },
      },
    });
    try {
      await session.append([CONTENT]);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const head = await headAt(path, entry.recordOffset);
        const header = decodeRowHeader(head.kindHeader);
        reads.length = 0;
        expect(
          JSON.parse(
            new TextDecoder().decode(await snapshot.readBlock(entry, 1)),
          ),
        ).toStrictEqual(CONTENT.blocks[1]);
        expect(reads).toStrictEqual([
          { position: head.offset, length: 20 },
          { position: head.offset + 20, length: head.headerLen },
          {
            position: head.bodyOffset + header.blocks[1].offset,
            length: header.blocks[1].length + 4,
          },
        ]);
        expect(
          reads.some(
            (read) =>
              read.position <
                head.bodyOffset +
                  header.blocks[0].offset +
                  header.blocks[0].length &&
              read.position + read.length >
                head.bodyOffset + header.blocks[0].offset,
          ),
        ).toBe(false);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  it('preserves selected and metadata checks through rebuild, owner changes, reopen, clone and physical compaction', async () => {
    const path = `${directory()}/copy.llxj`;
    const options = { journal: testJournalSeams({}, 1, false).dependencies };
    const session = await JournalSession.create(path, options);
    try {
      await session.append([
        CONTENT,
        { speaker: 'human', blocks: [{ type: 'text', text: 'remove' }] },
      ]);
      const snapshot = await session.store.snapshot();
      let first: bigint;
      let second: bigint;
      try {
        first = (await snapshot.entryAt(0)).label;
        second = (await snapshot.entryAt(1)).label;
      } finally {
        await snapshot.close();
      }
      await session.store.commit([
        { kind: 'owner', changes: [{ label: first, owner: 7 }] },
      ]);
      await session.store.commit([
        { kind: 'density', replacements: [], removed: [second] },
      ]);
      await verifyRanges(session);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      const clone = await reopened.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await verifyRanges(clone);
        expect(await clone.store.compact()).toBe('swapped');
        await verifyRanges(clone);
      } finally {
        await clone.close();
      }
      expect(await reopened.store.compact()).toBe('swapped');
      await verifyRanges(reopened);
    } finally {
      await reopened.close();
    }
  });

  it('refuses a CRC-valid version 7 file through public reopen and package scanning', async () => {
    const path = `${directory()}/old.llxj`;
    const options = { journal: testJournalSeams({}, 1, false).dependencies };
    const session = await JournalSession.create(path, options);
    await session.append([CONTENT]);
    await session.close();
    const handle = await open(path, 'r+');
    try {
      const header = new Uint8Array(64);
      await handle.read(header, 0, header.length, 0);
      const view = new DataView(header.buffer);
      view.setUint32(8, 7, true);
      view.setUint32(60, crc32(header.subarray(0, 60)), true);
      await handle.write(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
    await expect(JournalSession.open(path, options)).rejects.toBeInstanceOf(
      RetiredJournalError,
    );
    await expect(scanJournalRecording(path, () => {})).rejects.toBeInstanceOf(
      RetiredJournalError,
    );
  });
  it('rejects piece corruption through the package scanner even when the whole-body CRC is repaired', async () => {
    const path = `${directory()}/scanner.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    let recordOffset = 0;
    try {
      await session.store.commit([
        {
          kind: 'setState',
          key: SESSION_KEYS.id,
          value: encodeSessionFact('range-scanner'),
        },
        {
          kind: 'setState',
          key: SESSION_KEYS.start,
          value: encodeSessionFact({
            startTime: '2026-10-20',
            projectHash: 'crc-project',
            workspaceDirs: [],
            kind: 'main',
          }),
        },
        {
          kind: 'setState',
          key: SESSION_KEYS.provider,
          value: encodeSessionFact({ provider: 'test', model: 'test' }),
        },
      ]);
      await session.append([CONTENT]);
      const snapshot = await session.store.snapshot();
      try {
        recordOffset = (await snapshot.entryAt(0)).recordOffset;
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
    const rows: IContent[] = [];
    await scanJournalRecording(path, (contents) => rows.push(...contents));
    expect(rows).toStrictEqual([CONTENT]);
    const head = await headAt(path, recordOffset);
    const header = decodeRowHeader(head.kindHeader);
    const handle = await open(path, 'r+');
    try {
      const body = new Uint8Array(head.bodyLen);
      await handle.read(body, 0, body.length, head.bodyOffset);
      body[header.blocks[1].offset + 25] ^= 1;
      const outer = Buffer.alloc(4);
      outer.writeUInt32LE(crc32(body));
      await handle.write(body, 0, body.length, head.bodyOffset);
      await handle.write(outer, 0, 4, head.bodyOffset + head.bodyLen);
    } finally {
      await handle.close();
    }
    await expect(scanJournalRecording(path, () => {})).rejects.toMatchObject({
      name: 'JournalCorruptionError',
      path,
      offset: recordOffset,
    });
  });
});
