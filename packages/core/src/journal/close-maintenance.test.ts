/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('closing automatic maintenance', () => {
  const directory = useTempDir('close-maintenance-');
  it('does not start a pending automatic copy on close', async () => {
    let dueChecks = 0;
    const store = await JournalStore.create(
      join(directory(), 'pending.llxj'),
      storeDeps({
        compactionDue: () => {
          dueChecks++;
          return true;
        },
      }),
    );
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'kept' })] },
    ]);
    await store.close();
    await setImmediate();
    expect(dueChecks).toBe(0);
  });

  it('stops an automatic copy at its next safe point without publishing and reopens identical rows', async () => {
    const file = join(directory(), 'running.llxj');
    const seams = testJournalSeams();
    const entered = gate();
    const resume = gate();
    let copying = false;
    let candidateReads = 0;
    const store = await JournalStore.create(file, {
      ...storeDeps({ seams, compactionDue: () => true }),
      journal: {
        ...seams.dependencies,
        open: async (path, flags) => {
          const handle = await seams.dependencies.open(path, flags);
          if (path.endsWith('.compact')) {
            copying = true;
            entered.release();
          }
          return {
            ...handle,
            read: async (...args) => {
              if (copying) {
                candidateReads++;
                await resume.promise;
              }
              return handle.read(...args);
            },
          };
        },
      },
    });
    await store.commit([
      {
        kind: 'append',
        rows: Array.from({ length: 64 }, (_, index) =>
          draftRow({ text: `row-${index}` }),
        ),
      },
    ]);
    const version = store.published;
    await entered.promise;
    const closing = store.close();
    resume.release();
    await closing;
    expect(candidateReads).toBeLessThanOrEqual(1);
    await expect(access(`${file}.compact`)).rejects.toThrow('ENOENT');
    const reopened = await JournalStore.open(
      file,
      storeDeps({ compactionDue: () => false }),
    );
    try {
      expect(reopened.published?.selfOffset).toBe(version?.selfOffset);
      let index = 0;
      for await (const entry of reopened.rows()) {
        const row = await reopened.readRow(entry);
        expect(new TextDecoder().decode(row.blocks[0])).toBe(`row-${index++}`);
      }
      expect(index).toBe(64);
    } finally {
      await reopened.close();
    }
  });
});
