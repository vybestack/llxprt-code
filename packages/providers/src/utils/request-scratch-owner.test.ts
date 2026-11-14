/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestScopedContents } from './requestScopedBody.js';

const scratchRoots = new ScratchRootOwner();

async function* rows(): AsyncGenerator<IContent> {
  yield { speaker: 'human', blocks: [{ type: 'text', text: 'scratch row' }] };
}

describe('request scratch ownership', () => {
  afterEach(() => scratchRoots.removeRoot());
  it('allocates replay files lazily under the shared startup root and cleans each request independently', async () => {
    const root = scratchRoots.getRoot();
    const first = requestScopedContents(rows(), scratchRoots);
    const second = requestScopedContents(rows(), scratchRoots);
    expect(readdirSync(root)).toStrictEqual([]);
    const firstReader = first.stream()[Symbol.asyncIterator]();
    const secondReader = second.stream()[Symbol.asyncIterator]();
    try {
      expect((await firstReader.next()).done).toBe(false);
      expect((await secondReader.next()).done).toBe(false);
      const directories = readdirSync(root);
      expect(directories).toHaveLength(2);
      for (const directory of directories)
        expect(existsSync(join(root, directory, 'rows'))).toBe(true);
      await first.dispose();
      expect(readdirSync(root)).toHaveLength(1);
      await second.dispose();
      expect(readdirSync(root)).toStrictEqual([]);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });
});
