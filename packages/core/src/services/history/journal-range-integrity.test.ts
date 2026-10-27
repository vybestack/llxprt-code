/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { JournalCorruptionError } from '../../journal/errors.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { decodeRowHeader } from '../../journal/rowRecord.js';
import { JournalSession } from './journalSession.js';
import { readFrameHead, type FrameHead } from '../../journal/frame.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import { createFileHandleReader } from '../../journal/positionalFile.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

async function integrityRow(
  path: string,
  run: (
    snapshot: VersionSnapshot,
    entry: RowEntry,
    head: FrameHead,
    session: JournalSession,
  ) => Promise<void>,
): Promise<void> {
  const session = await JournalSession.create(path, {
    journal: testJournalSeams({}, 1, false).dependencies,
  });
  try {
    await session.append([
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'selected payload' },
          {
            type: 'tool_response',
            callId: 'integrity-id',
            toolName: 'lookup',
            result: 'large'.repeat(10000),
          },
        ],
        metadata: { model: 'integrity' },
      },
    ]);
    const snapshot = await session.store.snapshot();
    try {
      const entry = await snapshot.entryAt(0);
      await run(
        snapshot,
        entry,
        await storedHead(path, entry.recordOffset),
        session,
      );
    } finally {
      await snapshot.close();
    }
  } finally {
    await session.close();
  }
}

async function storedHead(path: string, offset: number): Promise<FrameHead> {
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

async function flip(path: string, offset: number): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    const byte = new Uint8Array(1);
    await handle.read(byte, 0, 1, offset);
    byte[0] ^= 1;
    await handle.write(byte, 0, 1, offset);
  } finally {
    await handle.close();
  }
}

async function repairBodyCrc(
  path: string,
  offset: number,
  length: number,
): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    const body = new Uint8Array(length);
    await handle.read(body, 0, length, offset);
    const crc = Buffer.alloc(4);
    crc.writeUInt32LE(crc32(body));
    await handle.write(crc, 0, 4, offset + length);
  } finally {
    await handle.close();
  }
}

