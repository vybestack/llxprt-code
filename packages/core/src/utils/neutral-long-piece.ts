/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { NeutralMergeQueue } from './neutral-merge-queue.js';

let ranks: ReadonlyMap<string, number> | undefined;
let pieces: RegExp | undefined;
function tokenRanks(): ReadonlyMap<string, number> {
  if (ranks !== undefined) return ranks;
  const path = createRequire(import.meta.url).resolve(
    '@dqbd/tiktoken/encoders/o200k_base.json',
  );
  const vocabulary = z
    .object({ bpe_ranks: z.string(), pat_str: z.string() })
    .parse(JSON.parse(readFileSync(path, 'utf8')));
  // Sticky matching never retries at later positions. Each alternative either
  // consumes its run or the next alternative consumes the run it inspected.
  // Rust whitespace differs from JavaScript's, and JS lacks inline flags.
  const pattern = vocabulary.pat_str
    .replaceAll('\\s', '\\p{White_Space}')
    .replaceAll('\\S', '\\P{White_Space}')
    .replaceAll(
      "(?i:'s|'t|'re|'ve|'m|'ll|'d)",
      "(?:'[sStTmMdD]|'[rR][eE]|'[vV][eE]|'[lL][lL])",
    );
  pieces = new RegExp(pattern, 'uy');
  const result = new Map<string, number>();
  const fields = vocabulary.bpe_ranks.split(' ');
  if (fields[0] !== '!' || fields[1] !== '0')
    throw new Error('Unrecognized neutral tokenizer ranks');
  for (let index = 2; index < fields.length; index++)
    result.set(
      Buffer.from(fields[index], 'base64').toString('latin1'),
      index - 2,
    );
  ranks = result;
  return result;
}

function countPiece(text: string): number {
  const dictionary = tokenRanks();
  const bytes = Buffer.from(text).toString('latin1');
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
  tokenRanks();
  if (pieces === undefined)
    throw new Error('Neutral tokenizer pattern is not initialized');
  let count = 0;
  let start = 0;
  const matcher = new RegExp(pieces);
  for (
    let match = matcher.exec(text);
    match !== null;
    match = matcher.exec(text)
  ) {
    if (match[0].length > 512) {
      if (match.index > start)
        count += countShort(text.slice(start, match.index));
      count += countPiece(match[0]);
      start = match.index + match[0].length;
    }
  }
  return start < text.length ? count + countShort(text.slice(start)) : count;
}
