/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type DumpIndexEntry = {
  promptId: string | null;
  outcome: string | null;
  requestTerms: string[];
};

function walk(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) return walk(file);
      if (entry.isFile()) return [file];
      return [];
    })
    .sort();
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const STOP_WORDS = new Set([
  'tool',
  'human',
  'ai',
  'run',
  'shell',
  'command',
  'and',
  'the',
  'for',
  'with',
  'from',
  'that',
  'this',
  'into',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'you',
  'your',
  'not',
  'but',
  'about',
  'then',
  'when',
  'what',
  'will',
  'would',
  'can',
  'could',
  'should',
  'after',
  'before',
  'there',
  'their',
  'they',
  'them',
  'his',
  'her',
  'she',
  'him',
  'its',
  'our',
  'out',
  'all',
  'one',
  'two',
  'use',
  'using',
]);

function words(text: string): string[] {
  const result = new Set<string>();
  let current = '';
  for (const character of text.toLocaleLowerCase()) {
    if (/[\p{L}\p{N}]/u.test(character)) current += character;
    else {
      if (isContentTerm(current)) result.add(current);
      current = '';
    }
  }
  if (isContentTerm(current)) result.add(current);
  return [...result];
}

function isContentTerm(value: string): boolean {
  return (
    value.length >= 3 &&
    /^\p{L}+$/u.test(value) &&
    !/^[\da-f]{8,}$/iu.test(value) &&
    !STOP_WORDS.has(value)
  );
}

export function readDumpIndex(
  cacheRoot: string,
  malformed: () => void,
): Map<string, DumpIndexEntry> {
  const dumps = new Map<string, DumpIndexEntry>();
  for (const file of walk(path.join(cacheRoot, 'dumps')).filter((name) =>
    name.endsWith('.json'),
  )) {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!object(value)) continue;
      const base = string(value['dump_base_id']) ?? string(value['dumpBaseId']);
      const fileId = path
        .basename(file, '.json')
        .replace(/-(request|response)$/, '');
      dumps.set(base ?? fileId, {
        promptId: string(value['promptId']) ?? string(value['prompt_id']),
        outcome: string(value['outcome']) ?? string(value['attempt_outcome']),
        requestTerms: words(JSON.stringify(value['request'] ?? '')),
      });
    } catch {
      malformed();
    }
  }
  return dumps;
}
