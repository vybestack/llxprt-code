/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('core package ownership after helper relocation', () => {
  it('exports real production sources without restoring removed test helper paths', () => {
    const root = resolve(import.meta.dir, '../../packages/core');
    const parsed: unknown = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null || !('exports' in parsed))
      throw new Error('Missing exports');
    const exports = parsed.exports;
    if (typeof exports !== 'object' || exports === null)
      throw new Error('Invalid exports');
    expect(
      Object.keys(exports).some((name) => name.startsWith('./test-utils/')),
    ).toBe(false);
    for (const name of [
      './recording/childJournal.js',
      './services/history/HistoryService.js',
      './llm-types/toolDeclaration.js',
    ]) {
      if (!(name in exports))
        throw new Error(`Missing production export ${name}`);
    }
    for (const [name, entry] of Object.entries(exports)) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('bun' in entry) ||
        typeof entry.bun !== 'string'
      )
        continue;
      expect(existsSync(resolve(root, entry.bun)), name).toBe(true);
    }
  });
});
