/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../debug/index.js';
import type { IContent } from './IContent.js';
import { prepareProviderContentSnapshot } from './provider-curated-stream.js';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';

const logger = new DebugLogger('test:provider-normalization-scratch');

async function* rows(
  count: number,
  onRow?: (index: number) => void,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < count; index++) {
    onRow?.(index);
    yield batchRow(index, 64);
  }
}

function scratchDirectory(root: string): string {
  const [name] = readdirSync(root);
  return join(root, name);
}

describe('provider normalization scratch checks', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'provider-normalization-scratch-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('stats the scratch directory per batch of rows, not per row', async () => {
    let stats = 0;
    const originalStat = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation(((
      path: fs.PathLike,
      ...rest: never[]
    ) => {
      if (String(path).includes('provider-normalization-')) stats++;
      return originalStat(path, ...rest);
    }) as typeof fs.statSync);
    const snapshot = await prepareProviderContentSnapshot(
      rows(2000),
      [],
      logger,
      { root },
    );
    try {
      const reader = snapshot.openReader();
      let read = 0;
      for await (const row of reader) {
        expect(row.speaker).toBeDefined();
        read++;
      }
      expect(read).toBe(snapshot.count);
      expect(stats).toBeLessThan(2000);
    } finally {
      snapshot.close();
    }
  });

  it('fails preparation with a clear error when the scratch directory is removed', async () => {
    const preparing = prepareProviderContentSnapshot(
      rows(400, (index) => {
        if (index === 64)
          rmSync(scratchDirectory(root), { recursive: true, force: true });
      }),
      [],
      logger,
      { root },
    );
    await expect(preparing).rejects.toThrow(
      'Provider normalization scratch directory is unavailable',
    );
  });

  it('fails a reader that starts after the scratch directory is removed', async () => {
    const snapshot = await prepareProviderContentSnapshot(
      rows(50),
      [],
      logger,
      { root },
    );
    try {
      rmSync(scratchDirectory(root), { recursive: true, force: true });
      await expect(snapshot.openReader().next()).rejects.toThrow(
        'Provider normalization scratch directory is unavailable',
      );
    } finally {
      snapshot.close();
    }
  });
});
