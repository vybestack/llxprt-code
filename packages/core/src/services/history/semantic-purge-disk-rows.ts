/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { freezeSemanticPurgeValue } from './semantic-media-purge.js';
import type { IContent } from './IContent.js';

export interface SemanticPurgeRowSource {
  readonly length: number;
  streamRows(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown>;
}

export class SemanticPurgeDiskRows extends HistoryDensityRows {
  private released = false;

  constructor(private readonly rowCensus?: RowOwnership) {
    super(rowCensus);
  }

  override readRow(index: number): IContent {
    const row = super.readRow(index);
    freezeSemanticPurgeValue(row);
    return row;
  }

  withRow<T>(index: number, action: (row: IContent) => T): T {
    const row = this.readRow(index);
    this.rowCensus?.retain(row);
    try {
      return action(row);
    } finally {
      this.rowCensus?.release(row);
    }
  }

  view(): SemanticPurgeRowSource {
    return Object.freeze({
      length: this.length,
      streamRows: (
        signal?: AbortSignal,
      ): AsyncGenerator<IContent, void, unknown> => this.streamRows(signal),
    });
  }

  override close(): void {
    if (this.released) return;
    this.released = true;
    super.close();
  }
}

export async function captureSemanticPurgeRows(
  source: AsyncIterable<IContent>,
  ownership?: RowOwnership,
  signal?: AbortSignal,
): Promise<SemanticPurgeDiskRows> {
  const rows = new SemanticPurgeDiskRows(ownership);
  try {
    signal?.throwIfAborted();
    for await (const row of source) {
      signal?.throwIfAborted();
      rows.append(row);
    }
    signal?.throwIfAborted();
    return rows;
  } catch (error: unknown) {
    rows.close();
    throw error;
  }
}
