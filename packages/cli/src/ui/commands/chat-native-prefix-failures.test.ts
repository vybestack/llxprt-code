/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '../../../../core/src/journal/versionSnapshot.js';
import {
  contents,
  persistedContents,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

describe('actual native CLI source and prepared publication errors', () => {
  const directory = useTempDir('cli-prefix-failures-');
  for (const stage of [
    'source',
    'abort',
    'journal-preparation',
    'token-notify',
    'recording-flush',
  ]) {
    it(`keeps the original ${stage} failure and restores the old history and recorder`, async () => {
      await withCLI(
        directory(),
        65,
        async ({ client, context, history, recording }) => {
          const before = await contents(client.getHistory());
          const tokens = history.getTotalTokens();
          const reason = new Error(`${stage} failed`);
          const source = VersionSnapshot.prototype.readRow;
          const prepare = JournalHistoryStore.prototype.prepareDetached;
          const estimate = history.estimateTokensForContents.bind(history);
          const controller = new AbortController();
          context.signal = controller.signal;
          const readFault = spyOn(VersionSnapshot.prototype, 'readRow');
          const prepareFault = spyOn(
            JournalHistoryStore.prototype,
            'prepareDetached',
          );
          const estimateFault = spyOn(history, 'estimateTokensForContents');
          const flushFault = spyOn(recording, 'flush');
          const notify = (): void => {
            throw reason;
          };
          if (stage === 'source')
            readFault.mockImplementationOnce(async function (
              this: VersionSnapshot,
              entry,
            ) {
              await source.call(this, entry);
              throw reason;
            });
          if (stage === 'journal-preparation')
            prepareFault.mockImplementationOnce(function (
              this: JournalHistoryStore,
              execute,
              ownerEdits,
              appendOnly,
            ) {
              return prepare.call(
                this,
                async (group) => {
                  await execute(group);
                  throw reason;
                },
                ownerEdits,
                appendOnly,
              );
            });
          if (stage === 'abort')
            estimateFault.mockImplementationOnce(async (...args) => {
              const tokens = await estimate(...args);
              controller.abort(reason);
              return tokens;
            });
          if (stage === 'token-notify') history.once('tokensUpdated', notify);
          if (stage === 'recording-flush')
            flushFault.mockRejectedValueOnce(reason);
          try {
            await expect(runCommand(context, 'restore', '1')).rejects.toBe(
              reason,
            );
            expect(await contents(client.getHistory())).toStrictEqual(before);
            expect(history.getTotalTokens()).toBe(tokens);
            expect(await persistedContents(recording)).toStrictEqual(before);
            expect(recording.isActive()).toBe(true);
          } finally {
            readFault.mockRestore();
            prepareFault.mockRestore();
            estimateFault.mockRestore();
            flushFault.mockRestore();
            history.off('tokensUpdated', notify);
          }
          context.signal = new AbortController().signal;
          expect(await runCommand(context, 'restore', '1')).toBeUndefined();
        },
      );
    });
  }
});
