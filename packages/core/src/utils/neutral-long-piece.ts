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

/** Reuse the exact rank-ordered merge algorithm with each codec's own assets. */
export function createLongTextCounter(
  bpeRanks: string,
  patStr: string,
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
        const matcher = new RegExp(pieces);
        let tokens = 0;
        let position = 0;
        for (
          let match = matcher.exec(value);
          match !== null;
          match = matcher.exec(value)
        ) {
          const piece = match[0];
          let measured = shortPieces.get(piece);
          if (measured === undefined) {
            measured = countShort(piece);
            // Bound auxiliary entries even for a row of entirely unique words.
            if (shortPieces.size < 256) shortPieces.set(piece, measured);
          }
          tokens += measured;
          position = matcher.lastIndex;
        }
        if (position !== value.length)
          throw new Error('Tokenizer pattern did not cover short input');
        return tokens;
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
          ranks ??= parseRanks(bpeRanks);
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
  );
  encodings.set(encoding, counter);
  return counter;
}

export function countBpePiece(
  input: Buffer,
  dictionary: ReadonlyMap<string, number>,
): number {
  const bytes = input.toString('latin1');
  if (dictionary.has(bytes)) return 1;
  const next = new Int32Array(bytes.length + 1);
  const previous = new Int32Array(bytes.length + 1);
  const pending = new NeutralMergeQueue();
  const pairRank = (at: number): number | undefined => {
    const right = next[at];
    return right >= bytes.length
      ? undefined
      : dictionary.get(bytes.slice(at, next[right]));
  };
  const enqueue = (at: number): void => {
    const rank = pairRank(at);
    if (rank !== undefined) pending.add(rank, at);
  };
  for (let at = 0; at <= bytes.length; at++) {
    next[at] = at + 1;
    previous[at] = at - 1;
  }
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
    next[removed] = -1;
    count--;
    if (previous[at] >= 0) enqueue(previous[at]);
    enqueue(at);
  }
  return count;
}

export function countLongNeutralText(
  text: string,
  countShort: (text: string) => number,
): number {
  return encodingLongTextCounter('o200k_base')(text, countShort);
}
