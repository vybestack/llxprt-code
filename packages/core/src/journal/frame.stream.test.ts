/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';
import {
  FRAME_HEAD_BYTES,
  readFrameBody,
  readFrameHead,
  writeFrame,
  type FrameBody,
} from './frame.js';
import {
  createFileHandleReader,
  createFileHandleSink,
  type ByteSink,
  type PositionalReader,
} from './positionalFile.js';
import { RECORD_KIND } from './recordKinds.js';
import { encodeRowHeader, ROW_ID_KIND } from './rowRecord.js';
import {
  MIB,
  producedBody,
  startGrowthProbe,
  type GrowthProbe,
} from './__tests__/support/streamedBody.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const BODY_BYTES = 200 * MIB;
const CHUNK_BYTES = MIB;
const SAMPLE_EVERY_CHUNKS = 20;
/** Streaming holds a few chunks. 200 MiB retained would be twelve times this. */
const STREAMING_GROWTH_BOUND = 16 * MIB;
const RETAINED_GROWTH_FLOOR = 100 * MIB;
const KIND_HEADER = new Uint8Array(24).fill(0x5a);

type FrameWriter = (sink: ByteSink, body: FrameBody) => Promise<unknown>;

const streamingWriter: FrameWriter = (sink, body) =>
  writeFrame(sink, 0x01, KIND_HEADER, body);

/** The trap: gathers the whole body, then writes it as one piece. */
const bufferingWriter: FrameWriter = async (sink, body) => {
  const gathered: Uint8Array[] = [];
  for await (const chunk of body.chunks) gathered.push(chunk);
  await writeFrame(sink, 0x01, KIND_HEADER, {
    length: body.length,
    chunks: [Buffer.concat(gathered)],
  });
};

async function encodeToFile(
  file: string,
  write: FrameWriter,
  probe: GrowthProbe,
): Promise<{ crc: number; bytes: number }> {
  const body = producedBody(
    BODY_BYTES,
    CHUNK_BYTES,
    probe,
    SAMPLE_EVERY_CHUNKS,
  );
  const handle = await fs.open(file, 'w+');
  try {
    await write(createFileHandleSink(handle, 0), {
      length: BODY_BYTES,
      chunks: body.chunks,
    });
    await probe.sample();
  } finally {
    await handle.close();
  }
  return body.produced();
}

type BodyConsumer = (
  reader: PositionalReader,
  head: Awaited<ReturnType<typeof readFrameHead>>,
  probe: GrowthProbe,
) => Promise<{ crc: number; bytes: number }>;

const streamingConsumer: BodyConsumer = async (reader, head, probe) => {
  let crc = 0;
  let bytes = 0;
  let index = 0;
  for await (const chunk of readFrameBody(reader, head, CHUNK_BYTES)) {
    // Sample while the chunk is still in use, so an oversized chunk is counted.
    if (index++ % SAMPLE_EVERY_CHUNKS === 0) await probe.sample();
    crc = crc32(chunk, crc);
    bytes += chunk.length;
  }
  return { crc, bytes };
};

/** The trap: reads the whole body into one buffer before looking at it. */
const wholeBodyConsumer: BodyConsumer = async (reader, head, probe) => {
  const whole = await reader.readAt(head.bodyOffset, head.bodyLen);
  await probe.sample();
  return { crc: crc32(whole), bytes: whole.length };
};

async function decodeFromFile(
  file: string,
  consume: BodyConsumer,
  probe: GrowthProbe,
): Promise<{ crc: number; bytes: number }> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const reader = createFileHandleReader(handle);
    const head = await readFrameHead(reader, 0, size);
    return await consume(reader, head, probe);
  } finally {
    await handle.close();
  }
}

async function warmUp(file: string): Promise<void> {
  const probe = await startGrowthProbe();
  const handle = await fs.open(file, 'w+');
  try {
    const body = producedBody(4 * MIB, CHUNK_BYTES, probe, 1000);
    await writeFrame(createFileHandleSink(handle, 0), 0x01, KIND_HEADER, {
      length: 4 * MIB,
      chunks: body.chunks,
    });
    const { size } = await handle.stat();
    const reader = createFileHandleReader(handle);
    const head = await readFrameHead(reader, 0, size);
    for await (const chunk of readFrameBody(reader, head, CHUNK_BYTES))
      crc32(chunk);
  } finally {
    await handle.close();
  }
}

