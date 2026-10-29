/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { NeutralMergeQueue } from './neutral-merge-queue.js';

export type LongTextCounter = (
  text: string,
  countShort: (text: string) => number,
  unitCache?: Map<string, number>,
) => number;

function countShortBatches(
  value: string,
  pieces: RegExp,
  countShort: (text: string) => number,
  cache: Map<string, number>,
): number {
  const matcher = new RegExp(pieces);
  const measure = (start: number, end: number): number => {
    const batch = value.slice(start, end);
    let measured = cache.get(batch);
    if (measured === undefined) {
      measured = countShort(batch);
      if (cache.size < 256) cache.set(batch, measured);
    }
    return measured;
  };
  let tokens = 0;
  let start = 0;
  let position = 0;
  for (
    let match = matcher.exec(value);
    match !== null;
    match = matcher.exec(value)
  ) {
    // Exact codec boundaries let short words share a bounded encoder call.
    if (matcher.lastIndex - start > 512 && match.index > start) {
      tokens += measure(start, match.index);
      start = match.index;
    }
    position = matcher.lastIndex;
  }
  if (position !== value.length)
    throw new Error('Tokenizer pattern did not cover short input');
  if (start < value.length) tokens += measure(start, value.length);
  return tokens;
}

/** Reuse the exact rank-ordered merge algorithm with each codec's own assets. */
export function createLongTextCounter(
  bpeRanks: string,
  patStr: string,
  loadRanks: () => ReadonlyMap<string, number> = () => parseRanks(bpeRanks),
): LongTextCounter {
  const pattern = patStr
    .replaceAll('\\s', '\\p{White_Space}')
    .replaceAll('\\S', '\\P{White_Space}')
    .replaceAll('\\p{Han}', '\\p{Script=Han}')
    .replaceAll(
      "(?i:'s|'t|'re|'ve|'m|'ll|'d)",
      "(?:'[sStTmMdD]|'[rR][eE]|'[vV][eE]|'[lL][lL])",
    );
  const pieces = new RegExp(pattern, pattern.includes('&&') ? 'vy' : 'uy');
  let ranks: ReadonlyMap<string, number> | undefined;
  return (text, countShort, unitCache) => {
    const counted = (value: string, measure: () => number): number => {
      const cached = unitCache?.get(value);
      if (cached !== undefined) return cached;
      const tokens = measure();
      unitCache?.set(value, tokens);
      return tokens;
    };
    const shortPieces = new Map<string, number>();
    const short = (value: string): number =>
      counted(value, () => {
        if (unitCache === undefined) return countShort(value);
        return countShortBatches(value, pieces, countShort, shortPieces);
      });
    if (text.length <= 512) return short(text);
    const matcher = new RegExp(pieces);
    let count = 0;
    let start = 0;
    let position = 0;
    for (
      let match = matcher.exec(text);
      match !== null;
      match = matcher.exec(text)
    ) {
      position = matcher.lastIndex;
      // Quote-containing pieces delimit JSON string values. Splitting only at
      // these exact codec boundaries makes repeated unit payloads reusable.
      if (
        match[0].length > 512 ||
        (unitCache !== undefined && match[0].includes('"'))
      ) {
        if (match.index > start) count += short(text.slice(start, match.index));
        const piece = match[0];
        count += counted(piece, () => {
          if (piece.length <= 512) return countShort(piece);
          ranks ??= loadRanks();
          return countBpePiece(Buffer.from(piece), ranks);
        });
        start = position;
      }
    }
    if (position !== text.length)
      throw new Error('Tokenizer pattern did not cover input');
    return start < text.length ? count + short(text.slice(start)) : count;
  };
}

function parseRanks(bpeRanks: string): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const fields = bpeRanks.trim().split(/\s+/);
  const compact = fields[0] === '!' && fields[1] === '0';
  for (
    let index = compact ? 2 : 0;
    index < fields.length;
    index += compact ? 1 : 2
  )
    result.set(
      Buffer.from(fields[index], 'base64').toString('latin1'),
      compact ? index - 2 : Number(fields[index + 1]),
    );
  return result;
}

