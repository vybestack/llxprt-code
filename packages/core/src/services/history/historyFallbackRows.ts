/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

/** Durable values are serialized as-is; pending caller rows are sanitized into detached values. */
export async function withFallbackRestoreRows(
  snapshot: HistoryMutationSnapshot,
  execute: (rows: HistoryDensityRows) => Promise<void>,
  ownership?: RowOwnership,
): Promise<void> {
  const rows = new HistoryDensityRows(ownership);
  try {
    snapshot.restorePendingChronology();
    let index = 0;
    for (const row of snapshot) {
      const pending = snapshot.isPendingRow(index++);
      if (!Array.isArray(row.blocks) || row.blocks.length === 0) continue;
      if (pending) rows.appendSanitized(row);
      else rows.append(row);
    }
    await execute(rows);
  } finally {
    rows.close();
  }
}
