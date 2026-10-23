/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { withCoreSuffixFixture } from './__tests__/support/core-suffix-fixture-test-helpers.js';
import { consumeCuratedExit } from './__tests__/support/curated-stream-test-helpers.js';
import { providerFixtureRow } from './__tests__/support/provider-curated-test-helpers.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';

async function withRoot(
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'journal-provider-lifecycle-'));
  try {
    await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function textLabels(rows: AsyncIterable<IContent>): Promise<string[]> {
  const labels: string[] = [];
  for await (const row of rows)
    for (const block of row.blocks)
      if (block.type === 'text') labels.push(block.text);
  return labels;
}

describe('independent journal provider cursor membership', () => {
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
      expect(await textLabels(first)).toStrictEqual(['second']);
      expect(await textLabels(later)).toStrictEqual([
        'first',
        'second',
        'appended',
      ]);
    } finally {
      await first.return();
      await later.return();
      await history.dispose();
    }
  });

  it('permits a valid single row larger than 8 MiB without truncation', async () => {
    await withCoreSuffixFixture(
      1,
      async (history) => {
        const stream = history.getCuratedForProviderStream();
        try {
          const row = await stream.next();
          if (row.done === true) throw new Error('Missing large row');
          expect(JSON.stringify(row.value)).toBe(
            JSON.stringify(providerFixtureRow(0, 9 * 1024 * 1024)),
          );
          expect((await stream.next()).done).toBe(true);
        } finally {
          await stream.return();
        }
      },
      9 * 1024 * 1024,
      providerFixtureRow,
    );
  });
});

describe('journal public provider preparation faults', () => {
  it('propagates the actual journal read failure and releases its source before a fresh preparation', async () => {
    await withRoot(async (root) => {
      await withCoreSuffixFixture(512, async (history, owners, counters) => {
        const primary = new Error('journal row read failed');
        const fault = spyOn(
          VersionSnapshot.prototype,
          'readMetadata',
        ).mockRejectedValueOnce(primary);
        try {
          expect(
            await rejectedValue(
              (async () => {
                const snapshot =
                  await history.prepareCuratedForProviderSnapshot([], { root });
                try {
                  await snapshot.openReader().next();
                } finally {
                  await snapshot.close();
                }
              })(),
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
          expect(counters.snapshot().peakDecodedRows).toBe(0);
        } finally {
          await snapshot.close();
        }
      });
    });
  });
});

function registerReaderExit(
  exit: 'return' | 'throw' | 'break' | 'consumer-throw',
): void {
  describe(`reader exit ${exit}`, () => {
    it('keeps repeatable selection until its owner closes', async () => {
      await withRoot(async (root) => {
        await withCoreSuffixFixture(
          512,
          async (history, inputOwners, counters) => {
            const outputOwners = new RowOwnership();
            const snapshot = await history.prepareCuratedForProviderSnapshot(
              [],
              {
                root,
                ownership: outputOwners,
              },
            );
            try {
              expect(snapshot.count).toBe(512);
              const stream = snapshot.openReader();
              expect((await stream.next()).done).toBe(false);
              expect(inputOwners.snapshot().liveRows).toBe(0);
              expect(counters.snapshot().peakDecodedRows).toBe(0);
              expect(outputOwners.snapshot().liveRows).toBe(1);
              const failures = {
                return: undefined,
                throw: 'iterator failed',
                break: undefined,
                'consumer-throw': 'consumer failed',
              };
              expect(await consumeCuratedExit(stream, exit)).toBe(
                failures[exit],
              );
              expect(outputOwners.snapshot().liveRows).toBe(0);
              const reopened = snapshot.openReader();
              expect((await reopened.next()).done).toBe(false);
              expect(readdirSync(root)).toHaveLength(0);
            } finally {
              await snapshot.close();
            }
            expect(outputOwners.snapshot().liveRows).toBe(0);
            expect(readdirSync(root)).toHaveLength(0);
            expect(() => snapshot.openReader()).toThrow('closed');
          },
        );
      });
    });
  });
}

describe('public committed journal provider snapshot lifecycle', () => {
  registerReaderExit('return');
  registerReaderExit('throw');
  registerReaderExit('break');
  registerReaderExit('consumer-throw');

  it('preserves exact abort reasons during preparation and for active or unopened readers', async () => {
    await withRoot(async (root) => {
      await withCoreSuffixFixture(512, async (history) => {
        const preparing = new AbortController();
        const captureFailure = new Error('public preparation aborted');
        const store = history.detachedValues.host().journal;
        if (!(store instanceof JournalHistoryStore))
          throw new Error('Provider snapshot fixture requires a journal store');
        const acquire = store.settledSnapshot.bind(store);
        const fault = spyOn(store, 'settledSnapshot').mockImplementationOnce(
          async (settle) => {
            const pin = await acquire(settle);
            preparing.abort(captureFailure);
            return pin;
          },
        );
        try {
          expect(
            await rejectedValue(
              history
                .prepareCuratedForProviderSnapshot([], {
                  root,
                  signal: preparing.signal,
                })
                .then(() => {}),
            ),
          ).toBe(captureFailure);
          expect(readdirSync(root)).toHaveLength(0);
        } finally {
          fault.mockRestore();
        }
        const active = new AbortController();
        const reason = new Error('public selection aborted');
        const owned = new RowOwnership();
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          root,
          signal: active.signal,
          ownership: owned,
        });
        try {
          const first = snapshot.openReader();
          const unstarted = snapshot.openReader();
          expect((await first.next()).done).toBe(false);
          active.abort(reason);
          expect(
            await rejectedValue(
              Promise.resolve()
                .then(() => first.next())
                .then(() => {}),
            ),
          ).toBe(reason);
          expect(
            await rejectedValue(
              Promise.resolve()
                .then(() => unstarted.next())
                .then(() => {}),
            ),
          ).toBe(reason);
          expect(owned.snapshot().liveRows).toBe(0);
          expect(readdirSync(root)).toHaveLength(0);
        } finally {
          await snapshot.close();
        }
      });
    });
  });
});
