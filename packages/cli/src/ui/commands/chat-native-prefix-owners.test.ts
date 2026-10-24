/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  createLockedSessionRecorder,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { describe, expect, it } from 'bun:test';
import {
  blocks,
  contents,
  operationFileCreates,
  persistedContents,
  row,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

async function attachOwner(
  history: HistoryService,
  root: string,
  owner: object,
): Promise<SessionRecordingPort> {
  const recorder = await createLockedSessionRecorder({
    sessionId: crypto.randomUUID(),
    projectHash: 'cli-native-prefix',
    chatsDir: `${root}/owned-chats`,
    workspaceDirs: [root],
    provider: 'fake',
    model: 'fake-model',
  });
  await history.attachJournal(recorder, true, undefined, owner);
  return recorder;
}

async function assertOwners(
  history: HistoryService,
  cut: number,
  a: object,
  b: object,
): Promise<void> {
  await history.detachedValues.host().journal.readRows(async (view) => {
    const owners: Array<string | undefined> = [];
    for (let index = 0; index < view.length; index++)
      owners.push(await view.originAt(index));
    expect(owners).toStrictEqual(
      Array.from({ length: cut }, (_, index) =>
        historyOriginId(index % 2 === 0 ? a : b),
      ),
    );
  });
}

describe('actual native CLI prefix original owners and owner-filtered mirrors', () => {
  const directory = useTempDir('cli-native-prefix-owners-');
  for (const size of [3, 64, 65, 5000]) {
    it(`preserves alternating source owners and each recorder at ${size} rows`, async () => {
      const a = {};
      const b = {};
      await withCLI(
        directory(),
        size,
        async ({ client, history, context, recording }) => {
          const first = await attachOwner(history, directory(), a);
          const second = await attachOwner(history, directory(), b);
          try {
            const receipt = await operationFileCreates(async () => {
              expect(await runCommand(context, 'restore', '1')).toBeUndefined();
              const cut = size % 2 === 0 ? size - 2 : size - 1;
              await assertOwners(history, cut, a, b);
              expect(blocks(await contents(client.getHistory()))).toStrictEqual(
                Array.from({ length: cut }, (_, i) => row(i).blocks),
              );
              expect(blocks(await persistedContents(first))).toStrictEqual(
                Array.from(
                  { length: Math.ceil(cut / 2) },
                  (_, i) => row(i * 2).blocks,
                ),
              );
              expect(blocks(await persistedContents(second))).toStrictEqual(
                Array.from(
                  { length: Math.floor(cut / 2) },
                  (_, i) => row(i * 2 + 1).blocks,
                ),
              );
              expect(await persistedContents(recording)).toStrictEqual([]);
              expect(await runCommand(context, 'clear')).toStrictEqual(
                cut === 2
                  ? {
                      type: 'message',
                      messageType: 'info',
                      content: 'No conversation to clear.',
                    }
                  : undefined,
              );
              await assertOwners(history, 2, a, b);
              expect(blocks(await persistedContents(first))).toStrictEqual([
                row(0).blocks,
              ]);
              expect(blocks(await persistedContents(second))).toStrictEqual([
                row(1).blocks,
              ]);
            });
            expect(receipt).toStrictEqual({ directories: [], files: [] });
          } finally {
            await history.detachJournal(first);
            await history.detachJournal(second);
            await first.dispose();
            await second.dispose();
          }
        },
        [],
        async (history) => {
          // Seed one batch so setup does not leave thousands of obsolete versions
          // whose automatic compaction would run during the measured commands.
          await history.addBatch(
            Array.from({ length: size }, (_, index) => row(index)),
          );
          const store = history.detachedValues.host().journal;
          if (!(store instanceof JournalHistoryStore))
            throw new Error('Expected a native journal history store');
          store.changeOwnersOf(
            Array.from({ length: size }, (_, position) => ({
              position,
              origin: historyOriginId(position % 2 === 0 ? a : b),
            })),
          );
          await history.waitForCommit();
        },
      );
    });
  }
});
