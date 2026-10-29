/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { requireBudget } from './body-evidence-budget.js';

export type BodyInput = string | Uint8Array | AsyncIterable<Uint8Array>;
export interface StreamStats {
  rawBytes: number;
  rawSha256: string | null;
  rawComplete: boolean;
  compressedBytes: number;
  compressedSha256: string | null;
}

export function* stringBytes(text: string): Generator<Uint8Array> {
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + 8192, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield Buffer.from(text.slice(start, end));
    start = end;
  }
}

async function* inputBytes(input: BodyInput): AsyncGenerator<Uint8Array> {
  if (typeof input === 'string') {
    yield* stringBytes(input);
    return;
  }
  if (input instanceof Uint8Array) {
    for (let i = 0; i < input.length; i += 16384)
      yield input.subarray(i, i + 16384);
    return;
  }
  for await (const chunk of input) {
    if (!(chunk instanceof Uint8Array))
      throw new Error('Invalid BODY byte chunk');
    for (let i = 0; i < chunk.length; i += 16384)
      yield chunk.subarray(i, i + 16384);
  }
}

export function initialStats(input: BodyInput): StreamStats {
  const stats: StreamStats = {
    rawBytes: 0,
    rawSha256: null,
    rawComplete: false,
    compressedBytes: 0,
    compressedSha256: null,
  };
  if (typeof input === 'string' || input instanceof Uint8Array) {
    const hash = createHash('sha256');
    const chunks = typeof input === 'string' ? stringBytes(input) : [input];
    for (const chunk of chunks) {
      stats.rawBytes += chunk.length;
      hash.update(chunk);
    }
    stats.rawSha256 = hash.digest('hex');
    stats.rawComplete = true;
  }
  return stats;
}

function writeAll(fd: number, chunk: Uint8Array): void {
  for (let offset = 0; offset < chunk.length; ) {
    const count = writeSync(fd, chunk, offset, chunk.length - offset);
    if (count <= 0) throw new Error('Incomplete compressed write');
    offset += count;
  }
}

export async function streamBody(
  root: string,
  path: string,
  input: BodyInput,
  stats: StreamStats,
  signal?: AbortSignal,
): Promise<void> {
  const raw = createHash('sha256');
  const compressed = createHash('sha256');
  let rawBytes = 0;
  let complete = false;
  const fd = openSync(path, 'wx');
  const tee = new Transform({
    highWaterMark: 16384,
    transform(chunk: Buffer, _encoding, callback) {
      rawBytes += chunk.length;
      raw.update(chunk);
      callback(null, chunk);
    },
  });
  const sink = new Writable({
    highWaterMark: 16384,
    write(chunk: Buffer, _encoding, callback) {
      try {
        requireBudget(root, chunk.length);
        writeAll(fd, chunk);
        stats.compressedBytes += chunk.length;
        compressed.update(chunk);
        callback();
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
  });
  try {
    await pipeline(
      Readable.from(inputBytes(input), {
        objectMode: false,
        highWaterMark: 16384,
      }),
      tee,
      createGzip({ chunkSize: 16384 }),
      sink,
      { signal },
    );
    fsyncSync(fd);
    complete = true;
  } finally {
    closeSync(fd);
    stats.compressedSha256 = compressed.digest('hex');
    if (!stats.rawComplete) {
      stats.rawBytes = rawBytes;
      stats.rawSha256 = raw.digest('hex');
      stats.rawComplete = complete;
    }
  }
}
