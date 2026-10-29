/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import { describe, expect, it, spyOn } from 'bun:test';
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

function barrier(): { promise: Promise<void>; open(): void } {
  let open = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('actual native CLI prefix rollback and readers', () => {
  const directory = useTempDir('cli-prefix-lifecycle-');
  for (const command of ['clear', 'restore']) {
    for (const stage of [
      'producer',
      'client-finalization',
      'ui-notification',
      'mirror-ack',
    ]) {
      it(`restores history, tokens, range, anchor and durable mirror after ${command} ${stage} failure`, async () => {
        await withCLI(
          directory(),
          65,
          async ({ client, history, context, recording }) => {
            const before = await contents(client.getHistory());
            const tokens = history.getTotalTokens();
            const range = history.getContextRange();
            const offset = history.getBaseTokenOffset();
            history.setCacheAnchorSeq(7);
            const failure = new Error(`${command} ${stage}`);
            const originalPublish = client.resetChat.bind(client);
            const estimate = spyOn(history, 'estimateTokensForContents');
            const publish = spyOn(client, 'resetChat');
            const notify = spyOn(context.ui, 'clear');
            const wait = spyOn(history, 'waitForCommit');
            if (stage === 'producer') estimate.mockRejectedValueOnce(failure);
            if (stage === 'client-finalization') {
              publish.mockImplementationOnce(async (...args) => {
                await originalPublish(...args);
                throw failure;
              });
            }
            if (stage === 'ui-notification')
              notify.mockImplementationOnce(() => {
                throw failure;
              });
            if (stage === 'mirror-ack') wait.mockRejectedValueOnce(failure);
            try {
              await expect(runCommand(context, command, '1')).rejects.toBe(
                failure,
              );
              expect(await contents(client.getHistory())).toStrictEqual(before);
              expect(history.getTotalTokens()).toBe(tokens);
              expect(history.getBaseTokenOffset()).toBe(offset);
              expect(history.getContextRange()).toStrictEqual(range);
              expect(history.getCacheAnchorSeq()).toBe(7);
              expect(await persistedContents(recording)).toStrictEqual(before);
            } finally {
              estimate.mockRestore();
              publish.mockRestore();
              notify.mockRestore();
              wait.mockRestore();
            }
            expect(await runCommand(context, command, '1')).toBeUndefined();
          },
        );
      });
    }
  }

  it('holds the old request version through concurrent clear, client failure and client shutdown', async () => {
    await withCLI(directory(), 65, async ({ client, history, context }) => {
      await history.detachedValues.withCheckpoint(async (held) => {
        const cursor = checkpointRows(held);
        const first = await cursor.next();
        const entered = barrier();
        const proceed = barrier();
        const failure = new Error('client finalized then failed');
        const original = client.resetChat.bind(client);
        const fault = spyOn(client, 'resetChat').mockImplementationOnce(
          async (...args) => {
            await original(...args);
            entered.open();
            await proceed.promise;
            throw failure;
          },
        );
        const pending = runCommand(context, 'clear').then(
          () => undefined,
          (error: unknown) => error,
        );
        await entered.promise;
        expect((await contents(client.getHistory())).length).toBe(2);
        proceed.open();
        try {
          expect(await pending).toBe(failure);
          await client.dispose();
          const old = first.done === true ? [] : [first.value];
          for (
            let next = await cursor.next();
            next.done !== true;
            next = await cursor.next()
          ) {
            old.push(next.value);
          }
          expect(blocks(old)).toStrictEqual(
            Array.from({ length: 65 }, (_, i) => row(i).blocks),
          );
        } finally {
          fault.mockRestore();
        }
      });
    });
  });

  it('preserves the exact abort reason and the prior history', async () => {
    await withCLI(directory(), 65, async ({ client, context }) => {
      const before = await contents(client.getHistory());
      const controller = new AbortController();
      const reason = new Error('abort native CLI restore');
      controller.abort(reason);
      context.signal = controller.signal;
      await expect(runCommand(context, 'restore', '1')).rejects.toBe(reason);
      expect(await contents(client.getHistory())).toStrictEqual(before);
    });
  });

  it('retains every byte of a surviving value greater than nine MiB without files', async () => {
    await withCLI(
      directory(),
      3,
      async ({ agent, client, context, recording }) => {
        const text = 'x'.repeat(9 * 1024 * 1024 + 17);
        await agent.setHistory([
          { ...row(0), blocks: [{ type: 'text', text }] },
          row(1),
          row(2),
        ]);
        const receipt = await operationFileCreates(async () => {
          expect(await runCommand(context, 'clear')).toBeUndefined();
        }, true);
        expect(receipt).toStrictEqual({ directories: [], files: [] });
        expect(blocks(await contents(client.getHistory()))).toStrictEqual([
          [{ type: 'text', text }],
          row(1).blocks,
        ]);
        expect(blocks(await persistedContents(recording))).toStrictEqual([
          [{ type: 'text', text }],
          row(1).blocks,
        ]);
      },
    );
  });
});
