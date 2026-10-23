/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../debug/index.js';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import { providerFixtureRow } from './__tests__/support/provider-curated-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { streamProviderContent } from './provider-curated-stream.js';

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
        for (let index = 2; index < 80; index++)
          yield providerFixtureRow(index);
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
      await history.dispose();
    }
  });
});

describe('native public provider preparation faults', () => {
  it('propagates the actual journal read failure and releases its source before a fresh preparation', async () => {
    await withCoreSuffixFixture(
      512,
      async (history, owners, counters) => {
        const root = mkdtempSync(join(tmpdir(), 'provider-native-fault-'));
        const primary = new Error('journal row read failed');
        const fault = spyOn(
          VersionSnapshot.prototype,
          'readRow',
        ).mockRejectedValueOnce(primary);
        try {
          expect(
            await rejectedValue(
              history
                .prepareCuratedForProviderSnapshot([], { root })
                .then(() => {}),
            ),
          ).toBe(primary);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(readdirSync(root)).toHaveLength(0);
        } finally {
          fault.mockRestore();
        }
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          root,
        });
        try {
          expect(snapshot.count).toBe(512);
          expect((await snapshot.openReader().next()).done).toBe(false);
          expect(counters.snapshot().peakDecodedRows).toBe(1);
        } finally {
          snapshot.close();
          rmSync(root, { recursive: true, force: true });
        }
      },
      0,
      undefined,
      undefined,
      undefined,
    );
  });
});
