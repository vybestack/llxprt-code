/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { JournalCorruptionError } from './errors.js';
import { JOURNAL_HEADER_BYTES, decodeJournalHeader } from './fileHeader.js';
import { createRecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import { TRAILER_RECORD_BYTES, type TrailerHeader } from './trailerRecord.js';
import {
  TRAILER_CHUNK_BYTES,
  TRAILER_WINDOW_BYTES,
  locateCommittedState,
  structuralTrailers,
  verifyTrailerRoots,
} from './trailerSearch.js';
import {
  buildJournal,
  buildJournalKeepingTail,
  fourRootGroup,
  plainRecord,
  standardGroup,
  testJournalSeams,
  trailerStateFor,
  withBitFlipped,
  withZeroed,
} from './__tests__/support/journalFixtures.js';
import { bufferReader } from './__tests__/support/memoryIo.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const FILE = 'memory.llxj';
const MIB = 1024 * 1024;

async function committedSeq(bytes: Uint8Array): Promise<number | undefined> {
  const state = await locateCommittedState(
    FILE,
    bufferReader(bytes),
    bytes.length,
  );
  return state.trailer?.commitSeq;
}

describe('finding the last trailer', () => {
  const tempDir = useTempDir('journal-search-');

  it('returns the newest trailer of a journal', async () => {
    const built = await buildJournal(path.join(tempDir(), 'a.llxj'), [
      standardGroup(1),
      standardGroup(2),
      standardGroup(3),
    ]);

    expect(await committedSeq(built.bytes)).toBe(3);
  });

  it('returns no trailer for a journal that holds only its header', async () => {
    const built = await buildJournal(path.join(tempDir(), 'empty.llxj'), []);

    expect(built.bytes.length).toBe(JOURNAL_HEADER_BYTES);
    expect(await committedSeq(built.bytes)).toBeUndefined();
  });

  it('skips an uncommitted tail left by a group whose flush failed', async () => {
    const seams = testJournalSeams({ failFlushAt: 1 });
    const file = path.join(tempDir(), 'tail.llxj');
    const built = await buildJournalKeepingTail(file, seams, [
      standardGroup(1),
      standardGroup(2, { rowBodyBytes: 70_000 }),
    ]);

    expect(built.bytes.length).toBeGreaterThan(
      built.acks[0].durableEnd + 70_000,
    );
    expect(await committedSeq(built.bytes)).toBe(1);
  });

  it('steps back over an uncommitted tail of several chunks', async () => {
    const seams = testJournalSeams({ failFlushAt: 1 });
    const file = path.join(tempDir(), 'long-tail.llxj');
    const built = await buildJournalKeepingTail(file, seams, [
      standardGroup(1),
      standardGroup(2, { rowBodyBytes: 9 * MIB }),
    ]);

    expect(built.bytes.length - built.acks[0].durableEnd).toBeGreaterThan(
      2 * TRAILER_CHUNK_BYTES,
    );
    expect(await committedSeq(built.bytes)).toBe(1);
  });

  for (const chunks of [1, 2]) {
    it(`finds a trailer whose marker straddles chunk boundary ${chunks}`, async () => {
      const built = await buildJournal(
        path.join(tempDir(), `straddle-${chunks}.llxj`),
        [standardGroup(1), standardGroup(2)],
      );
      const lastEnd = built.acks[1].durableEnd;
      // A boundary of the backward scan lands 4 bytes into the marker.
      const tail = TRAILER_WINDOW_BYTES + chunks * TRAILER_CHUNK_BYTES - 8;
      const padded = new Uint8Array(lastEnd + tail);
      padded.set(built.bytes);

      expect(await committedSeq(padded)).toBe(2);
    });
  }

  it('is not confused by a row body that quotes the sync marker', async () => {
    const marker = (await buildJournal(path.join(tempDir(), 'm.llxj'), []))
      .syncMarker;
    const quoting = plainRecord(RECORD_KIND.ROW, 77, 3 * 1500);
    const body = new Uint8Array(3 * 1500).fill(0x41);
    for (const at of [0, 1492, 2000, 3000, 4480]) body.set(marker, at);
    const group = {
      records: [
        { ...quoting, body: { length: body.length, chunks: [body] } },
        plainRecord(RECORD_KIND.RTNODE, 78, 20),
      ],
      trailer: (offsets: readonly number[]) =>
        trailerStateFor(9, { rowRoot: offsets[1] }),
    };
    const built = await buildJournal(path.join(tempDir(), 'q.llxj'), [
      standardGroup(1),
      group,
    ]);
    // The marker really is in the file many times; only two are trailer ends.
    expect(countOccurrences(built.bytes, built.syncMarker)).toBeGreaterThan(5);

    expect(await committedSeq(built.bytes)).toBe(2);
  });

  it('is not confused by a quoted marker in an uncommitted tail', async () => {
    const seams = testJournalSeams({ failFlushAt: 1 });
    const marker = (await buildJournal(path.join(tempDir(), 'm.llxj'), []))
      .syncMarker;
    const body = new Uint8Array(4000).fill(0x42);
    body.set(marker, 1492);
    body.set(marker, 3900);
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'qt.llxj'),
      seams,
      [
        standardGroup(1),
        {
          records: [
            {
              kind: RECORD_KIND.ROW,
              kindHeader: new Uint8Array(8),
              body: { length: body.length, chunks: [body] },
            },
          ],
          trailer: () => trailerStateFor(2, {}),
        },
      ],
    );

    expect(await committedSeq(built.bytes)).toBe(1);
  });

  it('is not confused by a body that holds a whole copy of an older trailer', async () => {
    // The same seed gives the same file marker, so the copy is a valid trailer of this file.
    const source = await buildJournal(path.join(tempDir(), 'one.llxj'), [
      standardGroup(1),
    ]);
    const copy = source.bytes.slice(
      source.acks[0].durableEnd - TRAILER_RECORD_BYTES,
      source.acks[0].durableEnd,
    );
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'copy.llxj'),
      testJournalSeams({ failFlushAt: 2 }),
      [
        standardGroup(1),
        standardGroup(2),
        {
          records: [
            {
              kind: RECORD_KIND.ROW,
              kindHeader: new Uint8Array(8),
              body: { length: copy.length, chunks: [copy] },
            },
          ],
          trailer: () => trailerStateFor(3, {}),
        },
      ],
    );

    expect(built.syncMarker).toStrictEqual(source.syncMarker);
    // The header, two trailers and the quoted copy.
    expect(countOccurrences(built.bytes, built.syncMarker)).toBe(4);
    expect(await committedSeq(built.bytes)).toBe(2);
  });
});

