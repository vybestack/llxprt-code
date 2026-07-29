/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type CorpusCategory = 'prose' | 'code' | 'json' | 'unicode' | 'mixed';

export type CorpusSplit = 'train' | 'heldout';

export interface CorpusItem {
  readonly id: number;
  readonly split: CorpusSplit;
  readonly category: CorpusCategory;
  readonly prompt: string;
}

const TRAIN_END = 20;
const HOLDOUT_END = 25;

export const CORPUS_VERSION = '2026-07-28-v1';
export const TRAIN_COUNT = TRAIN_END;
export const HOLDOUT_COUNT = HOLDOUT_END - TRAIN_END;

const REPLY_DIRECTIVE =
  ' Reply with exactly the two characters OK and nothing else.';

function buildPayload(category: CorpusCategory, sizeIndex: number): string {
  const scale = sizeIndex + 1;
  switch (category) {
    case 'prose':
      return prosePayload(scale);
    case 'code':
      return codePayload(scale);
    case 'json':
      return jsonPayload(scale);
    case 'unicode':
      return unicodePayload(scale);
    case 'mixed':
      return mixedPayload(scale);
    default:
      throw new Error(`Unknown corpus category: ${String(category)}`);
  }
}

function prosePayload(scale: number): string {
  const base =
    'The quick brown fox jumps over the lazy dog while a merchant inspects each ledger entry for accuracy before sealing the envelope and dispatching it via the afternoon courier service. ';
  return base.repeat(scale * 3);
}

function codePayload(scale: number): string {
  const line =
    'function computeChecksum(values) { return values.reduce((acc, v) => (acc * 31 + v) >>> 0, 0); } // deterministic checksum';
  return Array.from({ length: scale * 4 }, () => line).join('\n');
}

function jsonPayload(scale: number): string {
  const entry = (i: number): string =>
    `{"id":${i},"name":"item_${i}","tags":["alpha","beta"],"meta":{"weight":${i}.5,"enabled":true}}`;
  return (
    '[' + Array.from({ length: scale * 5 }, (_, i) => entry(i)).join(',') + ']'
  );
}

function unicodePayload(scale: number): string {
  const glyphs =
    '日本語のテキストです。한국어 텍스트입니다. Русский текст. Ελληνικό κείμενο. العربية. ';
  return glyphs.repeat(scale * 2);
}

function mixedPayload(scale: number): string {
  const block = `Repeat-safe block ${scale}: <tool name="search"><query>tokenization boundary ${scale}</query></tool> — "punctuation; semicolons; brackets [a] {b} (c)" — unicode 日本語 — done.`;
  return Array.from({ length: scale * 3 }, (_, i) =>
    block.replace(/\$\{scale\}/g, String(i)),
  ).join('\n');
}

const CATEGORIES: readonly CorpusCategory[] = [
  'prose',
  'code',
  'json',
  'unicode',
  'mixed',
];

function buildItem(id: number): CorpusItem {
  const category = CATEGORIES[(id - 1) % CATEGORIES.length]!;
  const sizeIndex = Math.floor((id - 1) / CATEGORIES.length);
  return {
    id,
    split: id <= TRAIN_END ? 'train' : 'heldout',
    category,
    prompt: buildPayload(category, sizeIndex) + REPLY_DIRECTIVE,
  };
}

export function getCorpus(): readonly CorpusItem[] {
  return Array.from({ length: HOLDOUT_END }, (_, i) => buildItem(i + 1));
}

export function getCorpusItem(id: number): CorpusItem {
  if (id < 1 || id > HOLDOUT_END) {
    throw new Error(`Corpus item id ${id} out of range [1, ${HOLDOUT_END}]`);
  }
  return buildItem(id);
}