describe('a 200 MiB body', () => {
  const tempDir = useTempDir('journal-stream-');

  it('encodes and decodes through the frame codec with heap growth far below the body size', async () => {
    const file = path.join(tempDir(), 'streamed.llxj');
    await warmUp(path.join(tempDir(), 'warm.llxj'));

    const encodeProbe = await startGrowthProbe();
    const written = await encodeToFile(file, streamingWriter, encodeProbe);
    const decodeProbe = await startGrowthProbe();
    const read = await decodeFromFile(file, streamingConsumer, decodeProbe);

    expect((await fs.stat(file)).size).toBe(
      FRAME_HEAD_BYTES + KIND_HEADER.length + BODY_BYTES + 4,
    );
    expect(read).toStrictEqual(written);
    expect(encodeProbe.peakGrowth()).toBeLessThan(STREAMING_GROWTH_BOUND);
    expect(decodeProbe.peakGrowth()).toBeLessThan(STREAMING_GROWTH_BOUND);
  }, 180_000);

  it('is caught when an encoder buffers the whole body', async () => {
    const file = path.join(tempDir(), 'trap-encode.llxj');

    const probe = await startGrowthProbe();
    await encodeToFile(file, bufferingWriter, probe);

    expect(probe.peakGrowth()).toBeGreaterThan(RETAINED_GROWTH_FLOOR);
    expect(probe.peakGrowth()).not.toBeLessThan(STREAMING_GROWTH_BOUND);
  }, 180_000);

  it('is caught when a decoder reads the whole body', async () => {
    const file = path.join(tempDir(), 'trap-decode.llxj');
    await encodeToFile(file, streamingWriter, await startGrowthProbe());

    const probe = await startGrowthProbe();
    await decodeFromFile(file, wholeBodyConsumer, probe);

    expect(probe.peakGrowth()).toBeGreaterThan(RETAINED_GROWTH_FLOOR);
  }, 180_000);
});

const BIG_ROW_BODY_BYTES = 64 * MIB;
const BIG_ROW_ITEMS = 100_000;

/** A ROW header of 100,000 blocks and 100,000 ids, about 4.3 MB, held by the test throughout. */
function bigRowHeader(): Uint8Array {
  return encodeRowHeader({
    label: 1n << 20n,
    owner: 0,
    speaker: 1,
    flags: 0,
    idsLen: 0,
    metaLen: 0,
    chronologySeq: 0n,
    chronologyUserTurn: 0,
    chronologyStep: 0,
    chronologyRecordedAt: 0,
    parentEndpoint: 0n,
    blocks: Array.from({ length: BIG_ROW_ITEMS }, (_, index) => ({
      offset: index,
      length: 1,
      type: 1,
    })),
    ids: Array.from({ length: BIG_ROW_ITEMS }, (_, index) => ({
      idHash: new Uint8Array(16).fill(index & 0xff),
      kind: ROW_ID_KIND.call,
      block: index,
      score: 0,
      nameLen: 4,
    })),
  });
}

describe('a 64 MiB body behind a 100,000-block, 100,000-id ROW header', () => {
  const tempDir = useTempDir('journal-bigrow-');

  async function writeRow(
    file: string,
    header: Uint8Array,
    probe: GrowthProbe,
    buffered: boolean,
  ): Promise<{ crc: number; bytes: number }> {
    const body = producedBody(BIG_ROW_BODY_BYTES, CHUNK_BYTES, probe, 8);
    const handle = await fs.open(file, 'w+');
    try {
      const sink = createFileHandleSink(handle, 0);
      if (buffered) {
        const gathered: Uint8Array[] = [];
        for await (const chunk of body.chunks) gathered.push(chunk);
        await writeFrame(sink, RECORD_KIND.ROW, header, {
          length: BIG_ROW_BODY_BYTES,
          chunks: [Buffer.concat(gathered)],
        });
      } else {
        await writeFrame(sink, RECORD_KIND.ROW, header, {
          length: BIG_ROW_BODY_BYTES,
          chunks: body.chunks,
        });
      }
      await probe.sample();
    } finally {
      await handle.close();
    }
    return body.produced();
  }

  it('streams the body with heap growth far below the body size', async () => {
    const header = bigRowHeader();
    const file = path.join(tempDir(), 'bigrow.llxj');
    const encodeProbe = await startGrowthProbe();
    const written = await writeRow(file, header, encodeProbe, false);

    const decodeProbe = await startGrowthProbe();
    const handle = await fs.open(file, 'r');
    let read: { crc: number; bytes: number };
    try {
      const { size } = await handle.stat();
      const reader = createFileHandleReader(handle);
      const head = await readFrameHead(reader, 0, size);
      expect(head.headerLen).toBe(header.length);
      expect(size).toBe(
        FRAME_HEAD_BYTES + header.length + BIG_ROW_BODY_BYTES + 4,
      );
      read = await streamingConsumer(reader, head, decodeProbe);
    } finally {
      await handle.close();
    }

    expect(read).toStrictEqual(written);
    expect(encodeProbe.peakGrowth()).toBeLessThan(STREAMING_GROWTH_BOUND);
    expect(decodeProbe.peakGrowth()).toBeLessThan(STREAMING_GROWTH_BOUND);
  }, 180_000);

  it('is caught when the encoder buffers the whole body', async () => {
    const header = bigRowHeader();
    const probe = await startGrowthProbe();

    await writeRow(path.join(tempDir(), 'trap.llxj'), header, probe, true);

    expect(probe.peakGrowth()).toBeGreaterThan(BIG_ROW_BODY_BYTES / 2);
    expect(probe.peakGrowth()).not.toBeLessThan(STREAMING_GROWTH_BOUND);
  }, 180_000);
});
