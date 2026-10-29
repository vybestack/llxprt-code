/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { decodeJournalHeader, JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { decodeFrameStart } from './frame.js';
import { RECORD_KIND } from './recordKinds.js';
import { decodeTrailerHeader } from './trailerRecord.js';

/** Format 13 includes transcript references; freeze its actual durable bytes. */
function frozenAppendBytes(bytes: Buffer): Uint8Array {
  decodeJournalHeader(bytes.subarray(0, JOURNAL_HEADER_BYTES));
  expect(bytes.readUInt32LE(8)).toBe(13);
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
      return bytes;
    }
    offset = frame.endOffset;
  }
  throw new Error('Prepared append has no trailer');
}

const cases = [
  {
    count: 4096,
    reads: 31066,
    digest: '9eb2fc8d8d7c3c0186749c9df9c3a9e6fdc29ed96b942f923ebda23381915a15',
  },
  {
    count: 8192,
    reads: 68201,
    digest: 'd86a915cae1043c18b09af00e32a5b92aaa3f187267957b321f996547fd9f1ac',
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
