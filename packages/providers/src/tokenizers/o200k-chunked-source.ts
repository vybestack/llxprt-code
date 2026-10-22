/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { countPiece } from './o200k-disk-bpe.js';
import { countPieceInMemory, MAX_HEAP_PIECE_BYTES } from './o200k-heap-bpe.js';
import { checkpoint } from './o200k-disk-io.js';
import {
  countO200kBaseTokens,
  type O200kBaseEncoder,
} from './o200kBaseCounter.js';
import {
  countO200kBaseTokensFromDiskSource,
  type O200kDiskCountOptions,
  type O200kDiskSource,
} from './o200k-disk-source.js';

const SPACE = '\\p{White_Space}';
const UPPER = '\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}';
const LOWER = '\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}';
// (?i:'s|'t|'re|'ve|'m|'ll|'d) spelled out: the only non-ASCII case fold of
// these letters is U+017F for "s".
const CONTRACTION =
  "(?:'[sS\\u017F]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])?";

/**
 * The pinned o200k_base pre-tokenizer pattern. BPE never merges across the
 * pieces it produces, so a text cut only at piece boundaries counts to the
 * sum of its parts.
 */
const O200K_PIECES_SOURCE = [
  `[^\\r\\n\\p{L}\\p{N}]?[${UPPER}]*[${LOWER}]+${CONTRACTION}`,
  `[^\\r\\n\\p{L}\\p{N}]?[${UPPER}]+[${LOWER}]*${CONTRACTION}`,
  '\\p{N}{1,3}',
  ` ?[^${SPACE}\\p{L}\\p{N}]+[\\r\\n/]*`,
  `${SPACE}*[\\r\\n]+`,
  `${SPACE}+(?![^${SPACE}])`,
  `${SPACE}+`,
].join('|');
const O200K_PIECES_FLAGS = 'gu';

/** Characters after a match end that can still change where it ends. */
const LOOKAHEAD = 8;

export interface ChunkedCountTuning {
  /** Text batched per WASM call; cut only at piece boundaries. */
  readonly chunkChars: number;
  /** Largest single piece the WASM encoder takes (it is quadratic per piece). */
  readonly wasmPieceChars: number;
  /**
   * Largest piece (in UTF-8 bytes) beyond the WASM bound that is counted by
   * the in-memory heap BPE, scratch memory proportional to the piece and
   * released with the call. Larger pieces go to the disk BPE.
   */
  readonly heapPieceBytes: number;
  /** Largest undecided tail kept in memory before the disk counter takes over. */
  readonly pendingChars: number;
  readonly blockBytes: number;
}

export const DEFAULT_CHUNKED_TUNING: ChunkedCountTuning = Object.freeze({
  chunkChars: 64 * 1024,
  wasmPieceChars: 16 * 1024,
  heapPieceBytes: 256 * 1024,
  pendingChars: 1024 * 1024,
  blockBytes: 64 * 1024,
});

class PendingOverflow extends Error {}

class ChunkedCounter {
  count = 0;
  #chunk: string[] = [];
  #chunkChars = 0;
  #fallbackDirectory: string | undefined;
  #fallbackIndex = 0;
  readonly #pieces = new RegExp(O200K_PIECES_SOURCE, O200K_PIECES_FLAGS);

  constructor(
    private readonly encoder: O200kBaseEncoder,
    private readonly options: O200kDiskCountOptions,
    private readonly tuning: ChunkedCountTuning,
    private readonly diskAllowed = true,
  ) {}

  /**
   * Counts the whole pieces of `text`, returning the length consumed. The
   * pieces tile the text, so the small ones between two cuts are taken as one
   * slice instead of one substring each, and only a full chunk or an oversized
   * piece waits on anything.
   */
  async consume(text: string, final: boolean): Promise<number> {
    const limit = final ? text.length : text.length - LOOKAHEAD;
    this.#pieces.lastIndex = 0;
    let position = 0;
    let runStart = 0;
    let match = this.#pieces.exec(text);
    while (match) {
      const end = this.#pieces.lastIndex;
      if (end > limit) break;
      if (match.index !== position || end === position)
        throw new Error(
          `Pinned regex failed to cover source offset ${position}`,
        );
      if (end - position > this.tuning.wasmPieceChars) {
        this.#take(text, runStart, position);
        await this.#countLargePiece(text.slice(position, end));
        runStart = end;
      } else if (this.#chunkChars + end - runStart >= this.tuning.chunkChars) {
        this.#take(text, runStart, end);
        runStart = end;
        this.#flush();
        await checkpoint(this.options.signal);
      }
      position = end;
      match = position < text.length ? this.#pieces.exec(text) : null;
    }
    this.#take(text, runStart, position);
    if (final && position !== text.length)
      throw new Error('Pinned regex did not consume the final source text');
    return position;
  }