function countOccurrences(bytes: Uint8Array, needle: Uint8Array): number {
  const haystack = Buffer.from(bytes);
  let count = 0;
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) return count;
    count += 1;
    from = found + 1;
  }
}

describe('a torn trailer and a damaged root', () => {
  const tempDir = useTempDir('journal-roots-');
  const ROOT_NAMES = ['rowRoot', 'idRoot', 'metaRoot', 'stateRoot'] as const;

  async function twoGroups() {
    return buildJournal(path.join(tempDir(), 'roots.llxj'), [
      fourRootGroup(1),
      fourRootGroup(2),
    ]);
  }

  it('falls back to the previous trailer when the last trailer is cut', async () => {
    const built = await twoGroups();
    const cutAt = built.acks[1].durableEnd - TRAILER_RECORD_BYTES / 2;

    expect(await committedSeq(built.bytes.slice(0, cutAt))).toBe(1);
  });

  it('falls back to the previous trailer when only the last byte of the last trailer is missing', async () => {
    const built = await twoGroups();

    expect(
      await committedSeq(built.bytes.slice(0, built.acks[1].durableEnd - 1)),
    ).toBe(1);
  });

  for (const [index, name] of ROOT_NAMES.entries()) {
    it(`throws, naming ${name} and its offset, when that root is damaged under an intact trailer`, async () => {
      const built = await twoGroups();
      const trailer = await trailerOf(built.bytes);
      const rootOffset = trailer[name];
      const damaged = withBitFlipped(built.bytes, rootOffset + 30, 3);

      const failure = await failureOf(() =>
        locateCommittedState(FILE, bufferReader(damaged), damaged.length),
      );

      expect(failure).toBeInstanceOf(JournalCorruptionError);
      expect(failure instanceof JournalCorruptionError && failure.what).toBe(
        name,
      );
      expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
        rootOffset,
      );
      expect(
        failure instanceof JournalCorruptionError && failure.trailerOffset,
      ).toBe(trailer.selfOffset);
      expect(index).toBeLessThan(4);
    });
  }

  it('does not throw for the same damage under an older trailer', async () => {
    const built = await twoGroups();
    const first = await trailerOf(
      built.bytes.slice(0, built.acks[0].durableEnd),
    );
    const damaged = withBitFlipped(built.bytes, first.rowRoot + 30, 3);

    expect(await committedSeq(damaged)).toBe(2);
  });

  it('throws for a root that points past the end of the file', async () => {
    const built = await buildJournal(path.join(tempDir(), 'past.llxj'), [
      {
        records: [plainRecord(RECORD_KIND.RTNODE, 5, 10)],
        trailer: () => trailerStateFor(5, { rowRoot: 50_000_000 }),
      },
    ]);

    const failure = await failureOf(() =>
      locateCommittedState(FILE, bufferReader(built.bytes), built.bytes.length),
    );

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
      50_000_000,
    );
  });

  it('throws for a root that names a record of the wrong kind', async () => {
    const built = await buildJournal(path.join(tempDir(), 'kind.llxj'), [
      {
        records: [plainRecord(RECORD_KIND.ITNODE, 6, 10)],
        trailer: (offsets) => trailerStateFor(6, { rowRoot: offsets[0] }),
      },
    ]);

    const failure = await failureOf(() =>
      locateCommittedState(FILE, bufferReader(built.bytes), built.bytes.length),
    );

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.what).toBe(
      'rowRoot',
    );
  });

  /** What a search does with a damaged root under an intact trailer. */
  async function outcomeOfBadRoot(
    find: (bytes: Uint8Array) => Promise<TrailerHeader | undefined>,
  ): Promise<string> {
    const built = await twoGroups();
    const trailer = await trailerOf(built.bytes);
    const damaged = withBitFlipped(built.bytes, trailer.idRoot + 30, 0);
    const failure = await failureOf(() => find(damaged));
    if (failure instanceof JournalCorruptionError) return 'corruption';
    if (failure !== undefined) throw failure;
    return `opened commit ${(await find(damaged))?.commitSeq}`;
  }

  async function realSearch(
    bytes: Uint8Array,
  ): Promise<TrailerHeader | undefined> {
    const state = await locateCommittedState(
      FILE,
      bufferReader(bytes),
      bytes.length,
    );
    return state.trailer;
  }

  /** The control: the same search, except that it steps back to an older trailer on a bad root. */
  async function fallingBackSearch(
    bytes: Uint8Array,
  ): Promise<TrailerHeader | undefined> {
    const reader = bufferReader(bytes);
    const { syncMarker } = decodeJournalHeader(
      bytes.slice(0, JOURNAL_HEADER_BYTES),
    );
    for await (const candidate of structuralTrailers(
      reader,
      bytes.length,
      syncMarker,
    )) {
      try {
        await verifyTrailerRoots(FILE, reader, candidate);
        return candidate;
      } catch (error) {
        if (!(error instanceof JournalCorruptionError)) throw error;
      }
    }
    return undefined;
  }

  it('reports corruption, and no older state, from the real search', async () => {
    expect(await outcomeOfBadRoot(realSearch)).toBe('corruption');
  });

  it('control: a search that falls back on a bad root opens the older trailer, which the assertion above rejects', async () => {
    const outcome = await outcomeOfBadRoot(fallingBackSearch);

    expect(outcome).not.toBe('corruption');
    expect(outcome).toBe('opened commit 1');
  });
});

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function trailerOf(bytes: Uint8Array): Promise<TrailerHeader> {
  const state = await locateCommittedState(
    FILE,
    bufferReader(bytes),
    bytes.length,
  );
  if (state.trailer === undefined) throw new Error('no trailer');
  return state.trailer;
}

