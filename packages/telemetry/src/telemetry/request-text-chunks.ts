/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { RequestArtifactDescriptor } from './request-artifact.js';

export const REQUEST_TEXT_CHUNK_BYTES = 16384;

async function* encodedPrefix(
  file: FileHandle,
  source: RequestArtifactDescriptor,
  cap: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const input = Buffer.alloc(REQUEST_TEXT_CHUNK_BYTES);
  const decoder = new StringDecoder('utf8');
  const hash = createHash('sha256');
  let offset = 0;
  let chars = 0;
  yield Buffer.from('"');
  const encode = function* (text: string): Generator<Buffer> {
    const visible = text.slice(0, Math.max(0, cap - chars));
    chars += text.length;
    for (let start = 0; start < visible.length; ) {
      let end = Math.min(start + 1024, visible.length);
      const last = visible.charCodeAt(end - 1);
      if (end < visible.length && last >= 0xd800 && last <= 0xdbff) end--;
      const json = JSON.stringify(visible.slice(start, end));
      yield Buffer.from(json.slice(1, -1));
      start = end;
    }
  };
  while (offset < source.content_bytes) {
    signal?.throwIfAborted();
    const { bytesRead } = await file.read(
      input,
      0,
      Math.min(input.length, source.content_bytes - offset),
      source.content_offset + offset,
    );
    if (bytesRead === 0) throw new Error('Truncated request artifact');
    const bytes = input.subarray(0, bytesRead);
    hash.update(bytes);
    yield* encode(decoder.write(bytes));
    offset += bytesRead;
  }
  yield* encode(decoder.end());
  signal?.throwIfAborted();
  if (hash.digest('hex') !== source.content_sha256)
    throw new Error('Request artifact digest mismatch');
  if (chars !== source.content_chars)
    throw new Error('Request artifact character count mismatch');
  yield Buffer.from('"');
}

export async function* requestTextChunks(
  file: FileHandle,
  source: RequestArtifactDescriptor,
  cap: number,
  signal?: AbortSignal,
): AsyncGenerator<Buffer> {
  const output = Buffer.alloc(REQUEST_TEXT_CHUNK_BYTES);
  let used = 0;
  for await (const piece of encodedPrefix(file, source, cap, signal)) {
    let offset = 0;
    while (offset < piece.length) {
      const count = Math.min(output.length - used, piece.length - offset);
      piece.copy(output, used, offset, offset + count);
      used += count;
      offset += count;
      if (used === output.length) {
        yield output;
        used = 0;
      }
    }
  }
  if (used !== 0) yield output.subarray(0, used);
}

export async function requestTextDimensions(
  file: FileHandle,
  source: RequestArtifactDescriptor,
  cap: number,
  signal?: AbortSignal,
): Promise<{ visible_bytes: number; visible_sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of requestTextChunks(file, source, cap, signal)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { visible_bytes: bytes, visible_sha256: hash.digest('hex') };
}
