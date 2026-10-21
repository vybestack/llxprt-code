/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, stat } from 'node:fs/promises';
import type { O200kDiskSource } from '../tokenizers/o200k-disk-source.js';
import type {
  Gpt56SourceProjection,
  Gpt56SourceSegment,
} from '../tokenizers/gpt56-source-projection.js';
import {
  jsonValueByteLength,
  jsonValueBytes,
} from '../utils/progressive-json-body.js';
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

function segmentSource(
  segment: Gpt56SourceSegment,
  media: DiskBodyMedia,
): O200kDiskSource {
  const source = media === 'wire' ? segment.wireSource : segment.dumpSource;
  if (source === undefined)
    throw new Error(`Responses source segment has no ${media} bytes`);
  return source;
}

async function* segmentBytes(
  segment: Gpt56SourceSegment,
  media: DiskBodyMedia,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array, void> {
  signal?.throwIfAborted();
  const wire = segmentSource(segment, media);
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

/**
 * The request as an ordered list of pieces. The byte generator and the length
 * function both walk this one list, so the length cannot describe a different
 * body than the bytes.
 */
type RequestPart =
  | { readonly kind: 'literal'; readonly bytes: Uint8Array }
  | { readonly kind: 'member'; readonly key: string; readonly value: unknown };

type BodyPart =
  | { readonly kind: 'literal'; readonly bytes: Uint8Array }
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'segment'; readonly segment: Gpt56SourceSegment };

export function* responsesRequestParts(
  request: OpenAIResponsesRequest,
  signal?: AbortSignal,
): Generator<RequestPart, void> {
  let prefix = '{';
  for (const key of Object.keys(request)) {
    signal?.throwIfAborted();
    const value: unknown = Reflect.get(request, key);
    if (value === undefined) continue;
    yield {
      kind: 'literal',
      bytes: Buffer.from(`${prefix}${JSON.stringify(key)}:`),
    };
    yield { kind: 'member', key, value };
    prefix = ',';
  }
  yield { kind: 'literal', bytes: Buffer.from('}') };
}

function* parts(
  request: OpenAIResponsesRequest,
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
): Generator<BodyPart, void> {
  for (const part of responsesRequestParts(request, signal)) {
    if (part.kind === 'literal') yield part;
    else {
      const segment = projection.promptSegments.find(
        (entry) => entry.promptKey === part.key,
      );
      if (segment === undefined) yield { kind: 'value', value: part.value };
      else yield { kind: 'segment', segment };
    }
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
    for (const part of parts(request, projection, signal)) {
      if (part.kind === 'literal') yield part.bytes;
      else if (part.kind === 'value') yield* jsonValueBytes(part.value);
      else yield* segmentBytes(part.segment, media, signal);
    }
  } finally {
    await release();
  }
}

/**
 * UTF-8 segments are stored as the wire bytes, so their file size is their
 * length. A raw string is stored as UTF-16 and escaped as it is read, so its
 * length is counted by running that same read over the (small) file.
 */
async function segmentLength(
  segment: Gpt56SourceSegment,
  media: DiskBodyMedia,
  signal?: AbortSignal,
): Promise<number> {
  const source = segmentSource(segment, media);
  if (source.encoding !== 'utf16le') return (await stat(source.path)).size;
  let length = 0;
  for await (const bytes of segmentBytes(segment, media, signal))
    length += bytes.byteLength;
  return length;
}

/** The byte length `diskResponsesBodyBytes` yields for the same arguments. */
export async function diskResponsesBodyLength(
  request: OpenAIResponsesRequest,
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
  media: DiskBodyMedia = 'wire',
): Promise<number> {
  const release = projection.acquire();
  try {
    let length = 0;
    for (const part of parts(request, projection, signal)) {
      if (part.kind === 'literal') length += part.bytes.byteLength;
      else if (part.kind === 'value') length += jsonValueByteLength(part.value);
      else length += await segmentLength(part.segment, media, signal);
    }
    return length;
  } finally {
    await release();
  }
}
