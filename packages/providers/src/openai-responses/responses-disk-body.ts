/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import type {
  Gpt56SourceProjection,
  Gpt56SourceSegment,
} from '../tokenizers/gpt56-source-projection.js';
import { jsonValueBytes } from '../utils/progressive-json-body.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

function utf16Chunk(
  carry: string,
  buffer: Buffer,
  bytesRead: number,
): { carry: string; bytes: Buffer } {
  const text = carry + buffer.toString('utf16le', 0, bytesRead);
  const last = text.charCodeAt(text.length - 1);
  const tail = last >= 0xd800 && last <= 0xdbff ? text.slice(-1) : '';
  const value = tail === '' ? text : text.slice(0, -1);
  return {
    carry: tail,
    bytes: Buffer.from(JSON.stringify(value).slice(1, -1)),
  };
}

/** `wire` carries media bytes for transport; `dump` is the diagnostic form. */
export type DiskBodyMedia = 'wire' | 'dump';

async function* segmentBytes(
  segment: Gpt56SourceSegment,
  media: DiskBodyMedia,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array, void> {
  signal?.throwIfAborted();
  const wire = media === 'wire' ? segment.wireSource : segment.dumpSource;
  if (wire === undefined)
    throw new Error(`Responses source segment has no ${media} bytes`);
  const reader = await open(wire.path, 'r');
  try {
    const string = wire.encoding === 'utf16le';
    if (string) yield Buffer.from('"');
    let carry = '';
    for (;;) {
      signal?.throwIfAborted();
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await reader.read(buffer);
      if (bytesRead === 0) break;
      if (!string) yield buffer.subarray(0, bytesRead);
      else {
        const encoded = utf16Chunk(carry, buffer, bytesRead);
        carry = encoded.carry;
        yield encoded.bytes;
      }
    }
    if (string) yield Buffer.from(`${JSON.stringify(carry).slice(1, -1)}"`);
  } finally {
    await reader.close();
  }
}

export async function* diskResponsesBodyBytes(
  request: OpenAIResponsesRequest,
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
  media: DiskBodyMedia = 'wire',
): AsyncGenerator<Uint8Array, void> {
  const release = projection.acquire();
  try {
    let prefix = '{';
    for (const key of Object.keys(request)) {
      signal?.throwIfAborted();
      const value: unknown = Reflect.get(request, key);
      if (value === undefined) continue;
      yield Buffer.from(`${prefix}${JSON.stringify(key)}:`);
      const segment = projection.promptSegments.find(
        (entry) => entry.promptKey === key,
      );
      if (segment === undefined) yield* jsonValueBytes(value);
      else yield* segmentBytes(segment, media, signal);
      prefix = ',';
    }
    yield Buffer.from('}');
  } finally {
    await release();
  }
}