  async finish(): Promise<number> {
    this.#flush();
    try {
      return this.count;
    } finally {
      if (this.#fallbackDirectory !== undefined)
        await rm(this.#fallbackDirectory, { recursive: true, force: true });
    }
  }

  async dispose(): Promise<void> {
    if (this.#fallbackDirectory !== undefined)
      await rm(this.#fallbackDirectory, { recursive: true, force: true });
  }

  /** Adds `text[from, to)`, whole pieces, to the pending chunk. */
  #take(text: string, from: number, to: number): void {
    if (to === from) return;
    this.#chunk.push(text.slice(from, to));
    this.#chunkChars += to - from;
  }

  #flush(): void {
    if (this.#chunk.length === 0) return;
    this.count += countO200kBaseTokens(this.encoder, this.#chunk.join(''));
    this.#chunk = [];
    this.#chunkChars = 0;
  }

  async #countLargePiece(piece: string): Promise<void> {
    const bytes = Buffer.from(piece);
    if (!this.diskAllowed || bytes.length <= this.tuning.heapPieceBytes) {
      this.count +=
        bytes.length <= MAX_HEAP_PIECE_BYTES
          ? countPieceInMemory(bytes)
          : countO200kBaseTokens(this.encoder, piece);
      await checkpoint(this.options.signal);
      return;
    }
    await this.#countOnDisk(bytes);
  }

  async #countOnDisk(bytes: Buffer): Promise<void> {
    this.#fallbackDirectory ??= await mkdtemp(
      join(this.options.workspaceDirectory, 'o200k-piece-'),
    );
    const path = join(
      this.#fallbackDirectory,
      `piece-${this.#fallbackIndex++}`,
    );
    await writeFile(path, bytes);
    this.count += await countPiece(
      path,
      this.#fallbackDirectory,
      0,
      bytes.length,
      this.options.signal,
    );
    await rm(path, { force: true });
  }
}

async function streamCount(
  source: O200kDiskSource,
  counter: ChunkedCounter,
  tuning: ChunkedCountTuning,
  signal?: AbortSignal,
): Promise<void> {
  const decoder = new TextDecoder(
    source.encoding === 'utf16le' ? 'utf-16le' : 'utf-8',
    { ignoreBOM: true },
  );
  const handle = await open(source.path, 'r');
  try {
    const block = Buffer.alloc(tuning.blockBytes);
    let pending = '';
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(block, 0, block.length, null);
      const final = bytesRead === 0;
      pending += final
        ? decoder.decode()
        : decoder.decode(block.subarray(0, bytesRead), { stream: true });
      pending = pending.slice(await counter.consume(pending, final));
      if (final) return;
      if (pending.length > tuning.pendingChars) throw new PendingOverflow();
    }
  } finally {
    await handle.close();
  }
}

/**
 * Exact o200k_base count of a disk source: streams the text, splits it with
 * the pinned pre-tokenizer, and encodes bounded batches of whole pieces with
 * the in-memory WASM encoder. A single piece the WASM encoder handles
 * quadratically is counted by the in-memory heap BPE, or by the disk BPE beyond
 * its bound, as is an undecided tail beyond the memory bound. All are exact.
 */
export async function countO200kBaseTokensChunked(
  source: O200kDiskSource,
  encoder: O200kBaseEncoder,
  options: O200kDiskCountOptions,
  tuning: ChunkedCountTuning = DEFAULT_CHUNKED_TUNING,
): Promise<number> {
  options.signal?.throwIfAborted();
  const counter = new ChunkedCounter(encoder, options, tuning);
  try {
    await streamCount(source, counter, tuning, options.signal);
    const count = await counter.finish();
    if (!Number.isSafeInteger(count))
      throw new RangeError('Token count exceeds JavaScript integer precision');
    return count;
  } catch (error) {
    await counter.dispose();
    if (error instanceof PendingOverflow)
      return countO200kBaseTokensFromDiskSource(source, options);
    throw error;
  }
}

export async function countO200kBaseTokensFromChunks(
  chunks: AsyncIterable<string>,
  encoder: O200kBaseEncoder,
  signal?: AbortSignal,
): Promise<number> {
  const counter = new ChunkedCounter(
    encoder,
    { workspaceDirectory: '', signal },
    DEFAULT_CHUNKED_TUNING,
    false,
  );
  let pending = '';
  try {
    for await (const chunk of chunks) {
      signal?.throwIfAborted();
      pending += chunk;
      pending = pending.slice(await counter.consume(pending, false));
    }
    await counter.consume(pending, true);
    const count = await counter.finish();
    if (!Number.isSafeInteger(count))
      throw new RangeError('Token count exceeds JavaScript integer precision');
    return count;
  } finally {
    await counter.dispose();
  }
}