const encodingRanks = new Map<string, ReadonlyMap<string, number>>();
export function encodingBpeRanks(
  encoding: string,
): ReadonlyMap<string, number> {
  const cached = encodingRanks.get(encoding);
  if (cached !== undefined) return cached;
  const path = createRequire(import.meta.url).resolve(
    `@dqbd/tiktoken/encoders/${encoding}.json`,
  );
  const vocabulary = z
    .object({ bpe_ranks: z.string() })
    .parse(JSON.parse(readFileSync(path, 'utf8')));
  const ranks = parseRanks(vocabulary.bpe_ranks);
  encodingRanks.set(encoding, ranks);
  return ranks;
}

const encodings = new Map<string, LongTextCounter>();
export function encodingLongTextCounter(encoding: string): LongTextCounter {
  const cached = encodings.get(encoding);
  if (cached !== undefined) return cached;
  const path = createRequire(import.meta.url).resolve(
    `@dqbd/tiktoken/encoders/${encoding}.json`,
  );
  const vocabulary = z
    .object({ bpe_ranks: z.string(), pat_str: z.string() })
    .parse(JSON.parse(readFileSync(path, 'utf8')));
  const counter = createLongTextCounter(
    vocabulary.bpe_ranks,
    vocabulary.pat_str,
    () => encodingBpeRanks(encoding),
  );
  encodings.set(encoding, counter);
  return counter;
}

export function countBpePiece(
  input: Buffer,
  dictionary: ReadonlyMap<string, number>,
  visit?: (start: number, end: number) => void,
): number {
  const bytes = input.toString('latin1');
  if (dictionary.has(bytes)) {
    visit?.(0, bytes.length);
    return 1;
  }
  const next = new Int32Array(bytes.length + 1);
  const previous = new Int32Array(bytes.length + 1);
  const symbols = new Uint32Array(bytes.length);
  const pairs = new Map<number, number>();
  const pending = new NeutralMergeQueue();
  const pairRank = (at: number): number | undefined => {
    const right = next[at];
    if (right >= bytes.length) return undefined;
    const key = symbols[at] * 0x1_0000_0000 + symbols[right];
    const cached = pairs.get(key);
    if (cached !== undefined) return cached < 0 ? undefined : cached;
    const rank = dictionary.get(bytes.slice(at, next[right]));
    // Token identities make repeated pairs reusable without retaining text.
    if (pairs.size < 256) pairs.set(key, rank ?? -1);
    return rank;
  };
  const enqueue = (at: number): void => {
    const rank = pairRank(at);
    if (rank !== undefined) pending.add(rank, at);
  };
  for (let at = 0; at <= bytes.length; at++) {
    next[at] = at + 1;
    previous[at] = at - 1;
  }
  for (let at = 0; at < bytes.length; at++) symbols[at] = input[at];
  for (let at = 0; at < bytes.length - 1; at++) enqueue(at);
  let count = bytes.length;
  // Only the two neighbours of a merge change. Each queued event and lookup
  // has fixed-width work, bounded by the vocabulary's maximum token length.
  for (let key = pending.take(); key !== undefined; key = pending.take()) {
    const rank = Math.floor(key / 0x1_0000_0000);
    const at = key % 0x1_0000_0000;
    if (next[at] < 0 || pairRank(at) !== rank) continue;
    const removed = next[at];
    const after = next[removed];
    next[at] = after;
    previous[after] = at;
    symbols[at] = rank + 256;
    next[removed] = -1;
    count--;
    if (previous[at] >= 0) enqueue(previous[at]);
    enqueue(at);
  }
  if (visit !== undefined)
    for (let at = 0; at < bytes.length; at = next[at]) visit(at, next[at]);
  return count;
}

export function countLongNeutralText(
  text: string,
  countShort: (text: string) => number,
): number {
  return encodingLongTextCounter('o200k_base')(text, countShort);
}
