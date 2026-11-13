/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { recordMemoryGate } from './__tests__/support/memory-gate-evidence.js';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';
import type { FrameBody } from './frame.js';
import type { CommitGroup } from './groupWriter.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { openJournalReadOnly } from './journalReader.js';
import { createJournal } from './journalWriterOpen.js';
import { RECORD_KIND } from './recordKinds.js';
import {
  plainRecord,
  testJournalSeams,
  trailerStateFor,
} from './__tests__/support/journalFixtures.js';
import {
  MIB,
  producedBody,
  startGrowthProbe,
  type GrowthProbe,
} from './__tests__/support/streamedBody.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const CHUNK_BYTES = 64 * 1024;
const SAMPLE_EVERY_CHUNKS = 8;
/** Maximum writer/reader peak of the one-chunk fixture on 2026-11-13. */
const ONE_CHUNK_FIXED_OVERHEAD_BYTES = 368_928;
/** Source chunk, frame output chunk, and one journal I/O chunk. */
const IN_FLIGHT_CHUNKS = 3;
const STREAMING_GROWTH_BOUND =
  ONE_CHUNK_FIXED_OVERHEAD_BYTES + IN_FLIGHT_CHUNKS * CHUNK_BYTES;

type BodyMaker = (body: FrameBody) => Promise<FrameBody>;

const streamed: BodyMaker = (body) => Promise.resolve(body);

/** The trap: gathers the whole body before the writer sees it. */
const gathered: BodyMaker = async (body) => {
  const parts: Uint8Array[] = [];
  for await (const chunk of body.chunks) parts.push(chunk);
  return { length: body.length, chunks: [Buffer.concat(parts)] };
};

function bigRowGroup(body: FrameBody): CommitGroup {
  return {
    records: [
      { kind: RECORD_KIND.ROW, kindHeader: new Uint8Array(64).fill(7), body },
      plainRecord(RECORD_KIND.RTNODE, 3, 16),
    ],
    trailer: (offsets) => trailerStateFor(1, { rowRoot: offsets[1] }),
  };
}

interface Outcome {
  readonly written: { crc: number; bytes: number };
  readonly writeGrowth: number;
  readonly readBack: { crc: number; bytes: number };
  readonly readGrowth: number;
}

async function writeAndReadBack(
  directory: string,
  totalBytes: number,
  makeBody: BodyMaker,
  retainWhileReading: boolean,
): Promise<Outcome> {
  const file = path.join(directory, `row-${totalBytes}.llxj`);
  const { dependencies } = testJournalSeams();
  const writeProbe = await startGrowthProbe();
  const produced = producedBody(
    totalBytes,
    CHUNK_BYTES,
    writeProbe,
    SAMPLE_EVERY_CHUNKS,
  );
  const writer = await createJournal(file, dependencies);
  const body = await makeBody({ length: totalBytes, chunks: produced.chunks });
  await writer.commitGroup(bigRowGroup(body));
  await writeProbe.sample();
  await writer.close();

  const readProbe = await startGrowthProbe();
  const reader = await openJournalReadOnly(file, dependencies);
  const head = await reader.readRecordHead(JOURNAL_HEADER_BYTES);
  const readBack = await consume(
    reader.readRecordBody(head, CHUNK_BYTES),
    readProbe,
    retainWhileReading,
  );
  await reader.close();
  return {
    written: produced.produced(),
    writeGrowth: writeProbe.peakGrowth(),
    readBack,
    readGrowth: readProbe.peakGrowth(),
  };
}

async function consume(
  chunks: AsyncIterable<Uint8Array>,
  probe: GrowthProbe,
  retain: boolean,
): Promise<{ crc: number; bytes: number }> {
  const kept: Uint8Array[] = [];
  let crc = 0;
  let bytes = 0;
  let index = 0;
  for await (const chunk of chunks) {
    if (retain) kept.push(chunk);
    // Sample while the chunk is in use, so an oversized chunk is counted.
    if (index++ % SAMPLE_EVERY_CHUNKS === 0) await probe.sample();
    crc = crc32(chunk, crc);
    bytes += chunk.length;
  }
  await probe.sample();
  return { crc, bytes: retain ? Buffer.concat(kept).length : bytes };
}

const CASES: ReadonlyArray<readonly [number, number]> = [
  [MIB, Math.min(8 * CHUNK_BYTES, STREAMING_GROWTH_BOUND)],
  [15 * MIB, STREAMING_GROWTH_BOUND],
];

describe('rows larger than any buffer the codec would allocate', () => {
  const tempDir = useTempDir('journal-large-');

  for (const [size, bound] of CASES) {
    it(`writes, reopens and reads back a ${size / MIB} MiB row with the CRC checked and the heap far below the body`, async () => {
      const outcome = await writeAndReadBack(tempDir(), size, streamed, false);

      expect(outcome.written.bytes).toBe(size);
      expect(outcome.readBack).toStrictEqual(outcome.written);
      recordMemoryGate('journalLargeRows', {
        bytes: size,
        write: outcome.writeGrowth,
        read: outcome.readGrowth,
      });
      expect(outcome.writeGrowth).toBeLessThan(bound);
      expect(outcome.readGrowth).toBeLessThan(bound);
    });
  }

  it('control: a writer that gathers the body before writing exceeds the heap bound', async () => {
    const [size, bound] = CASES[1];

    const outcome = await writeAndReadBack(tempDir(), size, gathered, false);

    expect(outcome.readBack).toStrictEqual(outcome.written);
    recordMemoryGate('journalLargeRows-write-control', {
      bytes: size,
      peak: outcome.writeGrowth,
    });
    expect(outcome.writeGrowth).toBeGreaterThan(4 * bound);
  });

  it('control: a reader that keeps every chunk exceeds the heap bound', async () => {
    const [size, bound] = CASES[1];

    const outcome = await writeAndReadBack(tempDir(), size, streamed, true);

    recordMemoryGate('journalLargeRows-read-control', {
      bytes: size,
      peak: outcome.readGrowth,
    });
    expect(outcome.readGrowth).toBeGreaterThan(4 * bound);
  });
});
