/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Gpt56SourceProjection } from './gpt56-source-projection.js';

let root: string;
function source(): Gpt56SourceProjection {
  const directory = join(root, 'parent', 'owned');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'input');
  writeFileSync(path, 'hello');
  return new Gpt56SourceProjection({
    protocol: 'openai-responses',
    directory,
    segments: [{ promptKey: 'input', source: { path } }],
  });
}

describe('sealed GPT-5.6 source ownership', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'source-ownership-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('defers disposal through every lease and rejects a duplicate release', async () => {
    const owner = source();
    const releaseFirst = owner.acquire();
    const releaseSecond = owner.acquire();
    const disposal = owner.dispose();
    await releaseFirst();
    expect(existsSync(owner.promptSegments[0].source.path)).toBe(true);
    expect(() => owner.acquire()).toThrow('disposed');
    await releaseSecond();
    await disposal;
    await expect(releaseFirst()).rejects.toThrow('already released');
    expect(existsSync(owner.promptSegments[0].source.path)).toBe(false);
    await owner.dispose();
  });

  it('reports disposal I/O failure without an orphan rejected cleanup promise', async () => {
    const owner = source();
    const parent = join(root, 'parent');
    renameSync(parent, join(root, 'saved'));
    writeFileSync(parent, 'not-a-directory');
    await expect(owner.dispose()).rejects.toMatchObject({ code: 'ENOTDIR' });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(existsSync(join(root, 'saved', 'owned', 'input'))).toBe(true);
  });

  it('rejects a source path outside the transferred directory', async () => {
    const owner = source();
    expect(
      () =>
        new Gpt56SourceProjection({
          protocol: 'openai-responses',
          directory: join(root, 'unowned'),
          segments: owner.promptSegments,
        }),
    ).toThrow('belong');
    await owner.dispose();
  });

  it('rejects prompt keys that are not part of the selected protocol', async () => {
    const owner = source();
    expect(
      () =>
        new Gpt56SourceProjection({
          protocol: 'openai-chat',
          directory: join(root, 'parent', 'owned'),
          segments: owner.promptSegments,
        }),
    ).toThrow('Invalid prompt key');
    await owner.dispose();
  });
});
