/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import {
  emitHistoryBatchValues,
  type HistoryBatchCursor,
  type HistoryBatchValues,
} from './history-batch-values.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { eventRows, visitBatch } from './batch-event-test-helpers.js';
import { publishMutationTokens } from './historyBatchContracts.js';
import { HistoryDensityRows } from './historyDensityRows.js';

class FailedReaderJournal extends DetachedHistoryJournal {
  readonly failure = new Error('disk batch read failed');
  override readRow(
    ordinal: number,
  ): ReturnType<DetachedHistoryJournal['readRow']> {
    if (ordinal === 1) throw this.failure;
    return super.readRow(ordinal);
  }
}
class FalseListenerHistory extends HistoryService {
  override listenerCount(): number {
    return 0;
  }
}

describe('batch reader scope failures', () => {
  it('does not mistake a false listenerCount for absence of a real subscriber', async () => {
    const history = new FalseListenerHistory();
    history.setTokenizerFactory(exactTokenizer());
    let count = 0;
    history.on('contentBatchAdded', (values) => {
      count = visitBatch(values, () => undefined);
    });
    try {
      await history.detachedValues.replace(eventRows(3), undefined, {
        publishBatch: true,
      });
      expect(count).toBe(3);
    } finally {
      history.dispose();
    }
  });
  it('releases a failed disk reader and preserves its exact error through dispatch', () => {
    const history = new HistoryService();
    const owners = new RowOwnership();
    const source = new FailedReaderJournal();
    for (const row of eventRows(3)) source.append(row);
    let saved: HistoryBatchCursor | undefined;
    let view: HistoryBatchValues | undefined;
    history.on('contentBatchAdded', (values) => {
      view = values;
      values.withRows((cursor) => {
        saved = cursor;
        cursor.next();
        cursor.next();
      });
    });
    try {
      expect(() => emitHistoryBatchValues(history, source, 0, owners)).toThrow(
        source.failure,
      );
      expect(owners.snapshot().liveRows).toBe(0);
      expect(() => saved?.next()).toThrow('closed');
      expect(() => view?.withRows(() => undefined)).toThrow('closed');
    } finally {
      source.close();
      history.dispose();
    }
  });
});

describe('batch reader misuse and legacy producer', () => {
  it('closes a cursor acquired by runtime asynchronous misuse before a later continuation', async () => {
    const history = new HistoryService();
    const source = new DetachedHistoryJournal();
    for (const row of eventRows(1)) source.append(row);
    let escaped: HistoryBatchCursor | undefined;
    const thenable = { then: (): void => {} };
    history.once('contentBatchAdded', (values) => {
      const callback = (cursor: HistoryBatchCursor): object => {
        escaped = cursor;
        cursor.next();
        return thenable;
      };
      expect(() => Reflect.apply(values.withRows, values, [callback])).toThrow(
        'synchronous',
      );
    });
    try {
      emitHistoryBatchValues(history, source);
      await Promise.resolve();
      expect(() => escaped?.next()).toThrow('closed');
    } finally {
      source.close();
      history.dispose();
    }
  });
  it('migrates the legacy batch producer without changing per-row and token publication order', () => {
    const history = new HistoryService();
    const source = new DetachedHistoryJournal();
    const next = new HistoryDensityRows();
    for (const row of eventRows(3)) {
      source.append(row);
      next.append(row);
    }
    const order: string[] = [];
    let saved: HistoryBatchValues | undefined;
    history.on('contentBatchAdded', (values) => {
      saved = values;
      order.push(`batch:${visitBatch(values, () => undefined)}`);
    });
    history.on('contentAdded', () => {
      expect(() => saved?.length).toThrow('closed');
      order.push('row');
    });
    history.on('tokensUpdated', (event) => {
      order.push(`tokens:${event.addedTokens}`);
    });
    try {
      publishMutationTokens(
        history,
        {
          nextHistory: next,
          publishedBatch: source,
          publishedRowStart: 1,
          options: {},
        },
        12,
      );
      expect(order).toStrictEqual(['batch:3', 'row', 'row', 'tokens:12']);
    } finally {
      next.close();
      source.close();
      history.dispose();
    }
  });
});
