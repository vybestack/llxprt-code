/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tiktoken } from '@dqbd/tiktoken';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

function pinnedRankString(): string {
  const path = createRequire(import.meta.url).resolve(
    '@dqbd/tiktoken/encoders/o200k_base.json',
  );
  const bytes = readFileSync(path);
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    'df53e1a5f146e33a1b144d12ad9d685ee1b54dbc8b0950791ed45c933b119dc1'
  )
    throw new Error('Pinned o200k asset changed');
  const asset: unknown = JSON.parse(bytes.toString('utf8'));
  if (
    typeof asset !== 'object' ||
    asset === null ||
    !('bpe_ranks' in asset) ||
    typeof asset.bpe_ranks !== 'string'
  )
    throw new Error('Invalid pinned asset');
  return asset.bpe_ranks;
}

export interface CharacterClass {
  letter: boolean;
  number: boolean;
  upper: boolean;
  lower: boolean;
  space: boolean;
  newline: boolean;
  foldS: boolean;
}

export interface DiskAssets {
  ranks: ReadonlyMap<string, number>;
  maxBytes: number;
  classify: (text: string) => CharacterClass;
}

let shared: DiskAssets | undefined;

function buildRanks(): { ranks: Map<string, number>; maxBytes: number } {
  const ranks = new Map<string, number>();
  let maxBytes = 0;
  const compact = pinnedRankString().split(' ');
  if (compact[0] !== '!' || compact[1] !== '0')
    throw new Error('Unrecognized pinned rank format');
  for (let index = 2; index < compact.length; index++) {
    const bytes = Buffer.from(compact[index], 'base64');
    ranks.set(bytes.toString('latin1'), index - 2);
    maxBytes = Math.max(maxBytes, bytes.length);
  }
  if (ranks.size !== 199998 || maxBytes !== 128)
    throw new Error('Pinned rank asset changed');
  return { ranks, maxBytes };
}

function buildClassifier(): (text: string) => CharacterClass {
  let byteRanks = '';
  for (let byte = 0; byte < 256; byte++)
    byteRanks += `${Buffer.from([byte]).toString('base64')} ${byte}\n`;
  const patterns = [
    '\\p{L}',
    '\\p{N}',
    '[\\p{Lu}\\p{Lt}\\p{Lm}\\p{Lo}\\p{M}]',
    '[\\p{Ll}\\p{Lm}\\p{Lo}\\p{M}]',
    '\\s',
    '(?i:s)',
  ];
  const probes = patterns.map(
    (pattern) => new Tiktoken(byteRanks, {}, pattern),
  );
  const cache = new Map<string, CharacterClass>();
  return (text): CharacterClass => {
    const cached = cache.get(text);
    if (cached) return cached;
    const matched = probes.map(
      (probe) => probe.encode_ordinary(text).length > 0,
    );
    const result = {
      letter: matched[0],
      number: matched[1],
      upper: matched[2],
      lower: matched[3],
      space: matched[4],
      newline: text === '\r' || text === '\n',
      foldS: matched[5],
    };
    if (cache.size >= 4096) cache.clear();
    cache.set(text, result);
    return result;
  };
}

export function diskAssets(): DiskAssets {
  shared ??= { ...buildRanks(), classify: buildClassifier() };
  return shared;
}
