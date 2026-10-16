/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ByteSink, PositionalReader } from '../../positionalFile.js';

/** A positional reader over an in-memory byte array. */
export function bufferReader(bytes: Uint8Array): PositionalReader {
  return {
    readAt(position: number, length: number): Promise<Uint8Array> {
      if (position + length > bytes.length) {
        return Promise.reject(
          new Error(
            `read of ${length} bytes at ${position} past end ${bytes.length}`,
          ),
        );
      }
      return Promise.resolve(bytes.slice(position, position + length));
    },
  };
}

/** A sink that keeps everything it is given. Only for small test payloads. */
export function collectingSink(): {
  sink: ByteSink;
  bytes: () => Uint8Array;
} {
  const chunks: Uint8Array[] = [];
  return {
    sink: (chunk) => {
      chunks.push(chunk.slice());
      return Promise.resolve();
    },
    bytes: () => Buffer.concat(chunks),
  };
}

/** Concatenate an async stream of chunks. Only for small test payloads. */
export async function collect(
  stream: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Split `bytes` into chunks of the given sizes, the last size repeating. */
export function* splitInto(
  bytes: Uint8Array,
  sizes: readonly number[],
): Generator<Uint8Array> {
  let position = 0;
  let index = 0;
  while (position < bytes.length) {
    const size = sizes[Math.min(index, sizes.length - 1)];
    yield bytes.subarray(position, position + size);
    position += size;
    index += 1;
  }
}
