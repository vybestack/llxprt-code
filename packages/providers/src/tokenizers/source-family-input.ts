/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ImageTokenEstimateInput } from '@vybestack/llxprt-code-tools/utils/imageTokenEstimation.js';
import type {
  Gpt56SourceLease,
  Gpt56SourceProjection,
  Gpt56SourceSegment,
} from './gpt56-source-projection.js';

const BLOCK_BYTES = 64 * 1024;

/**
 * What a non-o200k family estimator receives instead of a materialized
 * prompt: the sealed segments plus the scoped lease that keeps them alive.
 * Families read it a block at a time; none of them is handed the joined
 * prompt text unless its tokenizer cannot count anything smaller.
 */
export class SourceFamilyInput {
  readonly kind = 'llxprt-source-family-input-v1';

  constructor(
    readonly projection: Gpt56SourceProjection,
    private readonly lease: Gpt56SourceLease,
    readonly workspaceDirectory: string,
    readonly signal?: AbortSignal,
  ) {}

  countImageTokens(input: ImageTokenEstimateInput): Promise<number> {
    return this.lease.countImageTokens(input, this.signal);
  }
}

/**
 * Decoded text of one segment file in bounded blocks. The decoder carries a
 * trailing partial character (or high surrogate) into the next block, so no
 * character is ever split between two yielded chunks.
 */
export async function* segmentChunks(
  segment: Gpt56SourceSegment,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const decoder = new StringDecoder(segment.source.encoding ?? 'utf8');
  const handle = await open(segment.source.path, 'r');
  try {
    const block = Buffer.alloc(BLOCK_BYTES);
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(block, 0, block.length, null);
      if (bytesRead === 0) break;
      const text = decoder.write(block.subarray(0, bytesRead));
      if (text !== '') yield text;
    }
    const tail = decoder.end();
    if (tail !== '') yield tail;
  } finally {
    await handle.close();
  }
}

/** One whole segment, for tokenizers whose unit of counting is a segment. */
export async function readSegmentText(
  segment: Gpt56SourceSegment,
  signal?: AbortSignal,
): Promise<string> {
  let text = '';
  for await (const chunk of segmentChunks(segment, signal)) text += chunk;
  return text;
}

/**
 * The legacy JSON prompt text as ordered pieces: `{"key":<segment>,...}`,
 * where a raw-string segment is JSON-encoded. A piece never splits a code
 * point, so any per-piece code point scan equals the scan of the whole.
 */
export async function* promptTextPieces(
  projection: Gpt56SourceProjection,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let first = true;
  for (const segment of projection.promptSegments) {
    yield `${first ? '{' : ','}${JSON.stringify(segment.promptKey)}:`;
    first = false;
    if (segment.rawString === true) {
      yield '"';
      for await (const chunk of segmentChunks(segment, signal))
        yield JSON.stringify(chunk).slice(1, -1);
      yield '"';
    } else {
      yield* segmentChunks(segment, signal);
    }
  }
  if (!first) yield '}';
}

/**
 * Writes the prompt text pieces to a scratch file and returns its path, with
 * every piece also offered to `observe` so a family can accumulate additive
 * content signals in the same pass. The caller removes `directory`.
 */
export async function spoolPromptText(
  input: SourceFamilyInput,
  observe: (piece: string) => void,
): Promise<{ readonly directory: string; readonly path: string }> {
  const directory = await mkdtemp(
    join(input.workspaceDirectory, 'family-prompt-'),
  );
  try {
    const path = join(directory, 'prompt.txt');
    const handle = await open(path, 'w');
    try {
      for await (const piece of promptTextPieces(
        input.projection,
        input.signal,
      )) {
        observe(piece);
        await handle.write(piece);
      }
    } finally {
      await handle.close();
    }
    return { directory, path };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The complete prompt text as one string. Only for estimators whose counter is
 * a whole-string function with no known piece boundary (the legacy heuristic).
 * The string is request-local to the estimate that asked for it.
 */
export async function wholePromptText(
  input: SourceFamilyInput,
): Promise<string> {
  let text = '';
  for await (const piece of promptTextPieces(input.projection, input.signal))
    text += piece;
  return text;
}
