/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { detachedRow } from './detached-rollback-test-helpers.js';
import type { DetachedHistoryTransform } from './detachedHistoryMutation.js';
import type { IContent } from './IContent.js';
import { openOwnedJournal, type SeedRow } from './journalOwnedFixture.js';

/** Rows 0..n-1 owned by the origins in `owners`, repeating. */
function ownedSeed(
  count: number,
  owners: ReadonlyArray<string | undefined>,
): SeedRow[] {
  return Array.from({ length: count }, (_, index) => ({
    content: detachedRow(index, 64),
    origin: owners[index % owners.length],
  }));
}

function textOf(row: IContent): string {
  const block = row.blocks[0];
  return block.type === 'text' ? block.text : '';
}

describe('detached publication keeps the owner of every row', () => {
  const directory = useTempDir('journal-detached-owners-');

  it('keeps the owner of rows it carries over, replaces in place and drops', async () => {
    const owned = await openOwnedJournal(
      path.join(directory(), 'carry.llxj'),
      ownedSeed(6, ['a', 'a', 'a', 'b', 'b', undefined]),
    );
    try {
      const thin: DetachedHistoryTransform = async (source, sink) => {
        let index = 0;
        for await (const row of source.streamRows()) {
          if (index === 1) await sink.removeValue(index);
          else if (index === 3)
            await sink.appendReplacement(index, detachedRow(90, 64));
          else await sink.appendValue(row);
          index++;
        }
      };
      await owned.store.publishDetached(
        { transform: thin },
        owned.host,
        undefined,
        {},
      );
      expect(await owned.originsOfRows()).toStrictEqual([
        'a',
        'a',
        'b',
        'b',
        undefined,
      ]);
      expect(owned.store.getLength()).toBe(5);
    } finally {
      await owned.dispose();
    }
  });

  it('writes a new summary unowned and keeps the owners of the tail it retains', async () => {
    const owned = await openOwnedJournal(
      path.join(directory(), 'summary.llxj'),
      ownedSeed(6, ['a', 'a', 'a', 'b', 'b', undefined]),
    );
    try {
      const compress: DetachedHistoryTransform = async (source, sink) => {
        await sink.appendValue({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'summary' }],
        });
        let index = 0;
        for await (const row of source.streamRows()) {
          if (index++ >= 4) await sink.appendValue(row);
        }
      };
      await owned.store.publishDetached(
        { transform: compress },
        owned.host,
        undefined,
        {},
      );
      expect(await owned.originsOfRows()).toStrictEqual([
        undefined,
        'b',
        undefined,
      ]);
      expect(textOf((await owned.store.materialize())[0])).toBe('summary');
    } finally {
      await owned.dispose();
    }
  });

  it.each([3, 64, 65, 200])(
    'keeps every owner when %i rows are rewritten in one publication',
    async (count) => {
      const owners = ['a', 'b', undefined, 'c'];
      const owned = await openOwnedJournal(
        path.join(directory(), `rewrite-${count}.llxj`),
        ownedSeed(count, owners),
      );
      try {
        const rewrite: DetachedHistoryTransform = async (source, sink) => {
          let index = 0;
          for await (const row of source.streamRows()) {
            await sink.appendReplacement(index++, {
              ...row,
              blocks: [{ type: 'text', text: 'rewritten' }],
            });
          }
        };
        await owned.store.publishDetached(
          { transform: rewrite },
          owned.host,
          undefined,
          {},
        );
        expect(await owned.originsOfRows()).toStrictEqual(
          Array.from({ length: count }, (_, i) => owners[i % owners.length]),
        );
        expect(
          (await owned.store.materialize()).every(
            (r) => textOf(r) === 'rewritten',
          ),
        ).toBe(true);
      } finally {
        await owned.dispose();
      }
    },
  );

  it('puts owned rows back, with their owners, when a rollback checkpoint restores', async () => {
    const owned = await openOwnedJournal(
      path.join(directory(), 'rollback.llxj'),
      ownedSeed(6, ['a', 'a', 'a', 'b', 'b', undefined]),
    );
    try {
      const before = await owned.store.materialize();
      const now = (execute: () => Promise<void>): Promise<void> => execute();
      await owned.store.withRollbackCheckpoint(
        owned.host,
        now,
        async (restore) => {
          const compress: DetachedHistoryTransform = async (_source, sink) => {
            await sink.appendValue({
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'summary' }],
            });
          };
          await owned.store.publishDetached(
            { transform: compress },
            owned.host,
            undefined,
            {},
          );
          expect(await owned.originsOfRows()).toStrictEqual([undefined]);
          await restore();
        },
      );
      expect(await owned.originsOfRows()).toStrictEqual([
        'a',
        'a',
        'a',
        'b',
        'b',
        undefined,
      ]);
      expect(await owned.store.materialize()).toStrictEqual(before);
    } finally {
      await owned.dispose();
    }
  });
});
