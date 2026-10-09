/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get_encoding } from '@dqbd/tiktoken';
import { countO200kBaseTokensFromDiskSource } from './o200k-disk-source.js';

async function diskLarge(size: number): Promise<number> {
  const root = mkdtempSync(join(tmpdir(), 'o200k-large-test-'));
  const workspace = join(root, 'workspace');
  const path = join(root, 'source');
  mkdirSync(workspace);
  try {
    writeFileSync(path, '');
    for (let left = size; left > 0; left -= 65536)
      appendFileSync(path, 'a'.repeat(Math.min(65536, left)));
    const result = await countO200kBaseTokensFromDiskSource(
      { path },
      { workspaceDirectory: workspace },
    );
    expect(readdirSync(workspace)).toStrictEqual([]);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('unbounded regex pieces', () => {
  it('executes the disk-only >10 MiB piece with the established repeated-a merge recurrence', async () => {
    expect(await diskLarge(10 * 1024 * 1024 + 1)).toBe(1310721);
  }, 600000);
  it('has whole-string pinned ordinary parity for a single >10 MiB piece', async () => {
    const size = 10 * 1024 * 1024 + 1;
    const encoder = get_encoding('o200k_base');
    const expected = encoder.encode_ordinary('a'.repeat(size)).length;
    encoder.free();
    Bun.gc(true);
    expect(await diskLarge(size)).toBe(expected);
  }, 600000);
});
