/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../debug/index.js';
import { streamProviderContent } from './provider-curated-stream.js';
import { providerFixtureRow } from './provider-curated-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';

const logger = new DebugLogger('test:provider-faults');

async function textLabels(rows: AsyncIterable<IContent>): Promise<string[]> {
  const labels: string[] = [];
  for await (const row of rows)
    for (const block of row.blocks)
      if (block.type === 'text') labels.push(block.text);
  return labels;
}

describe('provider scratch admission failures', () => {
  it('rejects scratch creation under an absent root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provider-missing-root-'));
    rmSync(root, { recursive: true });
    const input: AsyncIterable<IContent> = {
      async *[Symbol.asyncIterator]() {
        yield providerFixtureRow(0);
      },
    };
    await expect(
      streamProviderContent(input, [], logger, { root }).next(),
    ).rejects.toThrow('ENOENT');
  });

  it('propagates a staged write failure and closes its input', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provider-write-fault-'));
    let closed = false;
    async function* brokenScratch(): AsyncGenerator<IContent, void, unknown> {
      try {
        yield providerFixtureRow(0);
        rmSync(join(root, readdirSync(root)[0]), { recursive: true });
        yield providerFixtureRow(2);
      } finally {
        closed = true;
      }
    }
    try {
      await expect(
        streamProviderContent(brokenScratch(), [], logger, { root }).next(),
      ).rejects.toThrow('ENOENT');
      expect(closed).toBe(true);
      expect(readdirSync(root)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('independent provider cursor membership', () => {
  it('pins an active cursor while a later cursor sees the appended row', async () => {
    const history = new HistoryService();
    const initial: IContent[] = ['first', 'second'].map((text) => ({
      speaker: 'human',
      blocks: [{ type: 'text', text }],
    }));
    const first = history.getCuratedForProviderStream();
    const later = history.getCuratedForProviderStream();
    try {
      await history.addBatch(initial, 'provider-cursor');
      expect((await first.next()).done).toBe(false);
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'appended' }],
      });
      const oldLabels = await textLabels(first);
      const newLabels = await textLabels(later);
      expect(oldLabels).toStrictEqual(['second']);
      expect(newLabels).toStrictEqual(['first', 'second', 'appended']);
    } finally {
      await first.return();
      await later.return();
      history.dispose();
    }
  });
});
