/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMemoryEntrypoint } from '../../memory/entrypoint.ts';

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'memory-bootstrap-effect-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('explicit memory bootstrap execution', () => {
  it('does not execute an imported main', async () => {
    const file = join(root, 'effect');
    await runMemoryEntrypoint(false, () => writeFileSync(file, 'executed'));
    expect(existsSync(file)).toBe(false);
  });

  it('joins asynchronous main execution', async () => {
    const file = join(root, 'effect');
    await runMemoryEntrypoint(true, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      writeFileSync(file, 'executed');
    });
    expect(readFileSync(file, 'utf8')).toBe('executed');
  });

  it('propagates a rejected main without blocking the next explicit invocation', async () => {
    await expect(
      runMemoryEntrypoint(true, async () => {
        throw new Error('module load rejected');
      }),
    ).rejects.toThrow('module load rejected');
    const file = join(root, 'effect');
    await runMemoryEntrypoint(true, () => appendFileSync(file, 'executed\n'));
    await runMemoryEntrypoint(true, () => appendFileSync(file, 'executed\n'));
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(
      2,
    );
  });
});
