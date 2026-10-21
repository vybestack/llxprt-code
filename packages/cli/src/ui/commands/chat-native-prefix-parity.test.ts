/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  withCLI,
  row,
  contents,
  runCommand,
  persistedContents,
  operationFileCreates,
  useTempDir,
} from './native-prefix-test-helpers.js';

async function states(
  root: string,
  size: number,
  backend: 'old' | 'journal',
): Promise<unknown[]> {
  const previous = process.env.LLXPRT_HISTORY_BACKEND;
  process.env.LLXPRT_HISTORY_BACKEND = backend;
  const captures: unknown[] = [];
  const seed = Array.from({ length: size }, (_, index) => ({
    ...row(index),
    metadata: {
      turnId: `parity-${index}`,
      chronology: {
        seq: index + 1,
        userTurn: Math.floor(index / 2) + 1,
        step: (index % 2) + 1,
        recordedAt: 1,
      },
    },
  }));
  try {
    await withCLI(
      root,
      size,
      async ({ client, history, context, recording, displayed, uiTokens }) => {
        history.setTokenizerFactory(exactTokenizer());
        history.setCacheAnchorSeq(7);
        const capture = async (): Promise<void> => {
          if (backend === 'old') await history.waitForCommit();
          const live = await contents(client.getHistory());
          const durable = await persistedContents(recording);
          expect(live).toStrictEqual(durable);
          captures.push({
            history: live,
            tokens: history.getTotalTokens(),
            offset: history.getBaseTokenOffset(),
            anchor: history.getCacheAnchorSeq(),
            range: history.getContextRange(),
            displayed: [...displayed],
            uiTokens: uiTokens(),
            initialized: client.hasChatInitialized(),
            active: recording.isActive(),
            ownsLock: recording.ownsLockFor(recording.getSessionId()),
          });
        };
        const run = async (): Promise<void> => {
          expect(await runCommand(context, 'restore', '1')).toBeUndefined();
          expect((await contents(client.getHistory())).length).toBe(size - 2);
          await capture();
          expect(await runCommand(context, 'clear')).toBeUndefined();
          expect((await contents(client.getHistory())).length).toBe(2);
          await capture();
        };
        if (backend === 'journal') {
          expect(await operationFileCreates(run, true)).toStrictEqual({
            directories: [],
            files: [],
          });
        } else await run();
      },
      seed,
    );
    return captures;
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_HISTORY_BACKEND;
    else process.env.LLXPRT_HISTORY_BACKEND = previous;
  }
}

describe('actual CLI prefix independent old-backend parity', () => {
  const directory = useTempDir('cli-prefix-parity-');
  for (const size of [512, 8192]) {
    it(`matches exact old-backend live/durable rows, tokens, context and UI state at ${size} rows`, async () => {
      const expected = await states(directory(), size, 'old');
      expect(await states(directory(), size, 'journal')).toStrictEqual(
        expected,
      );
    });
  }
});
