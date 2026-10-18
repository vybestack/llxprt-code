/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { accountingRow } from '@vybestack/llxprt-code-core/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import {
  sendHistoryTurn,
  withOrchestratorHistory,
} from './__tests__/support/orchestrator-history-test-helpers.js';
import {
  historySourceFailure,
  HistorySourceError,
} from './historySourceError.js';

for (const position of [1, 3, 5]) {
  for (const streaming of [false, true]) {
    describe(`request history producer failure at row ${position}, streaming=${streaming}`, () => {
      it('preserves the original cause, prior rows and released reader without publishing', async () => {
        await withOrchestratorHistory(5, async (client, history, reader) => {
          const failure = new Error('request producer failed');
          const events: string[] = [];
          for (const event of [
            'contentAdded',
            'contentBatchAdded',
            'tokensUpdated',
            'contextRangeChanged',
          ])
            history.on(event, () => events.push(event));
          history.pauseAfter = position;
          history.fault = failure;
          const operation = streaming
            ? sendHistoryTurn(client)
            : client
                .getChat()
                .sendMessage({ message: 'reply plainly' }, 'producer-failure');
          const result = operation.catch((error: unknown) => error);
          await history.paused.promise;
          history.release.resolve();
          expect(await result).toBe(failure);
          expect(events).toStrictEqual([]);
          expect(reader.snapshot().liveRows).toBe(0);
          let count = 0;
          for await (const row of history.streamRawHistory()) {
            expect(row).toStrictEqual(accountingRow(count));
            count++;
          }
          expect(count).toBe(5);
        });
      });
    });
  }
}

describe('local history failure classification', () => {
  it('preserves producer and cleanup causes in a combined failure', () => {
    const producer = new Error('producer');
    const cleanup = new Error('cleanup');
    const combined = new AggregateError(
      [new HistorySourceError(producer), cleanup],
      'cleanup failed',
    );
    const result = historySourceFailure(combined)?.error;
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError))
      throw new Error('Expected combined failure');
    expect(result.errors).toStrictEqual([producer, cleanup]);
    expect(result.errors[0]).toBe(producer);
    expect(result.errors[1]).toBe(cleanup);
  });

  it('leaves provider errors to the existing event contract', () => {
    expect(
      historySourceFailure(new Error('provider rejected request')),
    ).toBeUndefined();
    expect(
      historySourceFailure(
        new AggregateError([new Error('provider')], 'transport'),
      ),
    ).toBeUndefined();
  });
});
