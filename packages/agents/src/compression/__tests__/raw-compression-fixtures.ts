/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createHash } from 'node:crypto';
import { accountingRow } from '../../../../core/src/services/history/token-accounting-stream-test-helpers.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function expectedCompressionReceipt(size: number): string {
  const candidate = [compressionRow(1), summaryRow(), compressionRow(size - 1)];
  const withSpan = annotateCompressionSpan(
    Array.from({ length: size }, (_, index) => compressionRow(index)),
    candidate,
  );
  const anchored = withSpan.map((entry, index) => {
    const metadata = { ...entry.metadata };
    delete metadata.cacheAnchor;
    if (index === 0) metadata.cacheAnchor = true;
    return { ...entry, metadata };
  });
  return createHash('sha256')
    .update(JSON.stringify(invalidateResponsesStatefulChain(anchored)))
    .digest('hex');
}

export function compressionRow(index: number, payloadBytes = 2048): IContent {
  const row = accountingRow(index, payloadBytes);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      ...(index === 0
        ? {
            semanticMediaPurgeFrontier: {
              contentIndex: 3,
              blockIndex: 1,
              contentId: 'purged-frontier',
            },
          }
        : {}),
      ...(row.speaker === 'ai'
        ? { responsesStored: true, cacheAnchor: true }
        : {}),
    },
  };
}

export function summaryRow(): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'compressed middle' }],
    metadata: { isSummary: true },
  };
}

export class CursorCompressionHistory extends HistoryService {
  readonly consumerOwnership = new RowOwnership();
  readonly borrowedOwnership = new RowOwnership();
  replacementReceipt: string | undefined;

  openedSnapshots = 0;
  closedSnapshots = 0;

  constructor(options: HistoryServiceJournalOptions) {
    super(options);
    const replace = this.detachedValues.replace;
    this.detachedValues.replace = (rows, model, options) => {
      if (Array.isArray(rows)) throw new Error('Array facade submitted');
      const setReceipt = (receipt: string): void => {
        this.replacementReceipt = receipt;
      };
      async function* observe(): AsyncGenerator<IContent, void, unknown> {
        const receipt = createHash('sha256').update('[');
        let separator = '';
        for await (const row of rows) {
          receipt.update(separator).update(JSON.stringify(row));
          separator = ',';
          yield row;
        }
        setReceipt(receipt.update(']').digest('hex'));
      }
      return replace(observe(), model, options);
    };
  }

  override async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    const snapshot = await super.openDumpSnapshot();
    this.openedSnapshots++;
    return {
      ...snapshot,
      rows: () => this.observeRows(snapshot.rows()),
      close: async () => {
        await snapshot.close();
        this.closedSnapshots++;
      },
    };
  }

  override streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    return this.observeRows(super.streamRawHistory(signal));
  }

  private async *observeRows(
    rows: AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of rows) {
      const copy = { ...row, blocks: [...row.blocks] };
      this.borrowedOwnership.retain(row);
      this.consumerOwnership.retain(row);
      this.consumerOwnership.retain(copy);
      try {
        yield copy;
      } finally {
        this.consumerOwnership.release(copy);
        this.consumerOwnership.release(row);
        this.borrowedOwnership.release(row);
      }
    }
  }
}
