/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CompressionInputSnapshot } from './compressionInput.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { isCuratedContent } from './historyCuration.js';

export async function oldCompressionInput(this: {
  openDumpSnapshot(): Promise<HistoryDumpSnapshot>;
}): Promise<CompressionInputSnapshot> {
  const previous = await this.openDumpSnapshot();
  let rows: HistoryDensityRows | undefined;
  const close = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const release of [() => rows?.close(), () => previous.close()]) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Old compression input cleanup failed',
      );
  };
  try {
    rows = new HistoryDensityRows();
    let ordinal = 0;
    for await (const row of previous.rows()) {
      if (isCuratedContent(row)) rows.append(row, ordinal);
      ordinal++;
    }
    return { previous, rows, close };
  } catch (primary) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        'Old compression input capture failed',
        { cause: primary },
      );
    }
    throw primary;
  }
}
