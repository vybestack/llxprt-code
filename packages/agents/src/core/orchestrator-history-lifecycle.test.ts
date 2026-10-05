/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import {
  expectedHistoryDigest,
  sendHistoryTurn,
  withOrchestratorHistory,
} from './orchestrator-history-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`orchestrator pinned reader at ${size}`, () => {
    it('does not open history while the outward event consumer is paused', async () => {
      await withOrchestratorHistory(size, async (client, history, reader) => {
        const before = reader.snapshot().acquisitions;
        const stream = client.sendMessageStream(
          'reply plainly',
          new AbortController().signal,
          'paused-event-consumer',
          1,
        );
        try {
          const first = await stream.next();
          expect(first.value).toMatchObject({ type: 'model_info' });
          await setImmediate();
          expect({
            scanned: history.scanned,
            acquisitions: reader.snapshot().acquisitions - before,
          }).toStrictEqual({ scanned: 0, acquisitions: 0 });
        } finally {
          await stream.return(undefined);
        }
        expect(reader.snapshot().liveRows).toBe(0);
      });
    }, 120_000);

    it('holds one row while the producer is paused and ignores a concurrent append', async () => {
      await withOrchestratorHistory(size, async (client, history, reader) => {
        history.pauseAfter = 31;
        const send = sendHistoryTurn(client);
        await history.paused.promise;
        try {
          const before = reader.snapshot();
          expect(before.liveRows).toBe(1);
          await setImmediate();
          expect(history.scanned).toBe(31);
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'concurrent append' }],
          });
          await history.waitForCommit();
          expect(
            reader.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        } finally {
          history.release.resolve();
        }
        expect(await send).toContain('a plain text reply');
        expect({
          count: history.scanned,
          digest: history.digest,
        }).toStrictEqual({ count: size, digest: expectedHistoryDigest(size) });
        expect(reader.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  });

  describe(`orchestrator reader failures at ${size}`, () => {
    it('propagates the original producer error before any history publication', async () => {
      await withOrchestratorHistory(size, async (client, history, reader) => {
        const fault = new Error('history reader disk failure');
        history.pauseAfter = 31;
        history.fault = fault;
        const result = sendHistoryTurn(client).then(
          () => undefined,
          (error: unknown) => error,
        );
        await history.paused.promise;
        history.release.resolve();
        expect(await result).toBe(fault);
        expect(reader.snapshot().liveRows).toBe(0);
        let count = 0;
        for await (const _row of history.streamRawHistory()) count++;
        expect(count).toBe(size);
      });
    }, 120_000);

    it('closes the pin and preserves abort identity after a paused producer resumes', async () => {
      await withOrchestratorHistory(size, async (client, history, reader) => {
        const controller = new AbortController();
        const reason = new Error('abort paused history');
        history.pauseAfter = 31;
        const result = sendHistoryTurn(client, controller.signal).then(
          () => undefined,
          (error: unknown) => error,
        );
        await history.paused.promise;
        controller.abort(reason);
        history.release.resolve();
        expect(await result).toBe(reason);
        expect(reader.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  });
}

describe('orchestrator valid large history row', () => {
  it('preserves a nine-MiB row through the invoked read and send without truncation', async () => {
    const bytes = 9 * 1024 * 1024;
    await withOrchestratorHistory(
      1,
      async (client, history, reader) => {
        expect(await sendHistoryTurn(client)).toContain('a plain text reply');
        expect(history.digest).toBe(expectedHistoryDigest(1, bytes));
        expect(reader.snapshot().liveRows).toBe(0);
      },
      bytes,
    );
  }, 120_000);
});