describe('native selected range integrity', () => {
  const directory = useTempDir('journal-range-integrity-');
  for (const repair of [false, true]) {
    it(`rejects a selected block bit flip before returning bytes (whole CRC repaired: ${repair})`, async () => {
      const path = `${directory()}/selected.llxj`;
      await integrityRow(path, async (snapshot, entry, head) => {
        const header = decodeRowHeader(head.kindHeader);
        await flip(path, head.bodyOffset + header.blocks[0].offset + 25);
        if (repair) await repairBodyCrc(path, head.bodyOffset, head.bodyLen);
        await expect(snapshot.readBlock(entry, 0)).rejects.toBeInstanceOf(
          JournalCorruptionError,
        );
      });
    });
  }

  it('does not claim to validate an unread block, but detects it when reached and on full read', async () => {
    const path = `${directory()}/unselected.llxj`;
    const session = await JournalSession.create(path, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      await session.append([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'untouched' },
            { type: 'text', text: 'corrupted payload'.repeat(10000) },
          ],
        },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const head = await storedHead(path, entry.recordOffset);
        const header = decodeRowHeader(head.kindHeader);
        await flip(path, head.bodyOffset + header.blocks[1].offset + 25);
        expect(
          new TextDecoder().decode(await snapshot.readBlock(entry, 0)),
        ).toBe('{"type":"text","text":"untouched"}');
        await expect(snapshot.readBlock(entry, 1)).rejects.toBeInstanceOf(
          JournalCorruptionError,
        );
        await expect(snapshot.readRow(entry)).rejects.toBeInstanceOf(
          JournalCorruptionError,
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
});

describe('ROW piece and reference metadata corruption', () => {
  const directory = useTempDir('journal-piece-integrity-');
  for (const [name, position] of [
    ['kind', 0],
    ['frame checksum', 16],
    ['label', 20],
    ['stored owner', 28],
    ['block offset', 84],
    ['block length', 92],
    ['id tuple', 118],
  ] satisfies ReadonlyArray<readonly [string, number]>) {
    it(`rejects ${name} corruption before trusting a selected range`, async () => {
      const path = `${directory()}/header.llxj`;
      await integrityRow(path, async (snapshot, entry, head, session) => {
        await flip(path, head.offset + position);
        await expect(snapshot.readBlock(entry, 0)).rejects.toMatchObject({
          name: 'JournalCorruptionError',
          path,
          offset: entry.recordOffset,
          trailerOffset: session.store.published?.selfOffset,
        });
      });
    });
  }
  for (const target of [
    'ids',
    'ids checksum',
    'metadata',
    'metadata checksum',
    'block checksum',
  ]) {
    it(`checks the ${target} before returning its payload, even with a repaired whole-body CRC`, async () => {
      const path = `${directory()}/piece.llxj`;
      await integrityRow(path, async (snapshot, entry, head, session) => {
        const header = decodeRowHeader(head.kindHeader);
        const offsets: Readonly<Record<string, number>> = {
          ids: 4,
          'ids checksum': header.idsLen,
          metadata: header.idsLen + 4 + 10,
          'metadata checksum': header.idsLen + 4 + header.metaLen,
          'block checksum': header.blocks[0].offset + header.blocks[0].length,
        };
        await flip(path, head.bodyOffset + offsets[target]);
        await repairBodyCrc(path, head.bodyOffset, head.bodyLen);
        const read =
          target === 'block checksum'
            ? snapshot.readBlock(entry, 0)
            : snapshot.readMetadata(entry);
        await expect(read).rejects.toMatchObject({
          name: 'JournalCorruptionError',
          path,
          offset: entry.recordOffset,
          trailerOffset: session.store.published?.selfOffset,
        });
        await expect(snapshot.readRow(entry)).rejects.toBeInstanceOf(
          JournalCorruptionError,
        );
      });
    });
  }

  it('reports a physically truncated selected range as corruption under its pinned trailer', async () => {
    const path = `${directory()}/truncated.llxj`;
    await integrityRow(path, async (snapshot, entry, head, session) => {
      const header = decodeRowHeader(head.kindHeader);
      const handle = await open(path, 'r+');
      try {
        await handle.truncate(head.bodyOffset + header.blocks[1].offset + 30);
      } finally {
        await handle.close();
      }
      await expect(snapshot.readBlock(entry, 1)).rejects.toMatchObject({
        name: 'JournalCorruptionError',
        path,
        offset: entry.recordOffset,
        trailerOffset: session.store.published?.selfOffset,
      });
    });
  });
});

describe('invalid selected range references', () => {
  const directory = useTempDir('journal-range-reference-');
  it('names the row offset and requested ordinal for an absent block', async () => {
    await integrityRow(
      `${directory()}/ordinal.llxj`,
      async (snapshot, entry) => {
        await expect(snapshot.readBlock(entry, 99)).rejects.toThrow(
          `Row ${entry.label} at offset ${entry.recordOffset}: block 99 is absent`,
        );
      },
    );
  });
  it('names the row offset and both identities for a wrong row reference', async () => {
    await integrityRow(
      `${directory()}/identity.llxj`,
      async (snapshot, entry) => {
        const wrong = { ...entry, label: entry.label + 1n };
        const ids = await snapshot.readIds(entry);
        for (const read of [
          () => snapshot.readBlock(wrong, 0),
          () => snapshot.readBlock(wrong, 0, ids),
          () => snapshot.readIds(wrong),
          () => snapshot.readRow(wrong),
          () => snapshot.readMetadata(wrong),
          () => snapshot.readMetadata(wrong, ids),
        ]) {
          await expect(read()).rejects.toThrow(
            `Row at offset ${entry.recordOffset} has label ${entry.label}, its entry says ${wrong.label}`,
          );
        }
      },
    );
  });
  it('reads a reused physical body through its new snapshot label', async () => {
    await integrityRow(
      `${directory()}/reused.llxj`,
      async (snapshot, entry, _head, session) => {
        await session.store.commit([
          { kind: 'replace', rows: [snapshot.sourceRow(entry)] },
        ]);
        const replaced = await session.store.snapshot();
        try {
          const reused = await replaced.entryAt(0);
          expect(reused.recordOffset).toBe(entry.recordOffset);
          expect(reused.label).not.toBe(entry.label);
          const ids = await replaced.readIds(reused);
          expect(ids.header.label).toBe(reused.label);
          for (const block of [
            await replaced.readBlock(reused, 0),
            await replaced.readBlock(reused, 0, ids),
            (await replaced.readRow(reused)).blocks[0],
          ]) {
            expect(new TextDecoder().decode(block)).toBe(
              '{"type":"text","text":"selected payload"}',
            );
          }
          expect((await replaced.readMetadata(reused, ids)).header.label).toBe(
            reused.label,
          );
        } finally {
          await replaced.close();
        }
      },
    );
  });
  it('preserves the CRC cause when the last query pin release also fails', async () => {
    await integrityRow(
      `${directory()}/release.llxj`,
      async (_snapshot, entry, head, session) => {
        const { snapshot, stats } = await measuredRequestSnapshot(
          session,
          new Error('release failure'),
        );
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
        const header = decodeRowHeader(head.kindHeader);
        await flip(
          session.path,
          head.bodyOffset + header.blocks[0].offset + 25,
        );
        let primary: unknown;
        const thrown: unknown = await indexed
          .withNormalized(1, 1, 'call_integrity-id', async () => {
            await snapshot.close();
            await indexed.close();
            try {
              await snapshot.readBlock(entry, 0);
            } catch (error) {
              primary = error;
              throw error;
            }
          })
          .catch((error: unknown) => error);
        expect(thrown).toBeInstanceOf(JournalCorruptionError);
        expect(thrown).toBe(primary);
        if (!(thrown instanceof JournalCorruptionError))
          throw new Error('Missing corruption');
        expect(thrown.cause).toMatchObject({
          code: 'body-crc-mismatch',
          offset: entry.recordOffset,
        });
        expect(stats.releases).toBe(1);
      },
    );
  });
});
