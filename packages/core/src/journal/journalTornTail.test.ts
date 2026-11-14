/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { JournalCorruptionError } from './errors.js';
import type { CommitAck } from './groupWriter.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { FRAME_HEAD_BYTES } from './frame.js';
import { createRecordAccess } from './recordAccess.js';
import { openJournalForOwner } from './journalWriterOpen.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import { locateCommittedState } from './trailerSearch.js';
import {
  buildJournal,
  fourRootGroup,
  standardGroup,
  testJournalSeams,
  withBitFlipped,
  type BuiltJournal,
} from './__tests__/support/journalFixtures.js';
import { bufferReader, collect } from './__tests__/support/memoryIo.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const FILE = 'memory.llxj';
const ROW_BODY_BYTES = 100;
const ROW_KIND_HEADER_BYTES = 24;

async function fiveGroups(directory: string): Promise<BuiltJournal> {
  return buildJournal(path.join(directory, 'five.llxj'), [
    standardGroup(1),
    fourRootGroup(2),
    standardGroup(3, { rowBodyBytes: 150 }),
    fourRootGroup(4),
    standardGroup(5, { rowBodyBytes: 60 }),
  ]);
}

/** The last ack whose trailer ends at or before `cut`, the state a reader must open. */
function lastWholeAt(built: BuiltJournal, cut: number): CommitAck | undefined {
  const whole = built.acks.filter((ack) => ack.durableEnd <= cut);
  return whole[whole.length - 1];
}

describe('truncating at every byte offset of the last three groups', () => {
  const tempDir = useTempDir('journal-torn-');

  it('opens, for a reader, the last whole trailer at or before the cut', async () => {
    const built = await fiveGroups(tempDir());
    const first = built.acks[1].durableEnd - TRAILER_RECORD_BYTES;
    let checked = 0;

    for (let cut = first; cut <= built.bytes.length; cut++) {
      const expected = lastWholeAt(built, cut);
      const state = await locateCommittedState(
        FILE,
        bufferReader(built.bytes),
        cut,
      );

      expect(state.trailer?.commitSeq).toBe(expected?.commitSeq);
      expect(state.trailer?.groupTag).toBe(expected?.groupTag);
      expect(state.trailer?.durableEnd).toBe(expected?.durableEnd);
      checked += 1;
    }

    expect(checked).toBeGreaterThan(3 * TRAILER_RECORD_BYTES);
  });

  it('truncates, for the owner, exactly the bytes behind the last whole trailer', async () => {
    const built = await fiveGroups(tempDir());
    const file = path.join(tempDir(), 'cut.llxj');
    const first = built.acks[1].durableEnd - TRAILER_RECORD_BYTES;
    const { dependencies } = testJournalSeams();

    for (let cut = first; cut <= built.bytes.length; cut++) {
      await fsp.writeFile(file, built.bytes.subarray(0, cut));
      const expected = lastWholeAt(built, cut);
      const keptEnd = expected?.durableEnd ?? JOURNAL_HEADER_BYTES;

      const { writer, recovery } = await openJournalForOwner(
        file,
        dependencies,
      );
      await writer.close();

      expect(recovery.uncommittedBytes).toBe(cut - keptEnd);
      expect((await fsp.stat(file)).size).toBe(keptEnd);
      expect(writer.published?.commitSeq).toBe(expected?.commitSeq);
    }
  });
});

describe('flipping every bit of one part of a journal', () => {
  const tempDir = useTempDir('journal-flips-');

  async function oneGroup(): Promise<BuiltJournal> {
    return buildJournal(path.join(tempDir(), 'one.llxj'), [
      standardGroup(1, { rowBodyBytes: ROW_BODY_BYTES }),
    ]);
  }

  it('detects every flipped bit of the file header', async () => {
    const built = await oneGroup();

    for (let byte = 0; byte < JOURNAL_HEADER_BYTES; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const damaged = withBitFlipped(built.bytes, byte, bit);
        const outcome = await locateCommittedState(
          FILE,
          bufferReader(damaged),
          damaged.length,
        ).then(
          () => 'opened',
          (error: unknown) =>
            error instanceof Error ? error.name : 'not an error',
        );

        expect(['RetiredJournalError', 'JournalFormatError']).toContain(
          outcome,
        );
      }
    }
  });

  /** Flips each bit of `[start, end)` of the ROW at the start of the file body and runs `read`. */
  async function flipRange(
    start: number,
    end: number,
    read: (bytes: Uint8Array) => Promise<unknown>,
  ): Promise<number> {
    const built = await oneGroup();
    let detected = 0;
    for (let byte = start; byte < end; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const failure = await read(withBitFlipped(built.bytes, byte, bit)).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(JournalCorruptionError);
        expect(
          failure instanceof JournalCorruptionError && failure.offset,
        ).toBe(JOURNAL_HEADER_BYTES);
        detected += 1;
      }
    }
    return detected;
  }

  async function readRecordFully(bytes: Uint8Array): Promise<void> {
    const state = await locateCommittedState(
      FILE,
      bufferReader(bytes),
      bytes.length,
    );
    if (state.trailer === undefined) throw new Error('no trailer');
    const access = createRecordAccess(FILE, bufferReader(bytes), state.trailer);
    const head = await access.readRecordHead(JOURNAL_HEADER_BYTES);
    await collect(access.readRecordBody(head));
  }

  it('detects every flipped bit of a frame head', async () => {
    const detected = await flipRange(
      JOURNAL_HEADER_BYTES,
      JOURNAL_HEADER_BYTES + FRAME_HEAD_BYTES,
      readRecordFully,
    );

    expect(detected).toBe(FRAME_HEAD_BYTES * 8);
  });

  it('detects every flipped bit of a kind header', async () => {
    const start = JOURNAL_HEADER_BYTES + FRAME_HEAD_BYTES;
    const detected = await flipRange(
      start,
      start + ROW_KIND_HEADER_BYTES,
      readRecordFully,
    );

    expect(detected).toBe(ROW_KIND_HEADER_BYTES * 8);
  });

  it('detects every flipped bit of a body and of its CRC', async () => {
    const start =
      JOURNAL_HEADER_BYTES + FRAME_HEAD_BYTES + ROW_KIND_HEADER_BYTES;
    const detected = await flipRange(
      start,
      start + ROW_BODY_BYTES + 4,
      readRecordFully,
    );

    expect(detected).toBe((ROW_BODY_BYTES + 4) * 8);
  });

  it('never accepts a trailer with a flipped bit: the previous trailer is the state', async () => {
    const built = await buildJournal(path.join(tempDir(), 'two.llxj'), [
      standardGroup(1),
      standardGroup(2),
    ]);
    const start = built.acks[1].durableEnd - TRAILER_RECORD_BYTES;

    for (let byte = start; byte < built.acks[1].durableEnd; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const damaged = withBitFlipped(built.bytes, byte, bit);
        const state = await locateCommittedState(
          FILE,
          bufferReader(damaged),
          damaged.length,
        );

        expect(state.trailer?.commitSeq).toBe(1);
      }
    }
  });
});
