import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { createUserMessage, type IContent } from './IContent.js';
const historyScratchRoots = createTestScratchOwner();

async function texts(history: HistoryService): Promise<string[]> {
  const result: string[] = [];
  for await (const row of history.streamRawHistory())
    for (const block of row.blocks)
      if (block.type === 'text') result.push(block.text);
  return result;
}

async function replaceFirst(history: HistoryService): Promise<void> {
  await history.detachedValues.transform(async (source, sink) => {
    let ordinal = 0;
    for await (const row of source.streamRows()) {
      const replacement: IContent = {
        ...row,
        blocks: [{ type: 'text', text: 'independent replacement' }],
      };
      if (ordinal === 0) await sink.appendReplacement(ordinal, replacement);
      else await sink.appendDerived(ordinal, row);
      ordinal++;
    }
  });
}

describe('selective journal compensation', () => {
  it('does not scan history or publish another version for an untouched attempt', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      const current = history.historyMutationGuard();
      const dump = vi
        .spyOn(JournalDumpSnapshot.prototype, 'rows')
        .mockImplementation(() => {
          throw new Error('whole-history dump forbidden');
        });
      const materialize = vi
        .spyOn(history.detachedValues.host().journal, 'materialize')
        .mockImplementation(() => {
          throw new Error('whole-history collection forbidden');
        });
      try {
        await history.detachedValues.withRollbackCheckpoint(async (restore) => {
          await restore();
        }, true);
        expect(current()).toBe(true);
      } finally {
        dump.mockRestore();
        materialize.mockRestore();
      }
      expect(await texts(history)).toStrictEqual(['original']);
    } finally {
      await history.dispose();
    }
  });

  it('compensates a journal-sized source without a dump or history collector', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      async function* rows(): AsyncGenerator<IContent> {
        for (let index = 0; index < 2048; index++)
          yield createUserMessage(`${index}:` + 'x'.repeat(2048));
      }
      await history.detachedValues.replace(rows());
      const dump = vi
        .spyOn(JournalDumpSnapshot.prototype, 'rows')
        .mockImplementation(() => {
          throw new Error('whole-history dump forbidden');
        });
      const materialize = vi
        .spyOn(history.detachedValues.host().journal, 'materialize')
        .mockImplementation(() => {
          throw new Error('whole-history collection forbidden');
        });
      try {
        await history.detachedValues.withRollbackCheckpoint(async (restore) => {
          await history.detachedValues.replace([createUserMessage('partial')]);
          await history.addBatch([createUserMessage('independent')]);
          await restore();
        }, true);
      } finally {
        dump.mockRestore();
        materialize.mockRestore();
      }
      let count = 0;
      let newest: IContent | undefined;
      for await (const row of history.streamRawHistory()) {
        count++;
        newest = row;
      }
      expect(count).toBe(2049);
      expect(newest?.blocks).toStrictEqual([
        { type: 'text', text: 'independent' },
      ]);
    } finally {
      await history.dispose();
    }
  });

  it('restores the saved version while retaining independent appends on either side of a rewrite', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        await history.addBatch([createUserMessage('before rewrite')]);
        await history.detachedValues.replace([
          createUserMessage('speculative'),
        ]);
        await history.addBatch([createUserMessage('after rewrite')]);
        await restore();
      }, true);
      expect(await texts(history)).toStrictEqual([
        'original',
        'before rewrite',
        'after rewrite',
      ]);
    } finally {
      await history.dispose();
    }
  });

  it('retains an independent row replacement removed by the speculative rewrite', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        await replaceFirst(history);
        await history.detachedValues.replace([
          createUserMessage('speculative'),
        ]);
        await restore();
      }, true);
      expect(await texts(history)).toStrictEqual(['independent replacement']);
    } finally {
      await history.dispose();
    }
  });

  it('does not resurrect a batch whose own publication rolled back', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    try {
      await history.addBatch([createUserMessage('original')]);
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        await expect(
          history.addBatch([createUserMessage('rejected')], undefined, {
            afterPublication: () => {
              throw new Error('batch rejected');
            },
          }),
        ).rejects.toThrow('batch rejected');
        await history.detachedValues.replace([
          createUserMessage('speculative'),
        ]);
        await restore();
      }, true);
      expect(await texts(history)).toStrictEqual(['original']);
    } finally {
      await history.dispose();
    }
  });
});
