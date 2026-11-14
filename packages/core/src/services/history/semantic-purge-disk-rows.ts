import type { ScratchRootOwner } from '../../storage/scratch-root.js';
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

  constructor(
    readonly scratchRoots: ScratchRootOwner,
    private readonly rowCensus?: RowOwnership,
  ) {
    super(scratchRoots, rowCensus);
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
  scratchRoots: ScratchRootOwner,
  source: AsyncIterable<IContent>,
  ownership?: RowOwnership,
  signal?: AbortSignal,
): Promise<SemanticPurgeDiskRows> {
  const rows = new SemanticPurgeDiskRows(scratchRoots, ownership);
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
