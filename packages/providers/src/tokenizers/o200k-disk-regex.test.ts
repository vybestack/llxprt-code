/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Tiktoken } from '@dqbd/tiktoken';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskCharacters } from './o200k-disk-io.js';
import { nextPiece } from './o200k-disk-regex.js';
import { adverseTexts } from './o200k-disk-test-data.js';

function* finiteWords(
  alphabet: string[],
  maximum: number,
  prefix = '',
): Generator<string> {
  yield prefix;
  if (maximum === 0) return;
  for (const character of alphabet)
    yield* finiteWords(alphabet, maximum - 1, prefix + character);
}

function boundaryOracle(texts: Iterable<string>): Tiktoken {
  function* substrings(text: string): Generator<string> {
    const chars = Array.from(text);
    for (let start = 0; start < chars.length; start++) {
      for (let end = start + 1; end <= chars.length; end++) {
        yield Buffer.from(chars.slice(start, end).join('')).toString('base64');
      }
    }
  }

  const ranks = new Map<string, number>();
  for (let byte = 0; byte < 256; byte++)
    ranks.set(Buffer.from([byte]).toString('base64'), ranks.size);
  for (const text of texts) {
    for (const token of substrings(text)) {
      if (!ranks.has(token)) ranks.set(token, ranks.size);
    }
  }
  const path = createRequire(import.meta.url).resolve(
    '@dqbd/tiktoken/encoders/o200k_base.json',
  );
  const asset: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof asset !== 'object' ||
    asset === null ||
    !('pat_str' in asset) ||
    typeof asset.pat_str !== 'string'
  )
    throw new Error('Invalid pinned pattern');
  const serialized = Array.from(
    ranks,
    ([bytes, rank]) => `${bytes} ${rank}\n`,
  ).join('');
  return new Tiktoken(serialized, {}, asset.pat_str);
}

async function comparePieces(
  text: string,
  path: string,
  oracle: Tiktoken,
): Promise<string[]> {
  writeFileSync(path, text);
  const expected = Array.from(oracle.encode_ordinary(text), (token) =>
    Buffer.from(oracle.decode_single_token_bytes(token)).toString('utf8'),
  );
  const reader = new DiskCharacters(path);
  try {
    let position = 0;
    const actual: string[] = [];
    while (reader.at(position)) {
      const end = await nextPiece(reader, position);
      actual.push(Buffer.from(text).subarray(position, end).toString('utf8'));
      position = end;
    }
    expect(actual).toStrictEqual(expected);
    return actual;
  } finally {
    reader.close();
  }
}

describe('pinned regex ordered piece boundaries', () => {
  it('matches every word up to length four over ten Unicode and boundary classes', async () => {
    const alphabet = [
      'A',
      'a',
      '\u02b0',
      '\u0301',
      '!',
      ' ',
      '\r',
      '\n',
      '1',
      '\u0085',
    ];
    const oracle = boundaryOracle(finiteWords(alphabet, 4));
    const root = mkdtempSync(join(tmpdir(), 'o200k-regex-'));
    try {
      for (const text of finiteWords(alphabet, 4)) {
        expect(
          (await comparePieces(text, join(root, 'source'), oracle)).join(''),
        ).toBe(text);
      }
    } finally {
      oracle.free();
      rmSync(root, { recursive: true, force: true });
    }
  }, 180000);
  it('matches contraction and whitespace backtracking piece boundaries', async () => {
    const texts = adverseTexts().filter((text) => text.length < 256);
    const oracle = boundaryOracle(texts);
    const root = mkdtempSync(join(tmpdir(), 'o200k-regex-'));
    try {
      for (const text of texts) {
        expect(
          (await comparePieces(text, join(root, 'source'), oracle)).join(''),
        ).toBe(text);
      }
    } finally {
      oracle.free();
      rmSync(root, { recursive: true, force: true });
    }
  }, 180000);
});