describe('a record lost under an intact trailer', () => {
  const tempDir = useTempDir('journal-lost-');

  async function reachable() {
    const built = await buildJournal(path.join(tempDir(), 'lost.llxj'), [
      standardGroup(1),
      standardGroup(2),
    ]);
    const trailer = await trailerOf(built.bytes);
    // standardGroup writes the ROW first: it starts where the previous group ended.
    const rowOffset = built.acks[0].durableEnd;
    return { built, trailer, rowOffset };
  }

  /** What a reader does with a reached row whose first bytes were zeroed. */
  async function failureOfLostRow(
    read: (
      bytes: Uint8Array,
      trailer: TrailerHeader,
      offset: number,
    ) => Promise<void>,
  ) {
    const { built, trailer, rowOffset } = await reachable();
    const zeroed = withZeroed(built.bytes, rowOffset, rowOffset + 100);
    return {
      failure: await failureOf(() => read(zeroed, trailer, rowOffset)),
      trailer,
      rowOffset,
    };
  }

  it('throws JournalCorruptionError with the offset when a reached row is zeroed', async () => {
    const { failure, trailer, rowOffset } = await failureOfLostRow(
      async (bytes, found, offset) => {
        const access = createRecordAccess(FILE, bufferReader(bytes), found);
        await access.readRecordHead(offset);
      },
    );

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
      rowOffset,
    );
    expect(
      failure instanceof JournalCorruptionError && failure.trailerOffset,
    ).toBe(trailer.selfOffset);
  });

  it('control: a reader that skips the CRC check on rows sees no failure at all', async () => {
    const { failure } = await failureOfLostRow(
      async (bytes, _trailer, offset) => {
        await bufferReader(bytes).readAt(offset, 100);
      },
    );

    expect(failure).toBeUndefined();
  });

  it('throws at open when a zeroed record is a root, and the file is not touched', async () => {
    const { built, trailer } = await reachable();
    const zeroed = withZeroed(
      built.bytes,
      trailer.rowRoot,
      trailer.rowRoot + 80,
    );

    const failure = await failureOf(() =>
      locateCommittedState(FILE, bufferReader(zeroed), zeroed.length),
    );

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
      trailer.rowRoot,
    );
  });
});
