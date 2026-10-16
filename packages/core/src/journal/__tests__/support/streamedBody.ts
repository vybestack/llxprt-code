/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { crc32 } from 'node:zlib';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

export const MIB = 1024 * 1024;

/** Heap growth observed at settled sample points while a stream runs. */
export interface GrowthProbe {
  /** Settles the heap and records the growth over the baseline taken at start. */
  sample: () => Promise<void>;
  peakGrowth: () => number;
}

export async function startGrowthProbe(): Promise<GrowthProbe> {
  const baseline = await settledHeap();
  let peak = 0;
  return {
    sample: async () => {
      peak = Math.max(peak, (await settledHeap()) - baseline);
    },
    peakGrowth: () => peak,
  };
}

export interface ProducedBody {
  chunks: AsyncGenerator<Uint8Array>;
  /** CRC-32 and byte count of everything produced so far. */
  produced: () => { crc: number; bytes: number };
}

/**
 * A body of `totalBytes` made of fresh `chunkBytes` buffers (never a reused
 * one, so a consumer that retains chunks really holds the whole body). The
 * probe is sampled every `sampleEvery` chunks.
 */
export function producedBody(
  totalBytes: number,
  chunkBytes: number,
  probe: GrowthProbe,
  sampleEvery: number,
): ProducedBody {
  let crc = 0;
  let bytes = 0;
  async function* generate(): AsyncGenerator<Uint8Array> {
    for (let index = 0; bytes < totalBytes; index++) {
      const size = Math.min(chunkBytes, totalBytes - bytes);
      const chunk = new Uint8Array(size);
      chunk.fill((index * 7 + 1) & 0xff);
      new DataView(chunk.buffer).setUint32(0, index, true);
      crc = crc32(chunk, crc);
      bytes += size;
      if (index % sampleEvery === 0) await probe.sample();
      yield chunk;
    }
  }
  return { chunks: generate(), produced: () => ({ crc, bytes }) };
}
