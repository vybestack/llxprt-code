/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { crc32 } from './bytes.js';
import { decodeJournalHeader, JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { decodeFrameStart, encodeBodylessFrame } from './frame.js';
import { RECORD_KIND } from './recordKinds.js';
import { decodeTrailerHeader } from './trailerRecord.js';

/** Preserve the v11 frozen digest across v12's three added filledThrough words. */
function frozenAppendBytes(bytes: Buffer): Uint8Array {
  decodeJournalHeader(bytes.subarray(0, JOURNAL_HEADER_BYTES));
  const header = Buffer.from(bytes.subarray(0, JOURNAL_HEADER_BYTES));
  expect(header.readUInt32LE(8)).toBe(12);
  header.writeUInt32LE(11, 8);
  header.writeUInt32LE(crc32(header.subarray(0, 60)), 60);
  let offset = JOURNAL_HEADER_BYTES;
  while (offset < bytes.length) {
    const frame = decodeFrameStart(bytes.subarray(offset), offset);
    if (frame.kind === RECORD_KIND.TRAILER) {
      expect(frame.endOffset).toBe(bytes.length);
      const trailer = decodeTrailerHeader(frame.kindHeader);
      expect(trailer.selfOffset).toBe(offset);
      expect(trailer.durableEnd).toBe(bytes.length);
      for (const slot of trailer.slots.formatSlots)
        expect(slot.filledThrough).toBe(0);
      const current = Buffer.from(frame.kindHeader);
      const old = Buffer.concat([
        current.subarray(0, 1368),
        ...[0, 1, 2].map((slot) =>
          current.subarray(1368 + slot * 40, 1400 + slot * 40),
        ),
        current.subarray(1488),
      ]);
      old.writeBigUInt64LE(BigInt(bytes.length - 24), 1528);
      return Buffer.concat([
        header,
        bytes.subarray(JOURNAL_HEADER_BYTES, offset),
        encodeBodylessFrame(RECORD_KIND.TRAILER, old),
      ]);
    }
    offset = frame.endOffset;
  }
  throw new Error('Prepared append has no trailer');
}

const cases = [
  {
    count: 4096,
    reads: 31066,
    digest: '6ca6a3be344776b5b0feef86f31bb3da898c4d38c4bdb74a89fb5ddc9a7a8763',
  },
  {
    count: 8192,
    reads: 68201,
    digest: '4208bb94aab3e9d37f036554b2f76d5a93fc428f757e182a28cfb69f81f890eb',
  },
];

describe('prepared append descriptor read cost', () => {
  const directory = useTempDir('prepared-append-reads-');
  it.each(cases)(
    'bounds trie readback without changing durable bytes for $count rows',
    async ({ count, reads, digest }) => {
      const counter = { reads: 0 };
      const file = join(directory(), `${count}.llxj`);
      const store = await JournalStore.create(
        file,
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
        }),
      );
      try {
        await store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await group.append(
                (async function* () {
                  for (let index = 0; index < count; index++)
                    yield draftRow({
                      text: `row ${index}`,
                      chronologySeq: BigInt(index),
                    });
                })(),
                [],
              );
            },
          },
        ]);
        process.stdout.write(
          `PREPARED_APPEND_READS ${JSON.stringify({ count, reads: counter.reads })}\n`,
        );
        expect(store.published?.rows).toBe(count);
        expect(
          createHash('sha256')
            .update(frozenAppendBytes(await readFile(file)))
            .digest('hex'),
        ).toBe(digest);
        expect(counter.reads).toBeLessThanOrEqual(reads);
      } finally {
        await store.close();
      }
    },
    180000,
  );
});
