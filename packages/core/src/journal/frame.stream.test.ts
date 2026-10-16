/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { crc32 } from 'node:zlib';
import {
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
      16 + KIND_HEADER.length + BODY_BYTES + 4,
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
